// 深入分析 Qoder 的主题变量与关键设计决策
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\_scratch\\qoder-ui';
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.css'));
const allCss = files.map(f => fs.readFileSync(path.join(OUT, f), 'utf8')).join('\n');

console.log('=== 1. 查找 qoder 专属变量前缀 ===');
// Qoder 用 --qdNNNNN 形式的混淆变量，但也应该有语义化的
const semanticVars = {};
const varRe = /(--(?:qoder|qd-)[\w-]+)\s*:\s*([^;}]+)/g;
let m;
while ((m = varRe.exec(allCss)) !== null) {
  const k = m[1];
  if (!semanticVars[k]) semanticVars[k] = new Set();
  semanticVars[k].add(m[2].trim());
}
console.log('  qoder/qd- 前缀变量数:', Object.keys(semanticVars).length);
Object.entries(semanticVars).slice(0, 30).forEach(([k, v]) =>
  console.log(`    ${k}: ${[...v].join(' | ').slice(0, 70)}`));

console.log('\n=== 2. 查找 :root 与 dark 主题块 ===');
const rootBlocks = allCss.match(/:root[^{]*\{[^}]{100,3000}\}/g) || [];
console.log('  :root 块数:', rootBlocks.length);
rootBlocks.slice(0, 2).forEach((b, i) => {
  console.log(`\n  --- :root 块 ${i + 1}（前 800 字符）---`);
  console.log('  ' + b.slice(0, 800).replace(/\n/g, '\n  '));
});

console.log('\n=== 3. 查找 .dark 选择器块 ===');
const darkBlocks = allCss.match(/\.dark[^{]*\{[^}]{50,3000}\}/g) || [];
console.log('  .dark 块数:', darkBlocks.length);
if (darkBlocks[0]) {
  console.log('\n  --- 第一个 .dark 块（前 900 字符）---');
  console.log('  ' + darkBlocks[0].slice(0, 900).replace(/\n/g, '\n  '));
}

console.log('\n=== 4. 查找 @theme / @layer 定义 ===');
const themeBlocks = allCss.match(/@theme[^{]*\{[\s\S]{50,2000}?\n\}/g) || [];
console.log('  @theme 块数:', themeBlocks.length);
if (themeBlocks[0]) {
  console.log('\n  --- 第一个 @theme 块（前 1000 字符）---');
  console.log('  ' + themeBlocks[0].slice(0, 1000).replace(/\n/g, '\n  '));
}

console.log('\n=== 5. 字体栈 ===');
const fontFamilies = new Set();
const ffRe = /font-family:\s*([^;}]+)/g;
let ff;
while ((ff = ffRe.exec(allCss)) !== null) fontFamilies.add(ff[1].trim());
[...fontFamilies].slice(0, 12).forEach(f => console.log(`  ${f.slice(0, 110)}`));

console.log('\n=== 6. 具体渐变用法样例 ===');
const gradients = allCss.match(/linear-gradient\([^)]{10,160}\)/g) || [];
console.log('  linear-gradient 样例（前 12）:');
[...new Set(gradients)].slice(0, 12).forEach(g => console.log(`    ${g.slice(0, 120)}`));

console.log('\n=== 7. backdrop-filter 用法 ===');
const bf = allCss.match(/backdrop-filter:\s*[^;}]+/g) || [];
console.log('  样例（前 10）:');
[...new Set(bf)].slice(0, 10).forEach(b => console.log(`    ${b.slice(0, 100)}`));

console.log('\n=== 8. 查找侧边栏 / 导航相关类 ===');
const navClasses = new Set();
const navRe = /\.([\w-]*(?:sidebar|activity-?bar|nav|title-?bar|statusbar|tab)[\w-]*)/gi;
let nv;
while ((nv = navRe.exec(allCss)) !== null) navClasses.add(nv[1]);
console.log('  相关类名（前 30）:', [...navClasses].slice(0, 30).join(', '));

console.log('\n=== 9. 查找按钮相关类 ===');
const btnClasses = new Set();
const btnRe = /\.([\w-]*btn[\w-]*)/gi;
let bt;
while ((bt = btnRe.exec(allCss)) !== null) btnClasses.add(bt[1]);
console.log('  按钮类名（前 25）:', [...btnClasses].slice(0, 25).join(', '));

// 搜索按钮样式定义
const btnStyle = allCss.match(/\.btn[\w-]*[^{]*\{[^}]{20,400}\}/g) || [];
console.log('\n  按钮样式定义（前 4 个）:');
btnStyle.slice(0, 4).forEach(b => console.log('    ' + b.slice(0, 260).replace(/\n/g, ' ')));

fs.writeFileSync(path.join(OUT, '_raw-context.txt'), allCss.slice(0, 200000), 'utf8');
console.log('\n✓ 已保存原始 CSS 片段');
