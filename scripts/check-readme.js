// 校验 README 的准确性：版本号、文件路径、数字、链接
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zh = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const en = fs.readFileSync(path.join(root, 'README.en.md'), 'utf8');

let issues = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}  ${detail || ''}`);
    issues++;
  }
}

console.log('=== 1. 版本号一致性 ===');
check('README.md 含当前版本 ' + pkg.version, zh.includes(pkg.version));
check('README.en.md 含当前版本 ' + pkg.version, en.includes(pkg.version));

console.log('\n=== 2. 字典数字准确性 ===');
const t = JSON.parse(fs.readFileSync(path.join(root, 'src/core/dict/translations.json'), 'utf8'));
const texts = {};
for (const [g, v] of Object.entries(t)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const real = {
  texts: Object.keys(texts).length,
  patterns: (t.patterns || []).length,
  attrs: Object.keys(t.attrs || {}).length,
  attrPatterns: (t.attrPatterns || []).length,
};
console.log('  实际:', JSON.stringify(real));
check('README.md 文本数 ' + real.texts, zh.includes(String(real.texts)));
check('README.en.md 文本数 ' + real.texts, en.includes(String(real.texts)));
check('README.md 正则数 ' + real.patterns, zh.includes(String(real.patterns)));
check('README.en.md 正则数 ' + real.patterns, en.includes(String(real.patterns)));

console.log('\n=== 3. 引用的文件是否都存在 ===');
// 提取 markdown 中的相对路径引用
const refPattern = /\]\(([^)]+)\)/g;
const imagePattern = /src="([^"]+)"/g;
const refs = new Set();
for (const doc of [zh, en]) {
  let m;
  while ((m = refPattern.exec(doc)) !== null) refs.add(m[1]);
  while ((m = imagePattern.exec(doc)) !== null) refs.add(m[1]);
}
let missing = 0;
for (const r of refs) {
  if (/^https?:/.test(r) || r.startsWith('#')) continue;
  const p = path.join(root, r);
  if (!fs.existsSync(p)) {
    console.log(`  ✗ 引用不存在: ${r}`);
    missing++;
    issues++;
  }
}
if (!missing) console.log(`  ✓ 所有 ${refs.size} 个本地引用均存在`);

console.log('\n=== 4. 代码块中引用的脚本 ===');
const scriptRefs = new Set();
for (const doc of [zh, en]) {
  const matches = doc.matchAll(/node (scripts\/[\w.-]+\.js)/g);
  for (const m of matches) scriptRefs.add(m[1]);
}
for (const s of scriptRefs) {
  if (!fs.existsSync(path.join(root, s))) {
    console.log(`  ✗ 脚本不存在: ${s}`);
    issues++;
  }
}
console.log(`  ✓ 检查了 ${scriptRefs.size} 个脚本引用`);

console.log('\n=== 5. 结构描述中的文件 ===');
// 检查项目结构中提到的关键文件
const structFiles = [
  'electron/main.js', 'electron/preload.js',
  'src/core/applyFlow.js', 'src/core/locator.js', 'src/core/settings.js',
  'src/core/watcher.js', 'src/core/autostart.js', 'src/core/cleanup.js',
  'src/core/delayedDelete.js', 'src/core/platform/engine.js',
  'src/core/platform/win32/index.js', 'src/core/platform/win32/runtimeInject.js',
  'src/core/dict/pack.js', 'src/core/dict/translations.json',
  'build/icon.ico', 'build/installer.nsh',
];
for (const f of structFiles) {
  if (!fs.existsSync(path.join(root, f))) {
    console.log(`  ✗ 缺失: ${f}`);
    issues++;
  }
}
console.log(`  ✓ 检查了 ${structFiles.length} 个结构文件`);

console.log('\n=== 6. 语言跳转链接 ===');
check('README.md 链接到 README.en.md', zh.includes('(README.en.md)'));
check('README.en.md 链接到 README.md', en.includes('(README.md)'));

console.log('\n=== 7. 是否残留开发计划 ===');
const planKeywords = ['后续计划', 'Roadmap', 'TODO:', '- [ ]', 'Future plans'];
for (const kw of planKeywords) {
  if (zh.includes(kw)) { console.log(`  ✗ README.md 残留: ${kw}`); issues++; }
  if (en.includes(kw)) { console.log(`  ✗ README.en.md 残留: ${kw}`); issues++; }
}
if (!planKeywords.some(k => zh.includes(k) || en.includes(k))) {
  console.log('  ✓ 无开发计划章节');
}

console.log('\n=== 8. 设置项与代码一致性 ===');
const { DEFAULTS } = require('../src/core/settings');
const defs = Object.keys(DEFAULTS);
console.log('  代码中的设置项:', defs.join(', '));
// 检查 README 是否提到所有设置
const settingMap = {
  launchCopilotAfterApply: '汉化后同步启动',
  autoRestartCopilot: '自动重启',
  closeCopilotOnRevert: '还原英文时自动关闭',
  autoInjectOnStart: '常驻监控',
  watchIntervalMs: '检查间隔',
  runAtLogin: '开机自动启动',
  minimizeToTray: '最小化到托盘',
};
for (const [key, label] of Object.entries(settingMap)) {
  if (!zh.includes(label)) { console.log(`  ✗ README.md 缺少设置说明: ${label}`); issues++; }
}
console.log('  ✓ 设置项检查完成');

console.log('\n=== 9. 字典包示例数据与实际一致 ===');
try {
  const packDir = path.join(root, 'dist-packs');
  const versions = fs.readdirSync(packDir).filter(d => d.startsWith('zh-CN-')).sort();
  const latest = versions[versions.length - 1];
  const mf = path.join(packDir, latest, 'manifest.json');
  if (fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8')).manifest;
    const sizeStr = String(m.payload.size);
    check(`README.md 载荷大小 ${sizeStr}`, zh.includes(`"size": ${sizeStr}`));
    check(`README.en.md 载荷大小 ${sizeStr}`, en.includes(`"size": ${sizeStr}`));
    check(`README.md 版本 ${m.packVersion}`, zh.includes(m.packVersion));
    check(`README.en.md 版本 ${m.packVersion}`, en.includes(m.packVersion));
  }
} catch (e) {
  console.log('  跳过：' + e.message);
}
console.log(`\n===== 共 ${issues} 个问题 =====`);
process.exit(issues ? 1 : 0);
