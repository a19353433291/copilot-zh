// 更新源适配器：把不同托管平台统一成同一套接口。
//
// 为什么不用 electron-updater：
//   它的 GitHub provider 会去请求 raw.githubusercontent.com，
//   而实测该域名在本机完全不可达（超时 12 秒）。
//   这里自己实现「查版本 + 拼下载地址」，只依赖 api.github.com 与 gitee.com/api。
//
// 每个源需要实现：
//   fetchLatest() → { ok, version, notes, publishedAt, assets: { yml, exe } }
//   其中 assets.yml 是 latest.yml 的原始文本（含各文件 sha512），
//   assets.exe 是安装包下载地址。

'use strict';

const https = require('https');
const http = require('http');

const USER_AGENT = 'CopilotHan-Updater/1.0';

/**
 * 发起 HTTP(S) 请求，返回 { status, headers, body(Buffer) }。
 * 统一超时、重定向、UA，避免各源各写一套。
 */
function request(url, opts = {}) {
  const {
    timeout = 20000,
    maxRedirects = 5,
    headers = {},
    onProgress = null,
    method = 'GET',
  } = opts;

  return new Promise((resolve, reject) => {
    let redirects = 0;

    const doRequest = (targetUrl) => {
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch (e) {
        return reject(new Error('无效的 URL: ' + targetUrl));
      }

      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? https : http;

      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          ...headers,
        },
        timeout,
      }, (res) => {
        // 重定向
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects++ >= maxRedirects) {
            return reject(new Error('重定向次数过多'));
          }
          const next = new URL(res.headers.location, targetUrl).toString();
          return doRequest(next);
        }

        const chunks = [];
        let received = 0;
        const total = Number(res.headers['content-length'] || 0);

        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          if (onProgress && total > 0) {
            onProgress(received, total);
          }
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      });

      req.on('timeout', () => {
        req.destroy(new Error('请求超时（' + timeout + 'ms）'));
      });
      req.on('error', reject);
      req.end();
    };

    doRequest(url);
  });
}

/** 请求并解析 JSON */
async function requestJson(url, opts = {}) {
  const r = await request(url, opts);
  if (r.status < 200 || r.status >= 300) {
    throw new Error('HTTP ' + r.status);
  }
  try {
    return JSON.parse(r.body.toString('utf8'));
  } catch (e) {
    throw new Error('响应不是合法 JSON');
  }
}

