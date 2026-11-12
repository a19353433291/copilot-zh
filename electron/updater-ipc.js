// 自动更新：主进程接入层
//
// 职责：
//   - 创建并持有 UpdateManager 单例
//   - 从 settings 读取源配置
//   - 向渲染进程推送状态
//   - 提供 IPC 接口

'use strict';

const path = require('path');
const { UpdateManager } = require('../src/core/update/updater');
const { listSources } = require('../src/core/update/sources');

/**
 * @param {object} ctx
 *   app            Electron app
 *   settings       Settings 实例
 *   mainWindow     主窗口引用 getter
 *   send           (channel, data) => void  向渲染进程推送
 */
function setupUpdater(ctx) {
  const { app, settings, getWindow, send, notifyTray } = ctx;

  let manager = null;
  let timer = null;

  /** 从 settings 组装更新源配置 */
  function readConfig() {
    const parseRepo = (s, fallback) => {
      const raw = String(s || '').trim() || fallback;
      const parts = raw.split('/');
      return { owner: parts[0] || '', repo: parts[1] || '' };
    };

    // 兜底：设置项若为空（例如旧版 settings.json 没有这些键、
    // 或用户手改坏了 JSON），回退到仓库默认值，
    // 避免出现「未配置源地址」这种对用户毫无意义的报错。
    const DEFAULT_REPO = 'a19353433291/copilot-zh';
    const gh = parseRepo(settings.get('updateGithubRepo'), DEFAULT_REPO);
    const gt = parseRepo(settings.get('updateGiteeRepo'), DEFAULT_REPO);

    let source = settings.get('updateSource');
    if (!['github', 'gitee', 'generic'].includes(source)) source = 'github';    // 选了自定义源但没填地址时，回退到 github，避免必然失败
    const customUrl = String(settings.get('updateCustomUrl') || '').trim();
    if (source === 'generic' && !customUrl) source = 'github';

    // source 已在上方校验过合法性

    // 自动回退：国内直连 GitHub 经常超时，检查失败时自动换另一个源重试。
    // 明确排除 generic（自定义源是用户特意指定的，不应被自动替换）。
    const fallbackSources = [];
    if (source === 'github' && gt.owner) fallbackSources.push('gitee');
    if (source === 'gitee' && gh.owner) fallbackSources.push('github');

    return {
      source,
      fallbackSources,
      channel: ['stable', 'beta'].includes(settings.get('updateChannel'))
        ? settings.get('updateChannel')
        : 'stable',
      github: gh,
      gitee: gt,
      generic: { baseUrl: customUrl },
    };
  }

  // 当前操作是否为后台自动触发（启动检查 / 定时检查）
  let backgroundOp = false;
  // 记录最近一次状态是否由后台操作产生。
  // 必须单独存一份：UI 有时会主动查询 update:status，
  // 那次查询发生在后台操作结束之后，backgroundOp 已复位，
  // 若不记住就会丢失「这是后台错误」的信息，导致错误行弹出来打扰用户。
  let lastStatusWasBackground = false;

  function ensureManager() {
    if (manager) return manager;
    manager = new UpdateManager({
      currentVersion: app.getVersion(),
      config: readConfig(),
      downloadDir: path.join(app.getPath('temp'), 'copilot-zh-update'),
      onStatus: (status) => {
        status.background = backgroundOp;
        lastStatusWasBackground = backgroundOp;
        send('update:status', status);
      },
      onLog: (text) => {
        send('update:log', { text, at: Date.now() });
      },
    });
    return manager;
  }

  /** 在后台模式下执行一个操作 */
  async function runInBackground(fn) {
    const prev = backgroundOp;
    backgroundOp = true;
    try {
      return await fn();
    } finally {
      backgroundOp = prev;
    }
  }

  /** 设置变化后重建 manager，让新配置生效 */
  function reconfigure() {
    const wasState = manager ? manager.state : 'idle';
    const prevDownloaded = manager ? manager.downloadedPath : null;
    manager = new UpdateManager({
      currentVersion: app.getVersion(),
      config: readConfig(),
      downloadDir: path.join(app.getPath('temp'), 'copilot-zh-update'),
      onStatus: (status) => send('update:status', status),
      onLog: (text) => send('update:log', { text, at: Date.now() }),
    });
    // 若之前已下载完成，保留下载状态（避免切换源后丢失已下载的包）
    if (prevDownloaded && wasState === 'ready') {
      manager.downloadedPath = prevDownloaded;
      manager.state = 'ready';
    }
  }

  /** 清理定时器 */
  function clearTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** 按设置重排定时检查 */
  function scheduleTimer() {
    clearTimer();
    const hours = Number(settings.get('updateCheckHours'));
    if (!hours || hours <= 0) return;

    const ms = hours * 3600 * 1000;
    timer = setInterval(async () => {
      try {
        const um = ensureManager();
        // 只在空闲时自动检查，避免打断正在进行的下载
        if (um.state === 'downloading' || um.state === 'ready') return;
        const r = await runInBackground(() => um.check());
        if (r.ok && r.hasUpdate) {
          send('update:available', {
            latestVersion: r.latestVersion,
            currentVersion: r.currentVersion,
            notes: r.notes,
          });
          if (typeof notifyTray === 'function') {
            notifyTray(`发现新版本 ${r.latestVersion}，可在设置中更新`);
          }
        }
      } catch (e) { /* 静默，避免后台检查打扰用户 */ }
    }, ms);
    // 不阻止进程退出
    if (timer.unref) timer.unref();
  }

  return {
    /** 暴露给 IPC 的方法 */
    getStatus() {
      const um = ensureManager();
      const st = um.getStatus();
      // 补回「这条状态是否来自后台自动检查」
      st.background = lastStatusWasBackground;
      return st;
    },

    async check() {
      const um = ensureManager();
      // 用户主动检查：全程保持非后台标记，确保错误能正常展示给用户
      const prev = backgroundOp;
      backgroundOp = false;
      try {
        return await um.check();
      } finally {
        backgroundOp = prev;
        // 主动检查产生的状态永远不属于「后台」
        lastStatusWasBackground = false;
      }
    },

    async download() {
      const um = ensureManager();
      const r = await um.download();
      if (r.ok) {
        send('update:ready', { path: r.path, size: r.size });
      }
      return r;
    },

    install() {
      const um = ensureManager();
      return um.install(() => {
        try { app.quit(); } catch (e) {}
      });
    },

    /** 取消下载 / 清理临时文件 */
    cancel() {
      const um = ensureManager();
      um.cleanup();
      um.state = 'idle';
      send('update:status', um.getStatus());
      return { ok: true };
    },

    /** 列出可用源（供 UI 展示） */
    listSources() {
      return listSources(readConfig());
    },

    /** 设置变化时调用 */
    onSettingsChanged(changed) {
      const updateKeys = ['updateSource', 'updateGithubRepo', 'updateGiteeRepo', 'updateCustomUrl', 'updateCheckHours'];
      if (changed.some(k => updateKeys.includes(k))) {
        reconfigure();
      }
      if (changed.includes('updateCheckHours')) {
        scheduleTimer();
      }
    },

    /** 应用启动后调用 */
    onAppReady() {
      ensureManager();
      scheduleTimer();

      if (settings.get('checkUpdateOnStart')) {
        // 延迟 5 秒，让界面先完成首屏渲染
        const t = setTimeout(async () => {
          try {
            const um = ensureManager();
            const r = await runInBackground(() => um.check());
            if (r.ok && r.hasUpdate) {
              send('update:available', {
                latestVersion: r.latestVersion,
                currentVersion: r.currentVersion,
                notes: r.notes,
              });
            }
          } catch (e) { /* 静默 */ }
        }, 5000);
        if (t.unref) t.unref();
      }
    },

    dispose() {
      clearTimer();
      if (manager) manager.cleanup();
    },
  };
}

module.exports = { setupUpdater };
