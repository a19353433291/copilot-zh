// 验证安装包内容完整性（直接读 asar 并检查关键模块）
const asar = require('@electron/asar');
const path = require('path');

const ASAR = 'dist/win-unpacked/resources/app.asar';

const need = [
  'electron/main.js',
  'electron/preload.js',
  'electron/updater-ipc.js',
  'src/core/update/updater.js',
  'src/core/update/sources.js',
  'src/core/settings.js',
  'src/ui/index.html',
  'src/ui/update-ui.js',
  'src/ui/renderer.js',
  'src/ui/motion.css'.replace('motion.css', 'styles/motion.css'),
  'src/core/dict/translations.json',
  'bundled-packs/manifest.json',
  'bundled-packs/zh-CN-1.6.0.json',
  'build/icon.ico',
];

const files = asar.listPackage(ASAR).map(f => f.replace(/\\/g, '/').replace(/^\//, ''));
console.log('asar 文件总数:', files.length);
console.log('');

let ok = 0, miss = 0;
for (const n of need) {
  const found = files.includes(n);
  if (found) ok++; else miss++;
  console.log('  ' + (found ? '✓' : '✗') + ' ' + n);
}

console.log('');
console.log(`  ${ok} / ${need.length} 存在`);

// 额外检查：更新相关模块是否可被 require（语法与依赖）
console.log('\n=== 关键模块依赖检查 ===');
try {
  const src = asar.extractFile(ASAR, 'electron/updater-ipc.js').toString('utf8');
  const rel = src.match(/require\(['"]([^'"]*update[^'"]*)['"]\)/g) || [];
  console.log('  updater-ipc.js 引用更新模块:');
  rel.forEach(r => console.log('    ' + r));
  const hasCorrectPath = src.includes("require('../src/core/update/updater')");
  console.log('  ' + (hasCorrectPath ? '✓' : '✗') + ' 路径正确（../src/core/update/）');
} catch (e) {
  console.log('  ✗ 读取失败:', e.message);
}

process.exit(miss > 0 ? 1 : 0);
