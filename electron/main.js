// Electron 主进程：创建窗口、暴露安全的 IPC 接口。
// 渲染进程不能直接访问文件系统 / 注册表，全部通过这里代理。

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const { locateApp, readFileVersion } = require('../src/core/locator');
const pack = require('../src/core/dict/pack');
const cleanup = require('../src/core/cleanup');
const { Settings } = require('../src/core/settings');
const { Watcher } = require('../src/core/watcher');
const { applyOneClick } = require('../src/core/applyFlow');
const { scheduleDeleteAfterExit } = require('../src/core/delayedDelete');
const autostart = require('../src/core/autostart');
const { createEngines, supportedPlatforms } = require('../src/core/platform/engine');
const { registerWin32 } = require('../src/core/platform/win32');
const cdpWin = require('../src/core/platform/win32/runtimeInject');
const { setupUpdater } = require('./updater-ipc');

// 注册当前平台实现（跨平台扩展点）
if (process.platform === 'win32') registerWin32();

let mainWindow = null;
let tray = null;
let settings = null;
let watcher = null;
let updater = null;
let isQuitting = false;

// 产品显示名（安装包、窗口标题用）
const PRODUCT_NAME = 'Copilot 汉化助手';

/**
 * 固定用户数据目录为 %APPDATA%\copilot-zh。
 *
 * 重要：不能让 Electron 用 app.getName() 自动推导。
 * 因为 productName 是中文时，userData 会变成中文目录
 * （%APPDATA%\Copilot 汉化助手），用户升级后旧字典「消失」。
 * 显式固定后，产品改名不影响数据位置。
 */
const USER_DIR = path.join(app.getPath('appData'), 'copilot-zh');
app.setPath('userData', USER_DIR);

const PACKS_DIR = path.join(USER_DIR, 'packs');
const CURRENT_PACK = path.join(PACKS_DIR, 'current');

