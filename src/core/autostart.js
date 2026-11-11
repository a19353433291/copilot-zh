// 启动项管理：将本程序写入 HKCU 的 Run 键，实现开机自启。
// 必须与卸载脚本配合：installer.nsh 中要清理这个键值。

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'CopilotHan';

function isSupported() {
  return process.platform === 'win32';
}

/** 查询当前是否已设置开机自启 */
function isEnabled() {
  if (!isSupported()) return false;
  try {
    const out = execFileSync('reg', ['query', RUN_KEY, '/v', VALUE_NAME],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return typeof out === 'string' && out.includes(VALUE_NAME);
  } catch (e) {
    return false;
  }
}

/** 设置或取消开机自启 */
function setEnabled(enabled, exePath) {
  if (!isSupported()) return { ok: false, reason: '仅支持 Windows' };
  try {
    if (enabled) {
      const target = exePath || process.execPath;
      // 加引号，兼容路径带空格（如 C:\Program Files\...）
      execFileSync('reg', ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ',
        '/d', `"${target}"`, '/f'],
        { encoding: 'utf8', timeout: 8000, windowsHide: true });
    } else {
      execFileSync('reg', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'],
        { encoding: 'utf8', timeout: 8000, windowsHide: true });
    }
    return { ok: true };
  } catch (e) {
    // 删除不存在的值会抛错，此时视为成功
    if (!enabled) return { ok: true };
    return { ok: false, reason: e.message };
  }
}

module.exports = { isEnabled, setEnabled, isSupported, VALUE_NAME, RUN_KEY };
