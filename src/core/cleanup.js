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
 *
 * @param {object} opts
 *   - locked: true 表示该目录被当前进程占用（如 Electron 自己的 userData），
 *     不能在本进程内删除，必须交给退出后的延迟删除脚本。
 */
function dirTrace(id, label, dirPath, opts = {}) {
  return {
    id,
    label,
    dirPath,
    locked: !!opts.locked,
    describe() {
      if (!fs.existsSync(dirPath)) return [];
      let files = 0;
      try {
        files = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true })
          .filter(e => e.isFile()).length;
      } catch (e) {
        // 目录可能因占用而部分不可读，仍视为存在
      }
      return [{
        path: dirPath,
        files,
        locked: this.locked,
      }];
    },
    clean() {
      if (!fs.existsSync(dirPath)) return [];

      // 被占用的目录无法在本进程删除（EBUSY），标记为待延迟删除
      if (this.locked) {
        return [{ deferred: true, path: dirPath }];
      }

      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (e) {
        // 即使非预期目录也可能因占用失败，同样转为延迟删除
        return [{ deferred: true, path: dirPath, error: e.code || e.message }];
      }
      if (fs.existsSync(dirPath)) {
        return [{ deferred: true, path: dirPath }];
      }
      return [dirPath];
    },
    present() { return fs.existsSync(dirPath); },
  };
}

/**
 * 开机自启注册项（设置里的「开机自动启动」写入）。
 */
const runAtLogin = {
  id: 'run-at-login',
  label: '开机自启注册项',
  key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  names: ['CopilotHan', 'copilot-zh', 'CopilotZh', 'Copilot 汉化助手'],
  describe() {
    const items = [];
    for (const n of this.names) {
      const v = queryValue('HKCU', this.key, n);
      if (v) items.push({ hive: 'HKCU', value: n + ' = ' + v });
    }
    return items;
  },
  clean() {
    const cleaned = [];
    for (const n of this.names) {
      if (queryValue('HKCU', this.key, n)) {
        deleteValue(this.key, n);
        cleaned.push(`Run 键 → 删除 ${n}`);
      }
    }
    return cleaned;
  },
  present() { return this.describe().length > 0; },
};

/**
 * 收集全部痕迹（跨平台在此分支）。
 * @param {object} opts
 *   - userDataDir: 当前进程的 userData 目录（会被标记为 locked）
 *   - tempDirs:    [[label, path]]
 */
function collectTraces(opts = {}) {
  const traces = [];
  if (process.platform === 'win32') {
    traces.push(debugPolicy);
    traces.push(runAtLogin);

    // 所有可能由 Electron / electron-updater 创建的目录
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    // 主目录名固定为 copilot-zh；其余为历史命名与改名兼容
    const names = ['copilot-zh', 'CopilotZh', 'Copilot 汉化助手'];
    const currentUserData = opts.userDataDir ? path.resolve(opts.userDataDir).toLowerCase() : '';

    if (appData) {
      for (const n of names) {
        const p = path.join(appData, n);
        // 当前进程正在使用的 userData 目录必须延迟删除
        const locked = currentUserData && path.resolve(p).toLowerCase() === currentUserData;
        traces.push(dirTrace('appdata-' + n, '用户数据：' + n, p, { locked }));
      }
    }
    if (localAppData) {
      for (const n of names) {
        traces.push(dirTrace('localappdata-' + n, '本地数据：' + n, path.join(localAppData, n)));
        traces.push(dirTrace('updater-' + n, '更新缓存：' + n + '-updater', path.join(localAppData, n + '-updater')));
      }
    }
  }
  if (opts.userDataDir) {
    traces.push(dirTrace('user-data', '用户数据（字典包、日志、备份）', opts.userDataDir, { locked: true }));
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
  // 去重：同一个物理路径可能被多个 trace 覆盖
  const seen = new Set();
  const dedup = [];
  for (const f of found) {
    const key = f.items.map(i => (i.path || i.value || '').toLowerCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(f);
  }
  return { traces: dedup, total: dedup.length };
}

/**
 * 清理：删除所有残留。
 *
 * 返回结构：
 *   - cleaned:  已实际删除的项（字符串描述）
 *   - deferred: 无法立即删除、已安排退出后删除的目录
 *   - errors:   真正失败的项
 *
 * @returns {{ok: boolean, cleaned: string[], deferred: string[], errors: string[]}}
 */
function cleanAll(opts) {
  const traces = collectTraces(opts);
  const cleaned = [];
  const errors = [];
  const deferred = [];

  // 同一路径可能被多个 trace 覆盖，记录已处理的路径避免重复
  const handled = new Set();

  for (const t of traces) {
    let r;
    try {
      r = t.clean();
    } catch (e) {
      errors.push(`[${t.label}] ${e.message}`);
      continue;
    }
    if (!r || !r.length) continue;
    for (const item of r) {
      if (item && typeof item === 'object' && item.deferred) {
        const key = path.resolve(item.path).toLowerCase();
        if (handled.has(key)) continue;
        handled.add(key);
        deferred.push(item.path);
      } else {
        cleaned.push(`[${t.label}] ${item}`);
      }
    }
  }

  return { ok: errors.length === 0, cleaned, deferred, errors };
}

module.exports = {
  audit, cleanAll, collectTraces,
  debugPolicy, queryValue, deleteValue, keyExists, listValues,
  POLICY_KEY_HKLM, POLICY_KEY_HKCU,
};
