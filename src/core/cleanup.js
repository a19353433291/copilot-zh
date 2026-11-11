// 清理模块：集中管理本工具在系统上留下的所有痕迹，用于「还原」与「卸载前自清」。
//
// 设计原则：任何写入系统的地方，都必须在这里登记一条清理规则。
// 新增功能若产生新的系统副作用，务必同步补充到这里。

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const POLICY_KEY_HKLM = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const POLICY_KEY_HKCU = 'HKCU\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const POLICY_PARENT_HKLM = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2';
const POLICY_PARENT_HKCU = 'HKCU\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2';

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  } catch (e) {
    return null;
  }
}

function queryValue(hive, key, name) {
  const out = run('reg', ['query', key, '/v', name]);
  if (!out) return null;
  const m = out.match(/REG_SZ\s+(.*)/);
  return m ? m[1].trim() : null;
}

function deleteValue(key, name) {
  run('reg', ['delete', key, '/v', name, '/f']);
}

function keyExists(key) {
  return run('reg', ['query', key]) !== null;
}

/** 列出某注册表键下的所有值名 */
function listValues(key) {
  const out = run('reg', ['query', key]);
  if (!out) return [];
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s{2,}(\S+)\s+REG_/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 列出某注册表键下的所有子键 */
function listSubKeys(key) {
  const out = run('reg', ['query', key]);
  if (!out) return [];
  const subs = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.includes(key.replace(/\\/g, '\\')) && line.trim().endsWith('\\') === false) {
      const t = line.trim();
      if (t.includes('\\') && t.length > key.length) subs.push(t);
    }
  }
  return subs;
}

// ---------------------------------------------------------------------------
// 各项痕迹的检测与清理
// ---------------------------------------------------------------------------

/**
 * WebView2 调试端口策略（模式 A 写入）。
 */
const debugPolicy = {
  id: 'webview2-debug-policy',
  label: 'WebView2 调试端口策略',
  describe() {
    const items = [];
    for (const [hive, key] of [['HKLM', POLICY_KEY_HKLM], ['HKCU', POLICY_KEY_HKCU]]) {
      const v = queryValue(hive, key, 'github.exe');
      if (v) items.push({ hive, key, value: v });
    }
    return items;
  },
  clean() {
    const cleaned = [];
    for (const [hive, key, parent] of [
      ['HKLM', POLICY_KEY_HKLM, POLICY_PARENT_HKLM],
      ['HKCU', POLICY_KEY_HKCU, POLICY_PARENT_HKCU],
    ]) {
      const before = queryValue(hive, key, 'github.exe');
      if (before) {
        deleteValue(key, 'github.exe');
        cleaned.push(`${hive}\\...\\AdditionalBrowserArguments → 删除 github.exe`);
      }
      // 若键空了，删掉空键，再检查父键
      if (keyExists(key) && listValues(key).length === 0) {
        run('reg', ['delete', key, '/f']);
        cleaned.push(`${hive}\\...\\AdditionalBrowserArguments → 删除空键`);
      }
      if (keyExists(parent)) {
        const vals = listValues(parent);
        const subs = listSubKeys(parent);
        if (vals.length === 0 && subs.length === 0) {
          run('reg', ['delete', parent, '/f']);
          cleaned.push(`${hive}\\...\\WebView2 → 删除空键`);
        }
      }
    }
    return cleaned;
  },
  /** 是否有残留需要清理 */
  present() { return this.describe().length > 0; },
};

/**
 * 目录痕迹。
 */
function dirTrace(id, label, dirPath) {
  return {
    id,
    label,
    dirPath,
    describe() {
      if (!fs.existsSync(dirPath)) return [];
      const files = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true })
        .filter(e => e.isFile()).length;
      return [{ path: dirPath, files }];
    },
    clean() {
      if (!fs.existsSync(dirPath)) return [];
      fs.rmSync(dirPath, { recursive: true, force: true });
      return [dirPath];
    },
    present() { return fs.existsSync(dirPath); },
  };
}

/**
 * 收集全部痕迹（跨平台在此分支）。
 * @param {object} opts { userDataDir, tempDirs, extraDirs }
 */
function collectTraces(opts = {}) {
  const traces = [];
  if (process.platform === 'win32') {
    traces.push(debugPolicy);

    // 所有可能由 Electron / electron-updater 创建的目录
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const names = ['copilot-zh', 'CopilotZh'];
    if (appData) {
      for (const n of names) traces.push(dirTrace('appdata-' + n, '用户数据：' + n, path.join(appData, n)));
    }
    if (localAppData) {
      for (const n of names) {
        traces.push(dirTrace('localappdata-' + n, '本地数据：' + n, path.join(localAppData, n)));
        traces.push(dirTrace('updater-' + n, '更新缓存：' + n + '-updater', path.join(localAppData, n + '-updater')));
      }
    }
  }
  if (opts.userDataDir) {
    traces.push(dirTrace('user-data', '用户数据（字典包、日志、备份）', opts.userDataDir));
  }
  if (opts.tempDirs) {
    for (const [label, p] of opts.tempDirs) {
      traces.push(dirTrace('temp-' + label, '临时文件：' + label, p));
    }
  }
  return traces;
}

/**
 * 审计：列出当前所有残留。
 * @returns {{traces: Array, total: number}}
 */
function audit(opts) {
  const traces = collectTraces(opts);
  const found = [];
  for (const t of traces) {
    let items = [];
    try { items = t.describe(); } catch (e) { items = []; }
    if (items.length) found.push({ id: t.id, label: t.label, items });
  }
  return { traces: found, total: found.length };
}

/**
 * 清理：删除所有残留。
 * @returns {{ok: boolean, cleaned: string[], errors: string[]}}
 */
function cleanAll(opts) {
  const traces = collectTraces(opts);
  const cleaned = [];
  const errors = [];
  for (const t of traces) {
    try {
      const r = t.clean();
      if (r && r.length) cleaned.push(...r.map(x => `[${t.label}] ${x}`));
    } catch (e) {
      errors.push(`[${t.label}] ${e.message}`);
    }
  }
  return { ok: errors.length === 0, cleaned, errors };
}

module.exports = {
  audit, cleanAll, collectTraces,
  debugPolicy, queryValue, deleteValue, keyExists, listValues,
  POLICY_KEY_HKLM, POLICY_KEY_HKCU,
};
