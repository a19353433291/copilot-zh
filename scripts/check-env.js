// 环境自检：确认 Node 版本、Electron 是否就位、GitHub Copilot 是否可定位
const fs = require('fs');
const path = require('path');
const os = require('os');

function ok(m) { console.log('  [OK]   ' + m); }
function warn(m) { console.log('  [WARN] ' + m); }
function fail(m) { console.log('  [FAIL] ' + m); }

console.log('\n=== CopilotZh 环境自检 ===');
console.log('Node: ' + process.version + '  |  平台: ' + process.platform + ' ' + os.arch());

const major = Number(process.version.replace('v', '').split('.')[0]);
if (major >= 18) ok('Node 版本满足要求 (>=18)');
else fail('Node 版本过低，需要 >=18');

const root = path.resolve(__dirname, '..');

// electron 是否安装
try {
  const pkg = require(path.join(root, 'node_modules', 'electron', 'package.json'));
  ok('Electron 已安装: v' + pkg.version);
} catch (e) {
  warn('Electron 未安装（仅打包时需要）');
}

// 定位 GitHub Copilot
const candidates = [
  'D:/Program Files/GitHub Copilot/github.exe',
  'C:/Program Files/GitHub Copilot/github.exe',
  'C:/Program Files (x86)/GitHub Copilot/github.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub Copilot', 'github.exe'),
];
let found = null;
for (const c of candidates) {
  if (fs.existsSync(c)) { found = c; break; }
}
if (found) ok('GitHub Copilot: ' + found);
else warn('未自动找到 GitHub Copilot，可在应用内手动指定路径');

console.log('=== 自检结束 ===\n');