function ensureDirs() {
  for (const d of [USER_DIR, PACKS_DIR, path.join(USER_DIR, 'logs'), path.join(USER_DIR, 'backups')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/**
 * 首次启动时安装随包分发的内置字典。
 * 已存在用户字典时不覆盖，避免升级安装包冲掉用户的更新版本。
 */
function bootstrapBundledPack() {
  if (fs.existsSync(path.join(CURRENT_PACK, 'manifest.json'))) return { installed: false, reason: 'already-present' };

  // 开发模式与安装后的资源路径不同，逐一尝试
  const candidates = [
    path.join(process.resourcesPath || '', 'packs'),          // 安装后：resources/packs
    path.join(__dirname, '..', 'bundled-packs'),              // 开发模式
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    const r = pack.loadPack(dir);
    if (!r.ok) continue;
    fs.mkdirSync(CURRENT_PACK, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      const s = path.join(dir, f);
      if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(CURRENT_PACK, f));
    }
    return { installed: true, version: r.meta.packVersion, from: dir };
  }
  return { installed: false, reason: 'bundled-pack-not-found' };
}

/**
 * 让 Windows 原生标题栏跟随应用主题。
 *
 * 背景：原生标题栏由系统绘制，CSS 无法控制。
 *   Electron 的 nativeTheme.themeSource 会告诉系统用浅色还是深色渲染
 *   窗口边框、标题栏、系统菜单。
 *
 * 映射：
 *   theme = light   → nativeTheme.themeSource = 'light'
 *   theme = dark    → nativeTheme.themeSource = 'dark'
 *   theme = system  → nativeTheme.themeSource = 'system'（跟随 Windows）
 *
 * @param {string} theme
 */
function applyNativeTheme(theme) {
  const map = { light: 'light', dark: 'dark', system: 'system' };
  const source = map[theme] || 'system';
  try {
    nativeTheme.themeSource = source;
  } catch (e) { /* 忽略，不影响功能 */ }

  const dark = source === 'dark' ||
    (source === 'system' && nativeTheme.shouldUseDarkColors);

  if (mainWindow && !mainWindow.isDestroyed()) {
    // 窗口背景色：与页面底色一致，避免加载瞬间闪色
    try {
      mainWindow.setBackgroundColor(dark ? '#1C1C1E' : '#F6F6F6');
    } catch (e) { /* ignore */ }

    // 原生控制按钮浮层：背景色与符号色跟随主题
    try {
      const api = mainWindow.setTitleBarOverlay || mainWindow.setTitleBarOverlay;
      if (typeof api === 'function') {
        api.call(mainWindow, {
          color: dark ? '#1C1C1E' : '#F6F6F6',
          symbolColor: dark ? '#F5F5F7' : '#35353A',
          height: 40,
        });
      }
    } catch (e) { /* 旧版本 Electron 可能不支持运行时更新 */ }
  }
}

function createWindow() {
  // 创建窗口前先设定主题，确保标题栏从一开始就是正确的颜色
  const initialTheme = settings ? settings.get('theme') : 'system';
  applyNativeTheme(initialTheme);

  const useDark = initialTheme === 'dark' ||
    (initialTheme === 'system' && nativeTheme.shouldUseDarkColors);

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: PRODUCT_NAME + ' — GitHub Copilot 汉化工具',
    backgroundColor: useDark ? '#1C1C1E' : '#F6F6F6',
    show: false,
    /* ------------------------------------------------------------------
       无边框窗口 + 原生控制按钮浮层
       ------------------------------------------------------------------
       titleBarStyle: 'hidden' 隐藏系统标题栏，页面内容可延伸到窗口顶部；
       titleBarOverlay 保留 Windows 的最小化/最大化/关闭按钮，
       并让它们浮在页面右上角，颜色跟随主题。

       效果：侧边栏直接顶到窗口边缘，和 Windows 控制栏融为一体，
       右侧内容区像一个浮在背景上的页面 —— 与 Qoder 的布局一致。
       ------------------------------------------------------------------ */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: useDark ? '#1C1C1E' : '#F6F6F6',
      symbolColor: useDark ? '#F5F5F7' : '#35353A',
      height: 40,
    },
    // 窗口图标（任务栏显示）
    icon: (() => {
      const fs2 = require('fs');
      const png = path.join(__dirname, '..', 'build', 'icon.png');
      const ico = path.join(__dirname, '..', 'build', 'icon.ico');
      if (fs2.existsSync(png)) return png;
      if (fs2.existsSync(ico)) return ico;
      return undefined;
    })(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    // 开机自启时静默启动，不弹窗打扰用户
    const silent = process.argv.includes('--hidden');
    if (!silent) mainWindow.show();
  });

  // 关闭窗口 → 最小化到托盘（常驻模式必需，否则监控会停）
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (settings && settings.get('minimizeToTray')) {
      e.preventDefault();
      mainWindow.hide();
      notifyTray('已最小化到托盘，汉化监控继续运行');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** 托盘气泡提示 */
/** 把 "owner/repo" 拆成 { owner, repo } */
function splitRepo(s) {
  const parts = String(s || '').split('/');
  return { owner: parts[0] || '', repo: parts[1] || '' };
}

function notifyTray(text) {
  if (tray && tray.displayBalloon) {
    try { tray.displayBalloon({ title: PRODUCT_NAME, content: text }); } catch (e) { /* ignore */ }
  }
}

/**
 * 创建系统托盘图标。
 *
 * 图标选择策略：
 *   - 优先用 PNG：Electron 在 Windows 上对 PNG 托盘的缩放更准确，
 *     ICO 有时会被系统按 32x32 渲染再缩小，导致模糊。
 *   - 按 DPI 选尺寸：150% 缩放下托盘实际用 24px，200% 用 32px。
 *   - 找不到 build 目录时回退到 ICO，再回退到无图标（不报错）。
 */
function createTray() {
  const fs = require('fs');
  const buildDir = path.join(__dirname, '..', 'build');

  // 按当前屏幕缩放比例选择托盘图标尺寸
  let scale = 1;
  try {
    const { screen } = require('electron');
    scale = screen.getPrimaryDisplay().scaleFactor || 1;
  } catch (e) { /* 忽略 */ }

  // 目标显示尺寸：Windows 托盘基准 16px
  const targetPx = Math.round(16 * scale);
  const candidates = [
    path.join(buildDir, `tray-${targetPx}.png`),
    path.join(buildDir, 'icon-tray.png'),
    path.join(buildDir, 'tray-32.png'),
    path.join(buildDir, 'tray-16.png'),
    path.join(buildDir, 'icon.ico'),
  ];

  let trayIcon = null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      trayIcon = p.endsWith('.ico') ? p : nativeImage.createFromPath(p);
      if (trayIcon && trayIcon.isEmpty && trayIcon.isEmpty()) { trayIcon = null; continue; }
      break;
    } catch (e) {
      trayIcon = null;
    }
  }

  if (!trayIcon) return;

  try {
    tray = new Tray(trayIcon);
  } catch (e) {
    return;
  }
  tray.setToolTip(PRODUCT_NAME);

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    {
      label: '常驻监控：' + (watcher && watcher.status().enabled ? '已开启' : '已关闭'),
      enabled: false,
    },
    {
      label: (watcher && watcher.status().injected) ? 'Copilot 汉化：已生效' : 'Copilot 汉化：未生效',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '立即汉化当前 Copilot',
      click: async () => { await injectNow(); },
    },
    {
      label: '启动 GitHub Copilot',
      click: () => { launchCopilot(); },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(buildMenu());
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });

  // 菜单项状态会随时间变化，定时刷新
  setInterval(() => {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
  }, 3000).unref?.();
}

