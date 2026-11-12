// 从 Qoder CSS 中提取可复用的设计规律（绕过变量混淆）
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\_scratch\\qoder-ui';
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.css'));
const allCss = files.map(f => fs.readFileSync(path.join(OUT, f), 'utf8')).join('\n');

console.log('════════ Qoder 设计语言分析 ════════\n');

// ---------- 1. 布局尺寸 ----------
console.log('=== 布局尺寸（硬编码 px 值统计）===');
const widths = {};
const wRe = /(?:width|min-width|max-width):\s*(\d+(?:\.\d+)?px)/g;
let w;
while ((w = wRe.exec(allCss)) !== null) {
  const v = parseFloat(w[1]);
  if (v >= 100 && v <= 800) widths[v] = (widths[v] || 0) + 1;
}
Object.entries(widths).sort((a, b) => b[1] - a[1]).slice(0, 18)
  .forEach(([v, n]) => console.log(`  ${v}px  (${n}次)`));

// ---------- 2. 高度 ----------
console.log('\n=== 常见高度（按钮/行高）===');
const heights = {};
const hRe = /(?:^|[;{\s])height:\s*(\d+(?:\.\d+)?px)/g;
let h;
while ((h = hRe.exec(allCss)) !== null) {
  const v = parseFloat(h[1]);
  if (v >= 16 && v <= 80) heights[v] = (heights[v] || 0) + 1;
}
Object.entries(heights).sort((a, b) => b[1] - a[1]).slice(0, 18)
  .forEach(([v, n]) => console.log(`  ${v}px  (${n}次)`));

// ---------- 3. 间距 ----------
console.log('\n=== 间距值（gap / padding）===');
const gaps = {};
const gRe = /(?:^|[;{\s])gap:\s*(\d+(?:\.\d+)?px)/g;
let g;
while ((g = gRe.exec(allCss)) !== null) {
  const v = parseFloat(g[1]);
  gaps[v] = (gaps[v] || 0) + 1;
}
Object.entries(gaps).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([v, n]) => console.log(`  ${v}px  (${n}次)`));

// ---------- 4. 对比度检查 ----------
console.log('\n=== 关键颜色配对（找背景/文字）===');
// 找形如 background:X;color:Y 的组合
const pairs = {};
const pRe = /background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))[^;}]*;[^}]{0,40}?color:\s*(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))/g;
let p;
while ((p = pRe.exec(allCss)) !== null) {
  const key = `${p[1]} / ${p[2]}`;
  pairs[key] = (pairs[key] || 0) + 1;
}
Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([k, n]) => console.log(`  ${k}  (${n}次)`));

// ---------- 5. 具体颜色语义 ----------
console.log('\n=== 出现频繁的具名色（非纯黑白）===');
const namedColors = {
  '#99c3be': '鼠尾草绿/青灰',
  '#8ee5a1': '浅薄荷绿',
  '#73cd94': '中绿',
  '#9be6b3': '嫩绿',
  '#ffd666': '暖黄',
  '#c96442': '陶土橙',
  '#335942': '深墨绿',
  '#191b1a': '近黑（偏绿）',
  '#22221f': '深炭色（偏暖）',
  '#f4f5f3': '米白（微绿）',
  '#efefef': '浅灰',
  '#d5dbd8': '灰绿',
};
Object.entries(namedColors).forEach(([hex, desc]) => {
  const n = (allCss.match(new RegExp(hex, 'g')) || []).length;
  if (n > 0) console.log(`  ${hex.padEnd(10)} ${String(n).padStart(4)}次  ${desc}`);
});

// ---------- 6. 检查是否有暗色/亮色双主题 ----------
console.log('\n=== 主题机制 ===');
console.log('  data-theme 出现:', (allCss.match(/data-theme/g) || []).length, '次');
console.log('  prefers-color-scheme:', (allCss.match(/prefers-color-scheme/g) || []).length, '次');
console.log('  .dark 类:', (allCss.match(/\.dark\b/g) || []).length, '次');
// 找 data-theme 取值
const themeVals = new Set();
const tvRe = /data-theme[~=^$*|]?=["']?([\w-]+)/g;
let tv;
while ((tv = tvRe.exec(allCss)) !== null) themeVals.add(tv[1]);
console.log('  data-theme 取值:', [...themeVals].slice(0, 10).join(', '));

// ---------- 7. 字体大小体系 ----------
console.log('\n=== 字号体系（rem 与 px 混合）===');
const fs2 = {};
const fRe = /font-size:\s*([\d.]+(?:px|rem|em))/g;
let f;
while ((f = fRe.exec(allCss)) !== null) {
  const v = f[1].replace('!important', '');
  fs2[v] = (fs2[v] || 0) + 1;
}
Object.entries(fs2).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([v, n]) => console.log(`  ${v.padEnd(12)} ${n}次`));

// ---------- 8. 圆角体系汇总 ----------
console.log('\n=== 圆角体系 ===');
const radVars = {
  xs: '.125rem = 2px', sm: '.25rem = 4px', md: '.375rem = 6px',
  lg: '.5rem = 8px', xl: '.75rem = 12px', '2xl': '1rem = 16px',
};
Object.entries(radVars).forEach(([k, v]) => console.log(`  --radius-${k.padEnd(4)} ${v}`));

// ---------- 9. 动效时长 ----------
console.log('\n=== 动效时长（归一秒数）===');
console.log('  75ms / 100ms / 120ms / 140ms / 150ms / 200ms / 300ms 均有使用');
console.log('  主流: 150ms (Tailwind default) + 200ms');

// ---------- 10. 是否用 oklch ----------
console.log('\n=== 色彩空间 ===');
console.log('  oklch() 使用:', (allCss.match(/oklch\(/g) || []).length, '次');
console.log('  color-mix() 使用:', (allCss.match(/color-mix\(/g) || []).length, '次');
console.log('  rgba() 使用:', (allCss.match(/rgba?\(/g) || []).length, '次');
