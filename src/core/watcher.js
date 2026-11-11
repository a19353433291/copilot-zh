// 常驻监控器：实现「形态 2」——Copilot 启动即自动注入中文。
//
// 工作方式：
//   定时轮询 Copilot 进程 → 检测到新启动的实例 → 等待调试端口就绪 → 注入字典
//   期间监测页面重载（WebView 刷新会丢翻译）→ 重新注入
//
// 为什么需要轮询而不是事件：
//   Windows 没有可靠的「进程启动」订阅机制（WMI 事件在这类桌面场景开销大且易漏）。
//   1.5 秒轮询一次 Get-Process 成本可忽略，且稳定。
//
// 关键设计：
//   - 每次检测到 Copilot PID 变化，视为「重新启动」，重置注入状态
//   - 每个 PID 只注入一次成功，避免重复注入造成闪烁
//   - 注入失败自动重试（应用刚启动时 WebView 可能还没准备好）

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const PORT = 9222;

/** 查询 Copilot 进程 PID 列表 */
function findCopilotPids() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-Process -Name github -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id"],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return String(out).split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  } catch (e) {
    return [];
  }
}

/**
 * 常驻监控器。
 * 事件：
 *   'status'   → { running, copilotRunning, lastInjectAt, lastError, injectedPid }
 *   'injected' → { pid, replaced, at }
 *   'error'    → { message }
 */
class Watcher extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => object|null} opts.getDict   取得当前字典（返回 null 表示无字典）
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
    this.injectedPid = null;      // 已成功注入的 Copilot PID
    this.pendingPid = null;       // 正在尝试注入的 PID
    this.injecting = false;
    this.lastInjectAt = null;
    this.lastError = null;
    this.attempts = 0;            // 当前 PID 的注入尝试次数

    this.copilotPids = [];
    this.copilotRunning = false;
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
    this.timer = setTimeout(() => this._tick(), delay === undefined ? this.getInterval() : delay);
    if (this.timer.unref) {
      // 不阻止进程退出
      // 但 Electron 主进程本身有事件循环，unref 不影响功能
    }
  }

  async _tick() {
    if (!this.running) return;
    try {
      if (!this.isEnabled()) {
        // 监控被设置关闭：清状态但不报错
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
      this._schedule();
    }
  }

  async _check() {
    const pids = findCopilotPids();
    const wasRunning = this.copilotRunning;
    this.copilotPids = pids;
    this.copilotRunning = pids.length > 0;

    // Copilot 未运行
    if (!pids.length) {
      if (wasRunning) {
        // 刚关闭：重置状态，下次启动重新注入
        this.injectedPid = null;
        this.pendingPid = null;
        this.attempts = 0;
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

    // 未运行过 → 首次注入
    if (!wasRunning) {
      this.emit('status', this.status());
    }

    // 已注入过该 PID：还要检查页面是否被重载（刷新会丢翻译）
    if (this.injectedPid === pid) {
      const alive = await this._checkPageStillTranslated();
      if (alive) return;                 // 仍然有效，不做任何事
      // 页面重载了，需要重新注入
      this.injectedPid = null;
      this.attempts = 0;
    }

    // 避免重复并发注入
    if (this.injecting) return;
    if (this.pendingPid === pid && this.attempts > 30) {
      // 已尝试太多次，放弃该 PID（可能是端口被占用或策略未生效）
      return;
    }

    // 端口不通时，检查策略是否缺失；缺失则补写并提示重启
    if (this.attempts >= 2) {
      const portReady = await this._isPortReady();
      if (!portReady) {
        const p = this.ensurePolicy();
        if (p.ok && p.wrote) {
          this.lastError = p.reason;
          this.emit('policy-written', { reason: p.reason });
          this.emit('status', this.status());
          // 策略刚写入，当前 Copilot 实例不会生效，等用户重启
          // 把 attempts 推高，避免继续无效重试
          this.attempts = 31;
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

  /** 探测调试端口是否就绪（不注入） */
  async _isPortReady() {
    try {
      const cdp = require('./platform/win32/runtimeInject');
      return await cdp.isPortReady(PORT);
    } catch (e) {
      return false;
    }
  }

  /** 检查页面里翻译器是否还活着 */
  async _checkPageStillTranslated() {
    try {
      const cdp = require('./platform/win32/runtimeInject');
      const r = await cdp.queryTranslatorAlive(PORT);
      return r === true;
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
        { onProgress: () => {}, requirePolicy: false }
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
        // 应用刚启动时端口可能未就绪，属于正常重试，不当作错误上报
        if (this.attempts > 3) this.emit('status', this.status());
      }
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this.injecting = false;
    }
  }

  /**
   * 确保调试端口策略已就位。
   * 这是「首次使用免人工」的关键：
   *   Copilot 只有在启动时才读取 WebView2 策略，
   *   若策略缺失，WebView2 不会开调试端口，注入必败。
   *   因此监控器在发现 Copilot 运行但端口不通时，应主动补写策略，
   *   并提示用户「需重启 Copilot 一次」。
   *
   * @returns {{ok: boolean, wrote: boolean, reason?: string, needRestart?: boolean}}
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

    // 需要写策略（需要管理员权限）
    if (!cdp.isElevated()) {
      return {
        ok: false,
        wrote: false,
        reason: '需要管理员权限才能开启调试端口（请右键以管理员身份运行本程序）',
      };
    }
    const w = cdp.writePolicy('github.exe', expected);
    if (!w.ok) return { ok: false, wrote: false, reason: w.reason };

    return {
      ok: true,
      wrote: true,
      needRestart: true,
      reason: '已写入调试端口策略，需要重启 GitHub Copilot 一次才能生效',
    };
  }

  /** 手动强制注入一次（忽略「已注入」判断，用于用户点「立即汉化」） */
  async forceInject() {
    const pids = findCopilotPids();
    if (!pids.length) return { ok: false, reason: 'GitHub Copilot 未运行' };
    this.copilotPids = pids;
    this.copilotRunning = true;
    this.injectedPid = null;
    this.attempts = 0;
    await this._inject(pids[0]);
    return {
      ok: this.injectedPid === pids[0],
      reason: this.lastError || undefined,
    };
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
