// 常驻监控器：实现「形态 2」——Copilot 启动即自动注入中文。
//
// 工作方式：
//   定时轮询 Copilot 进程 → 检测到新启动的实例 → 等待调试端口就绪 → 注入字典
//   期间监测页面重载（WebView 刷新会丢翻译）→ 重新注入
//
// 关键性能约束（曾经踩过的坑）：
//   早期版本用 execFileSync + PowerShell 查进程，每 1.5 秒阻塞主进程 1-2 秒，
//   导致整个界面卡死、IPC 超时。
//   现在改为：
//     1) 全部异步（execFile 回调），不阻塞事件循环
//     2) 用 tasklist 而非 PowerShell（启动开销小一个数量级）
//
// 事件：
//   'status'         → 状态快照
//   'injected'       → 注入成功
//   'error'          → 异常
//   'policy-written' → 补写了调试策略，需重启 Copilot

'use strict';

const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const PORT = 9222;

/**
 * 异步查询 github.exe 的 PID 列表。
 * 使用 tasklist（原生小工具，约 30ms），避免 PowerShell 的 1-2 秒启动开销。
 *
 * @returns {Promise<number[]>}
 */
function findCopilotPids() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq github.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        const pids = [];
        for (const line of String(stdout || '').split(/\r?\n/)) {
          // 格式："github.exe","12345","Console","1","123,456 K"
          const m = line.match(/^"github\.exe","(\d+)"/i);
          if (m) pids.push(parseInt(m[1], 10));
        }
        resolve(pids);
      }
    );
  });
}

/**
 * 常驻监控器。
 */