/** 启动 GitHub Copilot 主程序 */
/**
 * 启动 GitHub Copilot 主程序。
 *
 * 注意工作目录的选择：
 *   不要用 path.dirname(exePath) 作为 cwd。
 *   当上一个 Copilot 进程刚被 taskkill、文件锁尚未完全释放时，
 *   以该目录为 cwd 启动会抛 EBUSY（目录被占用）。
 *   改用系统临时目录作为 cwd，避免与 Copilot 自身文件产生锁竞争。
 *
 * 同时增加重试：进程刚退出后的极短时间内，shell 层仍可能短暂占用目录。
 */
async function launchCopilot() {
  const loc = await locateApp();
  if (!loc.ok) return { ok: false, reason: loc.reason };

  const { spawn } = require('child_process');
  const os = require('os');

  const spawnOnce = () => new Promise((resolve) => {
    try {
      const child = spawn(loc.exePath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: os.tmpdir(),      // 关键：不要用 Copilot 安装目录
        windowsHide: false,
      });
      // spawn 的失败是异步的，需要监听 error
      let settled = false;
      child.once('error', (err) => {
        if (!settled) { settled = true; resolve({ ok: false, reason: err.message }); }
      });
      child.once('spawn', () => {
        if (!settled) {
          settled = true;
          child.unref();
          resolve({ ok: true, exePath: loc.exePath });
        }
      });
      // 兜底：1 秒内既没 error 也没 spawn 事件，视为成功
      setTimeout(() => {
        if (!settled) { settled = true; child.unref(); resolve({ ok: true, exePath: loc.exePath }); }
      }, 1000);
    } catch (e) {
      resolve({ ok: false, reason: e.message });
    }
  });

  // 最多重试 3 次，每次间隔递增，应对文件锁尚未释放的瞬间
  let last = { ok: false, reason: 'unknown' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
    last = await spawnOnce();
    if (last.ok) return last;
    // 只对 EBUSY / EPERM / UNKNOWN 这类瞬时错误重试
    if (last.reason && !/EBUSY|EPERM|UNKNOWN|resource busy/i.test(last.reason)) break;
  }
  return last;
}

/** 立即对当前运行的 Copilot 执行一次注入 */
async function injectNow() {
  if (!watcher) return { ok: false, reason: '监控器未初始化' };
  const st = watcher.status();
  if (!st.copilotRunning) return { ok: false, reason: 'GitHub Copilot 未运行' };
  try {
    return await watcher.forceInject();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * 初始化常驻监控器。
 * 字典从当前已安装的字典包实时读取，因此字典更新无需重启监控。
 */
function initWatcher() {
  const engines = createEngines();
  const engine = engines.find(e => e.id === 'runtime-inject');
  if (!engine) return;

  watcher = new Watcher({
    engine,
    getDict: () => {
      try {
        if (!fs.existsSync(path.join(CURRENT_PACK, 'manifest.json'))) return null;
        const r = pack.loadPack(CURRENT_PACK);
        return r.ok ? r.dict : null;
      } catch (e) {
        return null;
      }
    },
    isEnabled: () => !!(settings && settings.get('autoInjectOnStart')),
    getInterval: () => (settings ? settings.get('watchIntervalMs') : 1500),
  });

  // 转发状态变更到界面
  const forward = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:status', watcher.status());
    }
  };
  watcher.on('status', forward);
  watcher.on('injected', (info) => {
    forward();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:injected', info);
    }
    if (mainWindow && !mainWindow.isVisible()) {
      notifyTray(`已自动汉化 Copilot（${info.replaced} 处）`);
    }
  });
  watcher.on('error', (e) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:error', e);
    }
  });

  // 策略刚写入：提示用户重启 Copilot 才能生效
  watcher.on('policy-written', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:policy-written', info);
    }
    notifyTray('已开启调试端口，请重启 GitHub Copilot 一次以完成汉化');
  });

  watcher.start();
}

