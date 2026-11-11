// Electron 主进程：创建窗口、暴露安全的 IPC 接口。
// 渲染进程不能直接访问文件系统 / 注册表，全部通过这里代理。

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { locateApp, readFileVersion } = require('../src/core/locator');
const pack = require('../src/core/dict/pack');
const cleanup = require('../src/core/cleanup');
const { Settings } = require('../src/core/settings');
const { Watcher } = require('../src/core/watcher');
const autostart = require('../src/core/autostart');
const { createEngines, supportedPlatforms } = require('../src/core/platform/engine');
const { registerWin32 } = require('../src/core/platform/win32');

// 注册当前平台实现（跨平台扩展点）
if (process.platform === 'win32') registerWin32();

let mainWindow = null;
let tray = null;
let settings = null;
let watcher = null;
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: PRODUCT_NAME + ' — GitHub Copilot 汉化工具',
    backgroundColor: '#0d1117',
    show: false,
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
function notifyTray(text) {
  if (tray && tray.displayBalloon) {
    try { tray.displayBalloon({ title: PRODUCT_NAME, content: text }); } catch (e) { /* ignore */ }
  }
}

/** 创建系统托盘图标 */
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const fs = require('fs');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
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
async function launchCopilot() {
  const loc = locateApp();
  if (!loc.ok) return { ok: false, reason: loc.reason };

  const { spawn } = require('child_process');
  try {
    const child = spawn(loc.exePath, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(loc.exePath),
    });
    child.unref();
    return { ok: true, exePath: loc.exePath };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
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

app.whenReady().then(() => {
  ensureDirs();
  bootstrapBundledPack();

  settings = new Settings(USER_DIR);

  // 同步开机自启状态（以注册表实际状态为准，防止设置与实际不一致）
  const realAutoStart = autostart.isEnabled();
  if (realAutoStart !== settings.get('runAtLogin')) {
    settings.set({ runAtLogin: realAutoStart });
  }

  createWindow();
  createTray();
  initWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (watcher) watcher.stop();
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
    autostartReal: autostart.isEnabled(),
    watcher: watcher ? watcher.status() : null,
  };
});

ipcMain.handle('settings:set', async (_e, patch) => {
  const r = settings.set(patch);

  // 开机自启需同步注册表
  if (r.changed.includes('runAtLogin')) {
    const want = settings.get('runAtLogin');
    const a = autostart.setEnabled(want, process.execPath);
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
    // 关闭时不停线程，只在 tick 里跳过（便于再次开启）
  }

  return { ok: true, changed: r.changed, data: settings.getAll() };
});

ipcMain.handle('settings:reset', async () => {
  const d = settings.reset();
  autostart.setEnabled(d.runAtLogin, process.execPath);
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
  const r = locateApp();
  if (r.ok) {
    r.signature = readSignature(r.exePath);
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
  return { ok: true, exePath: p, version: readFileVersion(p), source: 'manual', signature: readSignature(p) };
});

function readSignature(exePath) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-AuthenticodeSignature -LiteralPath '${exePath.replace(/'/g, "''")}').Status`],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return (out || '').trim() || 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
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
  try {
    const r = await engine.apply(target, dict, {
      onProgress: (pct, msg) => {
        evt.sender.send('engine:progress', { pct, msg });
      },
    });

    // 汉化成功后，按设置决定是否同步启动 Copilot
    let launched = null;
    if (r.ok && settings && settings.get('launchCopilotAfterApply')) {
      const st = watcher ? watcher.status() : null;
      // 只有 Copilot 没在运行时才启动，避免重复开实例
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

ipcMain.handle('engine:revert', async (_evt, { engineId, target }) => {
  const engine = createEngines().find(e => e.id === engineId);
  if (!engine) return { ok: false, reason: '未知引擎: ' + engineId };
  try { return await engine.revert(target); }
  catch (e) { return { ok: false, reason: e.message }; }
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
  // 在线更新预留：后续接入更新源
  return { ok: false, reason: '在线更新尚未配置源地址', notConfigured: true };
});

ipcMain.handle('pack:openFolder', async () => {
  shell.openPath(PACKS_DIR);
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
  // 先撤销引擎侧的汉化（移除调试端口策略等）
  const results = [];
  for (const e of createEngines()) {
    try { results.push({ engine: e.id, result: await e.revert({ exePath: '' }) }); }
    catch (err) { results.push({ engine: e.id, error: err.message }); }
  }
  // 再清全部痕迹（含用户数据目录）
  const r = cleanup.cleanAll(traceOptions());
  return { ok: r.ok, cleaned: r.cleaned, errors: r.errors, engines: results };
});

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
