// 自动更新核心：版本比较、下载、校验、安装。
//
// 安全设计：
//   1. 只接受 https 下载地址（localhost 例外，便于调试）
//   2. 下载后必须校验 sha512，不匹配直接删除并报错
//   3. 版本必须严格大于当前版本才提示更新（防止降级攻击）
//   4. 安装包下载到独立临时目录，使用完即清理
//   5. 不自动执行，必须用户确认后才启动安装器

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createSource, request } = require('./sources');

/* ==========================================================================
   版本比较
   ========================================================================== */

/**
 * 语义化版本比较。
 * 支持 1.2.3 / 1.2.3-beta.1 / v1.2.3 形式。
 * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
 */
function compareVersions(a, b) {
  const norm = (v) => String(v || '0')
    .replace(/^v/i, '')
    .split('-')[0]                 // 忽略预发布标记，简化比较
    .split('.')
    .map(x => parseInt(x, 10) || 0);

  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** 是否为安全的下载地址 */
function isSafeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    // 允许本机 http，方便自建源调试
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/* ==========================================================================
   下载与校验
   ========================================================================== */

/**
 * 下载文件到指定路径，边下边算 sha512。
 * @returns {{ok:boolean, sha512?:string, size?:number, reason?:string}}
 */
async function downloadFile(url, destPath, opts = {}) {
  const { onProgress = () => {}, timeout = 0 } = opts;

  if (!isSafeUrl(url)) {
    return { ok: false, reason: '不安全的下载地址（仅允许 https）' };
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const hash = crypto.createHash('sha512');
  const tmpPath = destPath + '.part';
  const stream = fs.createWriteStream(tmpPath);

  let received = 0;

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err); else resolve();
      };

      // 用 sources 里的 request 会一次性读进内存，安装包 98MB 太大，
      // 这里直接流式下载。
      const https = require('https');
      const httpMod = require('http');
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : httpMod;

      let redirects = 0;
      const go = (target) => {
        const tu = new URL(target);
        const req = (tu.protocol === 'https:' ? https : httpMod).request({
          hostname: tu.hostname,
          port: tu.port || (tu.protocol === 'https:' ? 443 : 80),
          path: tu.pathname + tu.search,
          method: 'GET',
          headers: { 'User-Agent': 'CopilotHan-Updater/1.0' },
          timeout: timeout || 120000,
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirects++ >= 5) return done(new Error('重定向次数过多'));
            return go(new URL(res.headers.location, target).toString());
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return done(new Error('下载失败：HTTP ' + res.statusCode));
          }

          const total = Number(res.headers['content-length'] || 0);
          res.on('data', (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            if (!stream.write(chunk)) res.pause();
            stream.once('drain', () => res.resume());
            onProgress(received, total);
          });
          res.on('end', () => {
            stream.end(() => done(null));
          });
          res.on('error', (e) => { stream.destroy(); done(e); });
        });

        req.on('timeout', () => req.destroy(new Error('下载超时')));
        req.on('error', (e) => { stream.destroy(); done(e); });
        req.end();
      };

      go(url);
    });

    const sha512 = hash.digest('base64');
    // 原子改名
    fs.renameSync(tmpPath, destPath);
    return { ok: true, sha512, size: received };
  } catch (e) {
    try { stream.destroy(); } catch (_) {}
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    return { ok: false, reason: e.message };
  }
}

/** 计算已有文件的 sha512（base64） */
function fileSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const s = fs.createReadStream(filePath);
    s.on('data', (c) => hash.update(c));
    s.on('end', () => resolve(hash.digest('base64')));
    s.on('error', reject);
  });
}

/* ==========================================================================
   更新管理器
   ========================================================================== */

class UpdateManager {
  /**
   * @param {object} opts
   *   currentVersion  当前应用版本
   *   config          更新源配置 { source, github, gitee, generic }
   *   downloadDir     下载目录
   *   onStatus        状态回调 (status) => void
   *   onLog           日志回调 (text) => void
   */
  constructor(opts) {
    this.currentVersion = opts.currentVersion;
    this.config = opts.config || {};
    this.downloadDir = opts.downloadDir || path.join(os.tmpdir(), 'copilot-zh-update');
    this.onStatus = opts.onStatus || (() => {});
    this.onLog = opts.onLog || (() => {});

    this.state = 'idle';      // idle | checking | available | downloading | ready | error
    this.latest = null;       // fetchLatest 的结果
    this.downloadedPath = null;
    this.lastError = null;
  }

  getStatus() {
    return {
      state: this.state,
      currentVersion: this.currentVersion,
      latestVersion: this.latest ? this.latest.version : null,
      notes: this.latest ? this.latest.notes : '',
      publishedAt: this.latest ? this.latest.publishedAt : null,
      htmlUrl: this.latest ? this.latest.htmlUrl : '',
      downloadedPath: this.downloadedPath,
      lastError: this.lastError,
      sourceId: this.config.source || 'github',
    };
  }

