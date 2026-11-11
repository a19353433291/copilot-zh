// 启动项管理：将本程序写入 HKCU 的 Run 键，实现开机自启。
// 必须与卸载脚本配合：installer.nsh 中要清理这个键值。
//
// 重要：查询走异步 API，不能阻塞主进程。
// 早期用 execFileSync 导致每次读设置都卡住界面。

'use strict';

const { execFile } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'CopilotHan';

function isSupported() {
  return process.platform === 'win32';
}

/** 执行 reg 命令（异步） */
function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
}

/** 异步查询当前是否已设置开机自启 */
async function isEnabled() {
  if (!isSupported()) return false;
  const r = await reg(['query', RUN_KEY, '/v', VALUE_NAME]);
  return r.ok && r.out.includes(VALUE_NAME);
}

/** 异步设置或取消开机自启 */
async function setEnabled(enabled, exePath) {
  if (!isSupported()) return { ok: false, reason: '仅支持 Windows' };
  if (enabled) {
    const target = exePath || process.execPath;
    const r = await reg(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ',
      '/d', `"${target}"`, '/f']);
    return r.ok ? { ok: true } : { ok: false, reason: '写入注册表失败' };
  }
  const r = await reg(['delete', RUN_KEY, '/v', VALUE_NAME, '/f']);
  // 删除不存在的值会失败，视为成功
  return { ok: true };
}

module.exports = { isEnabled, setEnabled, isSupported, VALUE_NAME, RUN_KEY };
