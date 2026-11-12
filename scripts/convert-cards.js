// 把 HTML 中的 card 结构批量转换为 group 结构
// 规则：
//   <div class="card"> + <div class="card-head"><span class="card-title">X</span>...</div> + <div class="card-body card-body-flush">
//     → <div><div class="group-label"><span>X</span>...</div><div class="group">
// 同时把 <div class="card-body">（非 flush）转成 group 内的 padding 容器
const fs = require('fs');

const FILE = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\src\\ui\\index.html';
let html = fs.readFileSync(FILE, 'utf8');
const before = html;

// ---------- 1. card + card-head + card-body-flush → group-label + group ----------
// 匹配：<div class="card">\n <div class="card-head">\n <span class="card-title">TITLE</span>(可能的其它内容)
//       </div>\n <div class="card-body card-body-flush">
const re1 = /<div class="card">\s*<div class="card-head">\s*<span class="card-title">([^<]+)<\/span>([\s\S]*?)<\/div>\s*<div class="card-body card-body-flush">/g;
let count1 = 0;
html = html.replace(re1, (m, title, rest) => {
  count1++;
  // rest 里可能还有按钮等，去掉首尾空白
  const extra = rest.trim();
  return `<div>\n            <div class="group-label">\n              <span>${title}</span>${extra ? '\n              ' + extra : ''}\n            </div>\n            <div class="group">`;
});

// ---------- 2. card + card-head + card-body（普通） ----------
const re2 = /<div class="card">\s*<div class="card-head">\s*<span class="card-title">([^<]+)<\/span>([\s\S]*?)<\/div>\s*<div class="card-body">/g;
let count2 = 0;
html = html.replace(re2, (m, title, rest) => {
  count2++;
  const extra = rest.trim();
  return `<div>\n            <div class="group-label">\n              <span>${title}</span>${extra ? '\n              ' + extra : ''}\n            </div>\n            <div class="group">\n              <div class="group-pad">`;
});

fs.writeFileSync(FILE, html, 'utf8');
console.log(`card+flush 转换: ${count1}`);
console.log(`card+body 转换: ${count2}`);

// 统计剩余
const remainCard = (html.match(/<div class="card">/g) || []).length;
const remainHead = (html.match(/class="card-head"/g) || []).length;
const remainFoot = (html.match(/class="card-foot"/g) || []).length;
console.log(`剩余 card: ${remainCard}, card-head: ${remainHead}, card-foot: ${remainFoot}`);