class Watcher extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => object|null} opts.getDict   取得当前字典（null 表示无字典）
   * @param {object} opts.engine               注入引擎实例
   * @param {() => boolean} opts.isEnabled     是否启用监控
   * @param {() => number} opts.getInterval    轮询间隔
   */
  constructor(opts) {
    super();
    this.getDict = opts.getDict;
    this.engine = opts.engine;
    this.isEnabled = opts.isEnabled;
    this.getInterval = opts.getInterval || (() => 1500);

    this.timer = null;
    this.running = false;

    // 状态追踪
    this.injectedPid = null;
    this.pendingPid = null;
    this.injecting = false;
    this.lastInjectAt = null;
    this.lastError = null;
    this.attempts = 0;

    this.copilotPids = [];
    this.copilotRunning = false;
    this._ticking = false;   // 防止上一次 tick 未完成时重复进入
    this._policyCheckedForPid = [];  // 已检查过策略的 PID，避免重复同步读注册表
  }

  start() {
    if (this.running) return { ok: true, already: true };
    this.running = true;
    this._schedule(0);
    this.emit('status', this.status());
    return { ok: true };
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emit('status', this.status());
    return { ok: true };
  }

  _schedule(delay) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this._tick(), delay === undefined ? this.getInterval() : delay);
  }

  async _tick() {
    if (!this.running) return;
    // 上一轮还没跑完就跳过，避免堆积
    if (this._ticking) { this._schedule(); return; }
    this._ticking = true;
    try {
      if (!this.isEnabled()) {
        this.copilotRunning = false;
        this.copilotPids = [];
        this.injectedPid = null;
        this.emit('status', this.status());
      } else {
        await this._check();
      }
    } catch (e) {
      this.lastError = e.message;
      this.emit('error', { message: e.message });
    } finally {
      this._ticking = false;
      this._schedule();
    }
  }

  async _check() {
    const pids = await findCopilotPids();
    const wasRunning = this.copilotRunning;
    this.copilotPids = pids;
    this.copilotRunning = pids.length > 0;

    // Copilot 未运行
    if (!pids.length) {
      if (wasRunning) {
        this.injectedPid = null;
        this.pendingPid = null;
        this.attempts = 0;
        this.lastError = null;
        this.emit('status', this.status());
      }
      return;
    }

    const pid = pids[0];

    // 新实例启动 → 重置注入标记
    if (this.injectedPid !== null && this.injectedPid !== pid) {
      this.injectedPid = null;
      this.attempts = 0;
    }
    if (!this._policyCheckedForPid.includes(pid) && this._policyCheckedForPid.length > 5) {
      this._policyCheckedForPid = [];   // 防止无限增长
    }

    if (!wasRunning) {
      this.emit('status', this.status());
    }

    // 已注入过该 PID：检查页面是否被重载（刷新会丢翻译）
    if (this.injectedPid === pid) {
      const alive = await this._checkPageStillTranslated();
      if (alive) return;
      this.injectedPid = null;
      this.attempts = 0;
    }

    if (this.injecting) return;
    if (this.pendingPid === pid && this.attempts > 30) return;

    // 端口不通且已重试若干次：检查策略是否缺失，缺失则补写并提示重启
    // 注意：ensurePolicy 内部有同步注册表读取，因此只在此路径（低频）调用
    if (this.attempts >= 2 && !this._policyCheckedForPid.includes(pid)) {
      const portReady = await this._isPortReady();
      if (!portReady) {
        this._policyCheckedForPid.push(pid);
        const p = this.ensurePolicy();
        if (p.ok && p.wrote) {
          this.lastError = p.reason;
          this.emit('policy-written', { reason: p.reason });
          this.emit('status', this.status());
          this.attempts = 31;   // 当前实例不会生效，等用户重启
          return;
        } else if (!p.ok && p.reason) {
          this.lastError = p.reason;
          this.emit('status', this.status());
          this.attempts = 31;
          return;
        }
      }
    }

    await this._inject(pid);
  }

  /**
   * 确保调试端口策略已就位（首次使用的关键路径）。
   */
  ensurePolicy() {
    let cdp;
    try {
      cdp = require('./platform/win32/runtimeInject');
    } catch (e) {
      return { ok: false, wrote: false, reason: e.message };
    }

    const cur = cdp.readPolicy('github.exe');
    const expected = `--remote-debugging-port=${PORT}`;
    if (cur && String(cur).includes(expected)) {
      return { ok: true, wrote: false };
    }
    if (!cdp.isElevated()) {
      return {
        ok: false, wrote: false,
        reason: '需要管理员权限才能开启调试端口（请右键以管理员身份运行本程序）',
      };
    }
    const w = cdp.writePolicy('github.exe', expected);
    if (!w.ok) return { ok: false, wrote: false, reason: w.reason };
    return {
      ok: true, wrote: true, needRestart: true,
      reason: '已开启调试端口，需要重启 GitHub Copilot 一次才能生效',
    };
  }

  async _checkPageStillTranslated() {
    try {
      const cdp = require('./platform/win32/runtimeInject');
      return (await cdp.queryTranslatorAlive(PORT)) === true;
    } catch (e) {
      return false;
    }
  }

  async _isPortReady() {
    try {
      const cdp = require('./platform/win32/runtimeInject');
      return await cdp.isPortReady(PORT);
    } catch (e) {
      return false;
    }
  }

  async _inject(pid) {
    const dict = this.getDict();
    if (!dict) {
      this.lastError = '没有可用的字典包';
      return;
    }

    this.injecting = true;
    this.pendingPid = pid;
    this.attempts++;

    try {
      const r = await this.engine.apply(
        { exePath: '', version: null },
        dict,
        { onProgress: () => {}, requirePolicy: false, maxWaitMs: 3000 }
      );
      if (r.ok) {
        this.injectedPid = pid;
        this.lastInjectAt = new Date().toISOString();
        this.lastError = null;
        this.attempts = 0;
        this.emit('injected', {
          pid,
          replaced: (r.stats && r.stats.replaced) || 0,
          at: this.lastInjectAt,
        });
        this.emit('status', this.status());
      } else {
        this.lastError = r.reason || '注入失败';
        if (this.attempts > 3) this.emit('status', this.status());
      }
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this.injecting = false;
    }
  }

  /** 手动强制注入一次（用户点「立即汉化」） */
  async forceInject() {
    const pids = await findCopilotPids();
    if (!pids.length) return { ok: false, reason: 'GitHub Copilot 未运行' };
    this.copilotPids = pids;
    this.copilotRunning = true;
    this.injectedPid = null;
    this.attempts = 0;
    await this._inject(pids[0]);
    return { ok: this.injectedPid === pids[0], reason: this.lastError || undefined };
  }

  /**
   * 外部（一键汉化流程）已完成注入时调用，同步监控器状态。
   * 避免监控器误判为「未注入」而重复注入造成界面闪烁。
   */
  async markInjected() {
    const pids = await findCopilotPids();
    this.copilotPids = pids;
    this.copilotRunning = pids.length > 0;
    this.injectedPid = pids[0] || null;
    this.attempts = 0;
    this.lastError = null;
    this.lastInjectAt = new Date().toISOString();
    this.emit('status', this.status());
  }

  status() {
    return {
      running: this.running,
      enabled: this.isEnabled(),
      copilotRunning: this.copilotRunning,
      copilotPid: this.copilotPids[0] || null,
      injectedPid: this.injectedPid,
      injected: this.injectedPid !== null && this.injectedPid === (this.copilotPids[0] || null),
      lastInjectAt: this.lastInjectAt,
      lastError: this.lastError,
      port: PORT,
    };
  }
}

module.exports = { Watcher, findCopilotPids, PORT };
