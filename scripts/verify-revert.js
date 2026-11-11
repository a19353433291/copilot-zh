// 验证「还原英文」是否彻底移除调试端口痕迹（含空键清理）
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const { removePolicy, readPolicy } = require(path.join(root, 'src/core/platform/win32/runtimeInject'));

const KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const PARENT = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2';

function regQuery(key) {
  try {
    return execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  } catch (e) {
    return null;
  }
}

function regAdd(key, name, value) {
  execFileSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
    { encoding: 'utf8', timeout: 8000, windowsHide: true });
}

function exists(key) { return regQuery(key) !== null; }

console.log('=== 步骤 1：模拟已应用汉化（写入策略）===');
regAdd(KEY, 'github.exe', '--remote-debugging-port=9222');
console.log('  AdditionalBrowserArguments 键存在:', exists(KEY));
console.log('  github.exe 值:', readPolicy('github.exe'));

console.log('\n=== 步骤 2：执行还原 ===');
const r = removePolicy('github.exe');
console.log('  结果:', JSON.stringify(r, null, 1));

console.log('\n=== 步骤 3：验证彻底清除 ===');
let fail = 0;
if (readPolicy('github.exe') !== null) { console.log('  ✗ github.exe 值仍存在'); fail++; }
else console.log('  ✓ github.exe 值已删除');

if (exists(KEY)) { console.log('  ✗ AdditionalBrowserArguments 空键残留'); fail++; }
else console.log('  ✓ AdditionalBrowserArguments 键已删除');

if (exists(PARENT)) { console.log('  ✗ WebView2 策略键残留'); fail++; }
else console.log('  ✓ WebView2 策略键已删除');

console.log('\n=== 步骤 4：再次还原（幂等性测试）===');
const r2 = removePolicy('github.exe');
console.log('  重复调用结果:', r2.ok ? '✓ 不报错' : '✗ 报错: ' + r2.reason);
if (!r2.ok) fail++;

console.log('\n=== 结论 ===');
if (fail === 0) console.log('★★★ 还原彻底且幂等 ★★★');
else console.log(`✗ 有 ${fail} 项问题`);