app.whenReady().then(async () => {
  ensureDirs();
  bootstrapBundledPack();

  settings = new Settings(USER_DIR);

  // 以注册表实际状态为准，防止设置与实际不一致（异步，不阻塞启动）
  try {
    const realAutoStart = await autostart.isEnabled();
    if (realAutoStart !== settings.get('runAtLogin')) {
      settings.set({ runAtLogin: realAutoStart });
    }
  } catch (e) { /* 忽略，不影响启动 */ }

  createWindow();
  createTray();
  initWatcher();

  // 自动更新：初始化管理器并安排启动检查与定时检查
  try {
    updater = setupUpdater({
      app,
      settings,
      send: (channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channel, data);
        }
      },
      notifyTray: (text) => notifyTray(text),
    });
    updater.onAppReady();
  } catch (e) {
    console.error('更新模块初始化失败:', e.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (watcher) watcher.stop();
  if (updater) {
    try { updater.dispose(); } catch (e) { /* ignore */ }
  }
});

app.on('window-all-closed', () => {
  // 常驻模式下不退出：窗口关闭只是隐藏
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

// ---------------------------------------------------------------------------
// IPC：运行环境信息
// ---------------------------------------------------------------------------

ipcMain.handle('env:info', async () => {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    supportedPlatforms: supportedPlatforms(),
    userDir: USER_DIR,
    packsDir: PACKS_DIR,
  };
});

// ---------------------------------------------------------------------------
// IPC：设置
// ---------------------------------------------------------------------------

ipcMain.handle('settings:get', async () => {
  return {
    data: settings.getAll(),
    defaults: Settings.defaults,
    autostartSupported: autostart.isSupported(),
    // 异步读取，避免阻塞主进程
    autostartReal: await autostart.isEnabled(),
    watcher: watcher ? watcher.status() : null,
  };
});

ipcMain.handle('settings:set', async (_e, patch) => {
  const r = settings.set(patch);

  // 开机自启需同步注册表（异步）
  if (r.changed.includes('runAtLogin')) {
    const want = settings.get('runAtLogin');
    const a = await autostart.setEnabled(want, process.execPath);
    if (!a.ok) {
      // 回滚设置，保持与真实状态一致
      settings.set({ runAtLogin: !want });
      return { ok: false, reason: '设置开机自启失败：' + (a.reason || '未知') };
    }
  }

  // 监控开关变化：立即生效
  if (r.changed.includes('autoInjectOnStart') && watcher) {
    if (settings.get('autoInjectOnStart')) {
      if (!watcher.running) watcher.start();
    }
  }

  // 主题变化：同步 Windows 原生标题栏与窗口背景色
  if (r.changed.includes('theme')) {
    applyNativeTheme(settings.get('theme'));
  }

  // 更新相关设置变化：重建源配置 / 重排定时检查
  if (updater) {
    try { updater.onSettingsChanged(r.changed); } catch (e) { /* ignore */ }
  }

  return { ok: true, changed: r.changed, data: settings.getAll() };
});

ipcMain.handle('settings:reset', async () => {
  const d = settings.reset();
  await autostart.setEnabled(d.runAtLogin, process.execPath);
  return { ok: true, data: d };
});

// ---------------------------------------------------------------------------
// IPC：常驻监控
// ---------------------------------------------------------------------------

ipcMain.handle('watcher:status', async () => (watcher ? watcher.status() : { running: false }));

ipcMain.handle('watcher:injectNow', async () => injectNow());

ipcMain.handle('watcher:launchCopilot', async () => launchCopilot());

// ---------------------------------------------------------------------------
// IPC：定位目标应用
// ---------------------------------------------------------------------------

ipcMain.handle('app:locate', async () => {
  const r = await locateApp();
  if (r.ok) {
    r.signature = await readSignature(r.exePath);
  }
  return r;
});

ipcMain.handle('app:choose', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择 GitHub Copilot 主程序',
    properties: ['openFile'],
    filters: [{ name: 'GitHub Copilot', extensions: ['exe'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, reason: 'cancelled' };
  const p = res.filePaths[0];
  return { ok: true, exePath: p, version: await readFileVersion(p), source: 'manual', signature: await readSignature(p) };
});

/**
 * 读取数字签名状态（异步，避免阻塞主进程）。
 */
function readSignature(exePath) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-AuthenticodeSignature -LiteralPath '${exePath.replace(/'/g, "''")}').Status`],
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve('Unknown');
        resolve(String(stdout || '').trim() || 'Unknown');
      });
  });
}

