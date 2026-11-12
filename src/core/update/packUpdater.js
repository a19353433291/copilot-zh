// 字典包在线更新。
//
// 与软件更新的复用关系：
//   两者都从同一个 Release 读取资产，但有两点不同：
//   1. 字典包只是数据，不需要重启应用，下载后热加载即可
//   2. 字典包有独立版本号与 Ed25519 签名，必须验签通过才安装
//
// 查找顺序：
//   优先找 Release 附件中形如 packs-zh-CN-x.y.z.zip 的文件；
//   若没有，则退化为读取仓库内 bundled-packs/manifest.json 的版本。

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSource, request } = require('./sources');
const { compareVersions } = require('./updater');

/** 从构建产物目录打一个 zip（仅依赖 Node 内置能力不够，改用目录复制策略） */
async function downloadToFile(url, destPath, onProgress = () => {}) {
  const https = require('https');
  const httpMod = require('http');

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  return new Promise((resolve, reject) => {
    let redirects = 0;
    const go = (target) => {
      let u;
      try { u = new URL(target); } catch (e) { return reject(new Error('无效 URL')); }
      const mod = u.protocol === 'https:' ? https : httpMod;

      const req = mod.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'CopilotHan-Updater/1.0' },
        timeout: 60000,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects++ >= 5) return reject(new Error('重定向过多'));
          return go(new URL(res.headers.location, target).toString());
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        const chunks = [];
        res.on('data', (c) => {
          chunks.push(c);
          got += c.length;
          if (total) onProgress(got, total);
        });
        res.on('end', () => {
          try {
            fs.writeFileSync(destPath, Buffer.concat(chunks));
            resolve({ ok: true, path: destPath, size: got });
          } catch (e) { reject(e); }
        });
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('下载超时')));
      req.on('error', reject);
      req.end();
    };
    go(url);
  });
}

class PackUpdater {
  /**
   * @param {object} opts
   *   config       更新源配置
   *   currentPack  当前已安装的字典包 meta（含 packVersion）
   *   downloadDir  临时下载目录
   *   onLog        日志回调
   */
  constructor(opts) {
    this.config = opts.config || {};
    this.currentPack = opts.currentPack || null;
    this.downloadDir = opts.downloadDir || path.join(os.tmpdir(), 'copilot-zh-pack-update');
    this.onLog = opts.onLog || (() => {});
  }

  /**
   * 检查字典包更新。
   * @returns {{ok:boolean, hasUpdate?:boolean, latestVersion?:string, currentVersion?:string, reason?:string}}
   */
  async check() {
    const sourceId = this.config.source || 'github';
    const src = createSource(sourceId, this.config);
    if (!src) return { ok: false, reason: '更新源未配置' };

    this.onLog(`通过 ${src.displayName} 检查字典包更新…`);

    let latest;
    try {
      latest = await src.fetchLatest((m) => this.onLog(m));
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    if (!latest.ok) return latest;

    // 在 Release 附件里找字典包
    // 约定命名：packs-zh-CN-<version>.zip 或 zh-CN-<version>.zip
    const assets = latest.assets || {};
    // fetchLatest 目前只返回 exe 与 yml，需要额外查一次资产列表
    const packAsset = await this._findPackAsset(src, latest);

    const currentVersion = this.currentPack ? this.currentPack.packVersion : null;

    if (!packAsset) {
      return {
        ok: true,
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
        reason: '该 Release 未提供字典包',
      };
    }

    const latestVersion = packAsset.version;

    if (!currentVersion) {
      return {
        ok: true,
        hasUpdate: true,
        currentVersion: null,
        latestVersion,
        downloadUrl: packAsset.url,
        size: packAsset.size,
        reason: '尚未安装字典包',
      };
    }

    const cmp = compareVersions(latestVersion, currentVersion);
    return {
      ok: true,
      hasUpdate: cmp > 0,
      currentVersion,
      latestVersion,
      downloadUrl: packAsset.url,
      size: packAsset.size,
    };
  }

  /**
   * 在 Release 资产中查找字典包。
   * 由于 sources.js 的 fetchLatest 只挑 exe 与 yml，
   * 这里单独请求一次资产列表。
   */
  async _findPackAsset(src, latest) {
    let assets = [];
    try {
      if (src.id === 'github') {
        const api = `https://api.github.com/repos/${src.owner}/${src.repo}/releases/tags/v${latest.version}`;
        const data = await require('./sources').requestJson(api, {
          headers: { 'Accept': 'application/vnd.github+json' },
        });
        assets = (data.assets || []).map(a => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
        }));
      } else if (src.id === 'gitee') {
        const api = `https://gitee.com/api/v5/repos/${src.owner}/${src.repo}/releases/tags/v${latest.version}`;
        const data = await require('./sources').requestJson(api);
        assets = (data.assets || []).map(a => ({
          name: a.name,
          url: a.browser_download_url || a.download_url,
          size: a.size,
        }));
      }
    } catch (e) {
      this.onLog('读取资产列表失败：' + e.message);
      return null;
    }

    // 匹配形如 packs-zh-CN-1.7.0.zip / zh-CN-1.7.0.zip
    const re = /(?:packs-)?zh-CN-(\d+\.\d+\.\d+)\.zip$/i;
    for (const a of assets) {
      const m = a.name.match(re);
      if (m) {
        return { version: m[1], url: a.url, size: a.size, name: a.name };
      }
    }
    return null;
  }

  /**
   * 下载字典包到临时目录。
   * 注意：安装需要解包，这里只负责下载与基本校验。
   */
  async download(url, version) {
    if (!url) return { ok: false, reason: '没有可用的下载地址' };
    const dest = path.join(this.downloadDir, `zh-CN-${version}.zip`);
    this.onLog('下载字典包…');
    try {
      const r = await downloadToFile(url, dest, (got, total) => {
        const pct = Math.round((got / total) * 100);
        if (pct % 25 === 0) this.onLog(`下载中 ${pct}%`);
      });
      return r;
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  cleanup() {
    try {
      if (fs.existsSync(this.downloadDir)) {
        for (const f of fs.readdirSync(this.downloadDir)) {
          try { fs.unlinkSync(path.join(this.downloadDir, f)); } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

module.exports = { PackUpdater, downloadToFile };
