// Electron 主进程：创建窗口、暴露安全的 IPC 接口。
// 渲染进程不能直接访问文件系统 / 注册表，全部通过这里代理。

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { locateApp, readFileVersion } = require('../src/core/locator');
const pack = require('../src/core/dict/pack');
const cleanup = require('../src/core/cleanup');
const { createEngines, supportedPlatforms } = require('../src/core/platform/engine');
const { registerWin32 } = require('../src/core/platform/win32');

// 注册当前平台实现（跨平台扩展点）
if (process.platform === 'win32') registerWin32();

let mainWindow = null;

// 用户数据目录：%APPDATA%\<appName>
const USER_DIR = app.getPath('userData');
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
    title: 'CopilotZh — GitHub Copilot 汉化工具',
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ensureDirs();
  bootstrapBundledPack();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
    return await engine.apply(target, dict, {
      onProgress: (pct, msg) => {
        evt.sender.send('engine:progress', { pct, msg });
      },
    });
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