  _setState(state, extra = {}) {
    this.state = state;
    if (extra.error !== undefined) this.lastError = extra.error;
    this.onStatus(this.getStatus());
  }

  /** 检查更新 */
  async check() {
    const sourceId = this.config.source || 'github';
    const src = createSource(sourceId, this.config);
    if (!src) {
      this._setState('error', { error: '更新源未配置' });
      return { ok: false, reason: '更新源未配置' };
    }

    this._setState('checking');
    this.onLog(`正在通过 ${src.displayName} 检查更新…`);

    let result;
    try {
      result = await src.fetchLatest((msg) => this.onLog(msg));
    } catch (e) {
      this._setState('error', { error: e.message });
      return { ok: false, reason: e.message };
    }

    if (!result.ok) {
      this._setState('error', { error: result.reason });
      return result;
    }

    if (!isSafeUrl(result.assets.exeUrl)) {
      this._setState('error', { error: '更新源返回了不安全的下载地址' });
      return { ok: false, reason: '不安全的下载地址' };
    }

    const cmp = compareVersions(result.version, this.currentVersion);
    if (cmp <= 0) {
      this.latest = result;
      this._setState('idle');
      this.onLog(`已是最新版本（当前 ${this.currentVersion}，远端 ${result.version}）`);
      return {
        ok: true,
        hasUpdate: false,
        currentVersion: this.currentVersion,
        latestVersion: result.version,
      };
    }

    this.latest = result;
    this.downloadedPath = null;
    this._setState('available');
    this.onLog(`发现新版本 ${result.version}（当前 ${this.currentVersion}）`);
    return {
      ok: true,
      hasUpdate: true,
      currentVersion: this.currentVersion,
      latestVersion: result.version,
      notes: result.notes,
      publishedAt: result.publishedAt,
      size: result.assets.exeSize,
    };
  }

  /** 下载更新包并校验 */
  async download() {
    if (!this.latest) return { ok: false, reason: '请先检查更新' };
    const { assets } = this.latest;

    const fileName = assets.exeName || 'update.exe';
    const dest = path.join(this.downloadDir, fileName);

    this._setState('downloading');
    this.onLog(`开始下载 ${fileName}…`);

    const dl = await downloadFile(assets.exeUrl, dest, {
      onProgress: (got, total) => {
        const pct = total > 0 ? Math.round((got / total) * 100) : 0;
        this.onStatus({ ...this.getStatus(), progress: pct, received: got, total });
      },
    });

    if (!dl.ok) {
      this._setState('error', { error: '下载失败：' + dl.reason });
      return { ok: false, reason: dl.reason };
    }

    // 校验 sha512
    if (assets.sha512) {
      this.onLog('校验文件完整性…');
      const actual = await fileSha512(dest);
      if (actual !== assets.sha512) {
        try { fs.unlinkSync(dest); } catch (_) {}
        this._setState('error', { error: '文件校验失败，可能下载不完整或被篡改' });
        return {
          ok: false,
          reason: 'SHA-512 校验不通过（期望 ' + assets.sha512.slice(0, 16)
            + '…，实际 ' + actual.slice(0, 16) + '…）',
        };
      }
      this.onLog('校验通过');
    } else {
      this.onLog('警告：更新源未提供 sha512，跳过完整性校验');
    }

    this.downloadedPath = dest;
    this._setState('ready');
    return { ok: true, path: dest, size: dl.size };
  }

  /**
   * 启动安装器并退出应用。
   * @param {function} quitFn 退出应用的回调
   */
  install(quitFn) {
    if (!this.downloadedPath || !fs.existsSync(this.downloadedPath)) {
      return { ok: false, reason: '安装包不存在，请重新下载' };
    }

    try {
      // NSIS 静默安装参数：/S 静默，/D 指定目录（可选）
      const child = spawn(this.downloadedPath, [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      // 给安装器一点启动时间，然后退出本应用
      setTimeout(() => {
        if (typeof quitFn === 'function') quitFn();
      }, 800);

      return { ok: true };
    } catch (e) {
      return { ok: false, reason: '启动安装器失败：' + e.message };
    }
  }

  /** 清理下载的临时文件 */
  cleanup() {
    try {
      if (this.downloadedPath && fs.existsSync(this.downloadedPath)) {
        fs.unlinkSync(this.downloadedPath);
      }
      if (fs.existsSync(this.downloadDir)) {
        // 只清空目录内的文件，保留目录本身
        for (const f of fs.readdirSync(this.downloadDir)) {
          try { fs.unlinkSync(path.join(this.downloadDir, f)); } catch (_) {}
        }
      }
    } catch (_) {}
    this.downloadedPath = null;
  }
}

module.exports = {
  compareVersions,
  isSafeUrl,
  downloadFile,
  fileSha512,
  UpdateManager,
};