/** 从 latest.yml 里解析出安装包文件名与 sha512 */
function parseYml(text) {
  const out = { version: null, path: null, sha512: null, size: null, files: [] };

  // 只解析顶层键：取第一个出现的，且必须是行首无缩进
  const get = (key) => {
    const m = text.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  };

  out.version = get('version');
  out.path = get('path');
  // 注意：files 段内也有 sha512 和 size，必须只取顶层那个。
  // 由于顶层字段在 files 段之前，第一次匹配就是顶层值。
  const topSha = text.match(/^sha512:\s*(.+)$/m);
  out.sha512 = topSha ? topSha[1].trim().replace(/^['"]|['"]$/g, '') : null;

  const topSize = text.match(/^size:\s*(\d+)\s*$/m);
  if (topSize) out.size = Number(topSize[1]);

  // files 是列表，逐项提取
  const filesBlock = text.split(/^files:\s*$/m)[1];
  if (filesBlock) {
    // files 段到下一个顶层键（无缩进）结束
    const endIdx = filesBlock.search(/^[a-zA-Z]/m);
    const block = endIdx >= 0 ? filesBlock.slice(0, endIdx) : filesBlock;
    const items = block.split(/^\s*-\s+/m).slice(1);
    for (const it of items) {
      const url = (it.match(/url:\s*(.+)/) || [])[1];
      const sha = (it.match(/sha512:\s*(.+)/) || [])[1];
      const sz = (it.match(/size:\s*(\d+)/) || [])[1];
      if (url) {
        out.files.push({
          url: url.trim().replace(/^['"]|['"]$/g, ''),
          sha512: sha ? sha.trim().replace(/^['"]|['"]$/g, '') : null,
          size: sz ? Number(sz) : null,
        });
      }
    }
  }

  // 若顶层没给 size，回退到 files 里第一个
  if (out.size === null && out.files.length && out.files[0].size) {
    out.size = out.files[0].size;
  }

  return out;
}

/**
 * GitHub 源。
 * 通过 api.github.com 查最新 Release，从 assets 里找 latest.yml 与 exe。
 * 注意：下载走 browser_download_url（github.com 域），不走 raw.githubusercontent.com。
 */
class GitHubSource {
  constructor({ owner, repo, token = null }) {
    this.id = 'github';
    this.displayName = 'GitHub';
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  /**
   * @param {(msg:string)=>void} onLog 可选日志回调
   */
  async fetchLatest(onLog = () => {}) {
    const api = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

    onLog('查询 GitHub 最新版本…');
    let data;
    try {
      data = await requestJson(api, { headers, timeout: 20000 });
    } catch (e) {
      if (String(e.message).includes('404')) {
        return { ok: false, reason: '该仓库还没有发布任何 Release' };
      }
      return { ok: false, reason: '查询失败：' + e.message };
    }

    const tag = String(data.tag_name || '').replace(/^v/i, '');
    if (!tag) return { ok: false, reason: 'Release 缺少版本号' };

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const ymlAsset = assets.find(a => /^latest.*\.yml$/.test(a.name));
    const exeAsset = assets.find(a => /\.exe$/i.test(a.name));

    if (!ymlAsset || !exeAsset) {
      return { ok: false, reason: 'Release 缺少 latest.yml 或安装包' };
    }

    // 下载 latest.yml 内容用于校验
    onLog('下载版本元数据…');
    let ymlText = '';
    try {
      const r = await request(ymlAsset.browser_download_url, { timeout: 20000 });
      if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
      ymlText = r.body.toString('utf8');
    } catch (e) {
      return { ok: false, reason: '下载 latest.yml 失败：' + e.message };
    }

    const meta = parseYml(ymlText);

    return {
      ok: true,
      version: tag,
      notes: data.body || '',
      publishedAt: data.published_at || null,
      htmlUrl: data.html_url || '',
      assets: {
        exeUrl: exeAsset.browser_download_url,
        exeName: exeAsset.name,
        exeSize: exeAsset.size,
        sha512: meta.sha512,
        ymlUrl: ymlAsset.browser_download_url,
        ymlText,
      },
    };
  }
}

/**
 * Gitee 源。
 * Gitee 的 Release API 与 GitHub 类似，资产下载走 gitee.com 域。
 */
class GiteeSource {
  constructor({ owner, repo, token = null }) {
    this.id = 'gitee';
    this.displayName = 'Gitee';
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  async fetchLatest(onLog = () => {}) {
    const base = `https://gitee.com/api/v5/repos/${this.owner}/${this.repo}/releases/latest`;
    const url = this.token ? base + '?access_token=' + encodeURIComponent(this.token) : base;

    onLog('查询 Gitee 最新版本…');
    let data;
    try {
      data = await requestJson(url, { timeout: 20000 });
    } catch (e) {
      if (String(e.message).includes('404')) {
        return { ok: false, reason: '该仓库还没有发布任何 Release' };
      }
      return { ok: false, reason: '查询失败：' + e.message };
    }

    const tag = String(data.tag_name || '').replace(/^v/i, '');
    if (!tag) return { ok: false, reason: 'Release 缺少版本号' };

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const ymlAsset = assets.find(a => /^latest.*\.yml$/.test(a.name));
    const exeAsset = assets.find(a => /\.exe$/i.test(a.name));

    if (!ymlAsset || !exeAsset) {
      return { ok: false, reason: 'Release 缺少 latest.yml 或安装包' };
    }

    const ymlUrl = ymlAsset.browser_download_url || ymlAsset.download_url;
    const exeUrl = exeAsset.browser_download_url || exeAsset.download_url;

    onLog('下载版本元数据…');
    let ymlText = '';
    try {
      const r = await request(ymlUrl, { timeout: 20000 });
      if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
      ymlText = r.body.toString('utf8');
    } catch (e) {
      return { ok: false, reason: '下载 latest.yml 失败：' + e.message };
    }

    const meta = parseYml(ymlText);

    return {
      ok: true,
      version: tag,
      notes: data.body || '',
      publishedAt: data.created_at || null,
      htmlUrl: data.html_url || '',
      assets: {
        exeUrl,
        exeName: exeAsset.name,
        exeSize: exeAsset.size,
        sha512: meta.sha512,
        ymlUrl,
        ymlText,
      },
    };
  }
}

/**
 * 自定义源：直接给 baseUrl，按约定读取 latest.yml。
 * 用于自建服务器或镜像站。
 */
class GenericSource {
  constructor({ baseUrl }) {
    this.id = 'generic';
    this.displayName = '自定义源';
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  }

  async fetchLatest(onLog = () => {}) {
    if (!this.baseUrl) return { ok: false, reason: '未配置源地址' };
    const ymlUrl = this.baseUrl + '/latest.yml';

    onLog('查询自定义源…');
    let ymlText = '';
    try {
      const r = await request(ymlUrl, { timeout: 20000 });
      if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
      ymlText = r.body.toString('utf8');
    } catch (e) {
      return { ok: false, reason: '下载 latest.yml 失败：' + e.message };
    }

    const meta = parseYml(ymlText);
    if (!meta.version) return { ok: false, reason: 'latest.yml 缺少 version' };
    if (!meta.path) return { ok: false, reason: 'latest.yml 缺少安装包文件名' };

    return {
      ok: true,
      version: meta.version,
      notes: '',
      publishedAt: null,
      htmlUrl: this.baseUrl,
      assets: {
        exeUrl: this.baseUrl + '/' + meta.path,
        exeName: meta.path,
        exeSize: meta.size,
        sha512: meta.sha512,
        ymlUrl,
        ymlText,
      },
    };
  }
}

/** 可用源的清单（供 UI 展示） */
function listSources(config) {
  const out = [];
  if (config.github && config.github.owner) {
    out.push({ id: 'github', displayName: 'GitHub', enabled: true });
  }
  if (config.gitee && config.gitee.owner) {
    out.push({ id: 'gitee', displayName: 'Gitee', enabled: true });
  }
  if (config.generic && config.generic.baseUrl) {
    out.push({ id: 'generic', displayName: '自定义源', enabled: true });
  }
  return out;
}

/** 按 id 创建源实例 */
function createSource(id, config) {
  const cfg = config || {};
  switch (id) {
    case 'github':
      return new GitHubSource(cfg.github || {});
    case 'gitee':
      return new GiteeSource(cfg.gitee || {});
    case 'generic':
      return new GenericSource(cfg.generic || {});
    default:
      return null;
  }
}

module.exports = {
  request,
  requestJson,
  parseYml,
  GitHubSource,
  GiteeSource,
  GenericSource,
  listSources,
  createSource,
};
