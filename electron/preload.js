// 预加载脚本：在隔离上下文中向渲染进程暴露受限 API。
// 渲染进程永远拿不到 Node 能力，只能调用这里白名单化的方法。

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 环境
  env: () => ipcRenderer.invoke('env:info'),

  // 目标应用
  locateApp: () => ipcRenderer.invoke('app:locate'),
  chooseApp: () => ipcRenderer.invoke('app:choose'),

  // 引擎
  listEngines: () => ipcRenderer.invoke('engine:list'),
  probe: (engineId, target) => ipcRenderer.invoke('engine:probe', { engineId, target }),
  status: (engineId, target) => ipcRenderer.invoke('engine:status', { engineId, target }),
  apply: (engineId, target, dict) => ipcRenderer.invoke('engine:apply', { engineId, target, dict }),
  revert: (engineId, target) => ipcRenderer.invoke('engine:revert', { engineId, target }),

  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('engine:progress', handler);
    return () => ipcRenderer.removeListener('engine:progress', handler);
  },

  // 字典包
  currentPack: () => ipcRenderer.invoke('pack:current'),
  importPackDir: () => ipcRenderer.invoke('pack:importDir'),
  importPackFile: () => ipcRenderer.invoke('pack:importFile'),
  checkPackUpdate: () => ipcRenderer.invoke('pack:checkUpdate'),
  openPacksFolder: () => ipcRenderer.invoke('pack:openFolder'),

  // 通用
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // 残留审计与清理
  cleanupAudit: () => ipcRenderer.invoke('cleanup:audit'),
  cleanupAll: () => ipcRenderer.invoke('cleanup:cleanAll'),
  openDataFolder: () => ipcRenderer.invoke('cleanup:openDataFolder'),

  // 环境自检
  sysCheck: () => ipcRenderer.invoke('sys:check'),
  relaunchAsAdmin: () => ipcRenderer.invoke('sys:relaunchAsAdmin'),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  // 常驻监控
  watcherStatus: () => ipcRenderer.invoke('watcher:status'),
  injectNow: () => ipcRenderer.invoke('watcher:injectNow'),
  launchCopilot: () => ipcRenderer.invoke('watcher:launchCopilot'),
  onWatcherStatus: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('watcher:status', h);
    return () => ipcRenderer.removeListener('watcher:status', h);
  },
  onWatcherInjected: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('watcher:injected', h);
    return () => ipcRenderer.removeListener('watcher:injected', h);
  },
  onWatcherError: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('watcher:error', h);
    return () => ipcRenderer.removeListener('watcher:error', h);
  },
  onWatcherPolicyWritten: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('watcher:policy-written', h);
    return () => ipcRenderer.removeListener('watcher:policy-written', h);
  },
});