// ---------------------------------------------------------------------------
// IPC：引擎与状态
// ---------------------------------------------------------------------------

ipcMain.handle('engine:list', async () => {
  return createEngines().map(e => ({
    id: e.id,
    displayName: e.displayName,
    capabilities: e.capabilities(),
  }));
});

ipcMain.handle('engine:probe', async (_evt, { engineId, target }) => {
  const engine = createEngines().find(e => e.id === engineId);
  if (!engine) return { ok: false, reason: '未知引擎: ' + engineId };
  return engine.probe(target);
});

ipcMain.handle('engine:status', async (_evt, { engineId, target }) => {
  const engine = createEngines().find(e => e.id === engineId);
  if (!engine) return { state: 'unknown' };
  return engine.status(target);
});

ipcMain.handle('engine:apply', async (evt, { engineId, target, dict }) => {
  const engine = createEngines().find(e => e.id === engineId);
  if (!engine) return { ok: false, reason: '未知引擎: ' + engineId };

  const onProgress = (pct, msg) => {
    if (!evt.sender.isDestroyed()) evt.sender.send('engine:progress', { pct, msg });
  };

  try {
    // 模式 A 走「一键汉化」完整闭环：必要时重启 Copilot 让策略生效，
    // 并以翻译器实际存活作为成功判据，避免「已汉化却报失败」。
    if (engineId === 'runtime-inject') {
      const r = await applyOneClick({
        engine,
        target,
        dict,
        launchCopilot,
        findPids: require('../src/core/watcher').findCopilotPids,
        onProgress,
        allowRestart: settings ? settings.get('autoRestartCopilot') !== false : true,
      });
      if (r.ok) {
        // 注入成功后同步监控器状态，避免它以为还没注入又打一次
        if (watcher) watcher.markInjected();
      }
      return r;
    }

    // 其它引擎保持通用流程
    const r = await engine.apply(target, dict, { onProgress });
    let launched = null;
    if (r.ok && settings && settings.get('launchCopilotAfterApply')) {
      const st = watcher ? watcher.status() : null;
      if (!st || !st.copilotRunning) {
        const l = await launchCopilot();
        launched = l.ok ? { ok: true, exePath: l.exePath } : { ok: false, reason: l.reason };
      } else {
        launched = { ok: true, skipped: true, reason: 'Copilot 已在运行' };
      }
    }
    return { ...r, launched };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// ---------------------------------------------------------------------------
// IPC：权限与环境自检
// ---------------------------------------------------------------------------

ipcMain.handle('sys:check', async () => {
  // 全部异步读取，避免同步子进程调用阻塞主进程（曾导致 IPC 超时）
  const [elevated, policy] = await Promise.all([
    cdpWin.isElevatedAsync(),
    cdpWin.readPolicyAsync('github.exe'),
  ]);
  return {
    elevated,
    platform: process.platform,
    port: cdpWin.DEFAULT_PORT,
    policy,
  };
});

ipcMain.handle('sys:relaunchAsAdmin', async () => {
  // 以管理员身份重启自身
  if (process.platform !== 'win32') return { ok: false, reason: '仅支持 Windows' };
  const { execFile } = require('child_process');
  const exe = process.execPath;
  // Electron 开发模式下 process.execPath 是 electron.exe，需要带上应用路径
  const args = app.isPackaged ? [] : [path.resolve(__dirname, '..')];
  try {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '${args.join(' ').replace(/'/g, "''")}' -Verb RunAs`],
      { windowsHide: true, timeout: 10000 },
      () => { });
    setTimeout(() => { isQuitting = true; app.quit(); }, 600);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle('engine:revert', async (_evt, { engineId, target }) => {
  const engine = createEngines().find(e => e.id === engineId);
  if (!engine) return { ok: false, reason: '未知引擎: ' + engineId };
  try {
    const r = await engine.revert(target);

    // 按设置决定是否关闭 Copilot：
    // 还原只移除了策略，已注入的翻译仍在页面内存中，
    // 必须重启 Copilot 才会真正回到英文。
    let closedCopilot = null;
    if (r.ok && settings && settings.get('closeCopilotOnRevert')) {
      try {
        const pids = await require('../src/core/watcher').findCopilotPids();
        if (pids.length) {
          const { execFile } = require('child_process');
          await new Promise((resolve) => {
            execFile('taskkill', ['/IM', 'github.exe', '/T', '/F'],
              { timeout: 10000, windowsHide: true }, () => resolve());
          });
          closedCopilot = { ok: true, closed: true };
        } else {
          closedCopilot = { ok: true, closed: false, reason: 'Copilot 未运行' };
        }
      } catch (e) {
        closedCopilot = { ok: false, reason: e.message };
      }
    }

    // 同步监控器状态，避免界面仍显示「已汉化」
    if (watcher) watcher.markReverted();

    return { ...r, closedCopilot };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// ---------------------------------------------------------------------------
// IPC：字典包管理（与软件本体分离）
// ---------------------------------------------------------------------------

ipcMain.handle('pack:current', async () => {
  if (!fs.existsSync(path.join(CURRENT_PACK, 'manifest.json'))) {
    return { ok: false, reason: '尚未安装任何字典包' };
  }
  const r = pack.loadPack(CURRENT_PACK);
  if (!r.ok) return r;
  return {
    ok: true,
    meta: r.meta,
    counts: pack.countEntries(r.dict),
    dict: r.dict,
  };
});

ipcMain.handle('pack:importDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择字典包目录（含 manifest.json）',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, reason: 'cancelled' };
  return installPackFrom(res.filePaths[0]);
});

ipcMain.handle('pack:importFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择字典包文件（.zip 或 manifest.json）',
    properties: ['openFile'],
    filters: [{ name: '字典包', extensions: ['json', 'zip', 'cpz'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, reason: 'cancelled' };
  return { ok: false, reason: '暂只支持导入目录，zip 支持将在后续版本提供' };
});

function installPackFrom(srcDir) {
  const r = pack.loadPack(srcDir);
  if (!r.ok) return r;

  // 原子安装：先复制到临时目录，再替换 current
  const tmp = CURRENT_PACK + '.new';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(tmp, f));
  }
  fs.rmSync(CURRENT_PACK, { recursive: true, force: true });
  fs.renameSync(tmp, CURRENT_PACK);

  return { ok: true, meta: r.meta, counts: pack.countEntries(r.dict), dict: r.dict };
}

ipcMain.handle('pack:checkUpdate', async () => {
  // 字典包在线更新：从同一个 Release 里查找 packs-zh-CN-<版本>.zip
  try {
    const { PackUpdater } = require('../src/core/update/packUpdater');

    // 读当前已安装的字典包版本
    let currentMeta = null;
    try {
      const cur = path.join(PACKS_DIR, 'current', 'manifest.json');
      if (fs.existsSync(cur)) {
        const m = JSON.parse(fs.readFileSync(cur, 'utf8'));
        currentMeta = m.manifest || null;
      }
    } catch (e) { /* 忽略，视为未安装 */ }

    const cfg = {
      source: settings.get('updateSource'),
      github: splitRepo(settings.get('updateGithubRepo')),
      gitee: splitRepo(settings.get('updateGiteeRepo')),
      generic: { baseUrl: settings.get('updateCustomUrl') || '' },
    };

    const pu = new PackUpdater({
      config: cfg,
      currentPack: currentMeta,
      downloadDir: path.join(app.getPath('temp'), 'copilot-zh-pack-update'),
      onLog: () => {},
    });

    const r = await pu.check();
    pu.cleanup();
    return r;
  } catch (e) {
    return { ok: false, reason: '检查字典包更新失败：' + e.message };
  }
});

ipcMain.handle('pack:openFolder', async () => {
  shell.openPath(PACKS_DIR);
});

// ---------------------------------------------------------------------------
// IPC：自动更新
// ---------------------------------------------------------------------------

ipcMain.handle('update:status', async () => {
  if (!updater) return { state: 'idle', currentVersion: app.getVersion(), sourceId: 'github' };
  return updater.getStatus();
});

ipcMain.handle('update:check', async () => {
  if (!updater) return { ok: false, reason: '更新模块未初始化' };
  return updater.check();
});

ipcMain.handle('update:download', async () => {
  if (!updater) return { ok: false, reason: '更新模块未初始化' };
  return updater.download();
});

ipcMain.handle('update:install', async () => {
  if (!updater) return { ok: false, reason: '更新模块未初始化' };
  return updater.install();
});

ipcMain.handle('update:cancel', async () => {
  if (!updater) return { ok: false, reason: '更新模块未初始化' };
  return updater.cancel();
});

ipcMain.handle('update:sources', async () => {
  if (!updater) return [];
  return updater.listSources();
});

// ---------------------------------------------------------------------------
// IPC：残留审计与彻底清理
// ---------------------------------------------------------------------------

function traceOptions() {
  return {
    userDataDir: USER_DIR,
    tempDirs: [
      ['cache', path.join(app.getPath('temp'), 'copilot-zh')],
    ],
  };
}

ipcMain.handle('cleanup:audit', async () => {
  return cleanup.audit(traceOptions());
});

ipcMain.handle('cleanup:cleanAll', async () => {
  // 第 1 步：撤销引擎侧的汉化（移除调试端口策略等）
  const results = [];
  for (const e of createEngines()) {
    try { results.push({ engine: e.id, result: await e.revert({ exePath: '' }) }); }
    catch (err) { results.push({ engine: e.id, error: err.message }); }
  }

  // 第 2 步：清理所有可在当前进程内删除的痕迹
  // 注意：userData 目录（%APPDATA%\copilot-zh）被本进程占用，
  // 内部删除必然 EBUSY，会被标记为 deferred 交由退出后处理。
  const r = cleanup.cleanAll(traceOptions());

  // 第 3 步：为被占用的目录安排「退出后删除」
  let deferred = null;
  if (r.deferred && r.deferred.length) {
    deferred = scheduleDeleteAfterExit({
      dirs: r.deferred,
      waitMs: 1500,
      maxWaitSec: 30,
      logFile: path.join(app.getPath('temp'), 'copilot-zh-cleanup.log'),
    });
  }

  return {
    ok: r.ok,
    cleaned: r.cleaned,
    deferred: r.deferred || [],
    deferredScheduled: deferred && deferred.ok,
    deferredReason: deferred && deferred.reason,
    errors: r.errors,
    engines: results,
    // 告知界面：需要重启/退出才能完成最后一步
    needRestart: !!(r.deferred && r.deferred.length && deferred && deferred.ok),
  };
});

/** 关闭前执行延迟删除（供退出流程与其他入口复用） */
function scheduleCleanupOnExit() {
  const opts = traceOptions();
  const traces = cleanup.collectTraces(opts);
  const toDelete = [];
  for (const t of traces) {
    // 只处理目录类痕迹，且必须存在
    if (t.dirPath && fs.existsSync(t.dirPath)) toDelete.push(t.dirPath);
  }
  if (!toDelete.length) return null;
  return scheduleDeleteAfterExit({
    dirs: toDelete,
    waitMs: 1500,
    maxWaitSec: 30,
    logFile: path.join(app.getPath('temp'), 'copilot-zh-cleanup.log'),
  });
}

ipcMain.handle('cleanup:openDataFolder', async () => {
  shell.openPath(USER_DIR);
});

// ---------------------------------------------------------------------------
// IPC：通用
// ---------------------------------------------------------------------------

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:relaunch', async () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('app:quit', async () => {
  isQuitting = true;
  // 退出前安排数据目录的延迟删除（清理流程会用到）
  try { scheduleCleanupOnExit(); } catch (e) { /* 忽略 */ }
  setTimeout(() => app.quit(), 120);
  return { ok: true };
});
