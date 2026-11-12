// 提取 Qoder 主界面 CSS 并做设计分析
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const ASAR = 'D:\\Program Files\\Qoder CN\\resources\\app.asar';
const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\_scratch\\qoder-ui';
fs.mkdirSync(OUT, { recursive: true });

const targets = [
  '\\out\\renderer\\assets\\index-BDkncoAI.css',
  '\\out\\renderer\\assets\\index-CGXuwz-W.css',
];

const extracted = [];
for (const t of targets) {
  try {
    const buf = asar.extractFile(ASAR, t.replace(/^\\/, ''));
    extracted.push({ name: path.basename(t), size: buf.length, text: buf.toString('utf8') });
    console.log(`✓ ${path.basename(t)}  ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.log(`✗ ${t}: ${e.message}`);
  }
}

if (!extracted.length) { console.log('无内容'); process.exit(1); }

// 保存
for (const e of extracted) {
  fs.writeFileSync(path.join(OUT, e.name), e.text, 'utf8');
}

const allCss = extracted.map(e => e.text).join('\n');
console.log(`\n总 CSS 体积: ${(allCss.length / 1024).toFixed(0)} KB`);

// ---------- CSS 变量 ----------
const vars = {};
const varRe = /(--[a-zA-Z][\w-]*)\s*:\s*([^;}]+)/g;
let m;
while ((m = varRe.exec(allCss)) !== null) {
  const name = m[1];
  const val = m[2].trim();
  if (!vars[name]) vars[name] = new Set();
  vars[name].add(val);
}
console.log(`\n=== CSS 变量：${Object.keys(vars).length} 个 ===`);

// 挑出设计相关变量
const designKeys = Object.keys(vars).filter(k =>
  /color|bg|background|surface|border|text|font|radius|shadow|space|gap|size|height|spacing/i.test(k)
);
console.log(`设计相关变量: ${designKeys.length} 个`);

// 打印颜色类变量
console.log('\n--- 颜色变量（前 50）---');
const colorVars = Object.keys(vars).filter(k => /color|bg|background|surface|border|text|accent|primary/i.test(k));
colorVars.slice(0, 50).forEach(k => {
  const vals = [...vars[k]].slice(0, 2).join(' | ');
  console.log(`  ${k.padEnd(44)} ${vals.slice(0, 70)}`);
});

// 圆角变量
console.log('\n--- 圆角变量 ---');
Object.keys(vars).filter(k => /radius/i.test(k)).forEach(k => {
  console.log(`  ${k.padEnd(40)} ${[...vars[k]].join(' | ').slice(0, 60)}`);
});

// 阴影变量
console.log('\n--- 阴影变量 ---');
Object.keys(vars).filter(k => /shadow/i.test(k)).slice(0, 20).forEach(k => {
  console.log(`  ${k.padEnd(40)} ${[...vars[k]].join(' | ').slice(0, 80)}`);
});

// 字号变量
console.log('\n--- 字号变量 ---');
Object.keys(vars).filter(k => /font-size|fs-|text-size/i.test(k)).slice(0, 25).forEach(k => {
  console.log(`  ${k.padEnd(40)} ${[...vars[k]].join(' | ').slice(0, 50)}`);
});

// ---------- 实际使用的值统计 ----------
function count(pattern) {
  const map = {};
  let mm;
  const re = new RegExp(pattern, 'g');
  while ((mm = re.exec(allCss)) !== null) {
    const v = mm[1].trim();
    map[v] = (map[v] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

console.log('\n=== 字号实际使用（前 15）===');
count('font-size:\\s*([^;}]+)').slice(0, 15).forEach(([v, n]) => console.log(`  ${v.padEnd(18)} ${n}`));

console.log('\n=== 圆角实际使用（前 15）===');
count('border-radius:\\s*([^;}]+)').slice(0, 15).forEach(([v, n]) => console.log(`  ${v.padEnd(30)} ${n}`));

console.log('\n=== 字重实际使用 ===');
count('font-weight:\\s*([^;}]+)').slice(0, 10).forEach(([v, n]) => console.log(`  ${v.padEnd(12)} ${n}`));

// 十六进制颜色
const colors = {};
const cRe = /#([0-9a-fA-F]{3,8})\b/g;
let c;
while ((c = cRe.exec(allCss)) !== null) {
  const v = '#' + c[1].toLowerCase();
  colors[v] = (colors[v] || 0) + 1;
}
console.log('\n=== 最常用颜色（前 25）===');
Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([hex, n]) => console.log(`  ${hex.padEnd(12)} ${n}`));

// 是否用了渐变
const gradients = (allCss.match(/linear-gradient\(/g) || []).length;
const radial = (allCss.match(/radial-gradient\(/g) || []).length;
const backdrop = (allCss.match(/backdrop-filter/g) || []).length;
console.log(`\n=== 视觉效果使用次数 ===`);
console.log(`  linear-gradient: ${gradients}`);
console.log(`  radial-gradient: ${radial}`);
console.log(`  backdrop-filter: ${backdrop}`);

// 动画时长
console.log('\n=== 过渡时长（前 12）===');
count('(?:transition-duration|animation-duration):\\s*([^;}]+)').slice(0, 12)
  .forEach(([v, n]) => console.log(`  ${v.padEnd(20)} ${n}`));

// 保存全部变量
const varDump = Object.entries(vars).map(([k, s]) => `${k}: ${[...s].join(' | ')}`).join('\n');
fs.writeFileSync(path.join(OUT, '_vars.txt'), varDump, 'utf8');
console.log(`\n✓ 变量清单已保存（${varDump.split('\n').length} 行）`);
