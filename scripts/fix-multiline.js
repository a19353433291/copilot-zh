// 修复字典中的多行 key：界面实际渲染时换行会被规范化，
// 因此这类 key 应拆成 textPatterns 或规范化后的单行形式。
'use strict';

const fs = require('fs');
const path = require('path');

const transPath = path.join(path.resolve(__dirname, '..'), 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

let fixed = 0;

// 1. 处理所有分组中含换行的 key
for (const [group, val] of Object.entries(trans)) {
  if (group.startsWith('_') || ['patterns', 'attrPatterns'].includes(group)) continue;
  if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

  for (const key of Object.keys(val)) {
    if (!/[\r\n]/.test(key)) continue;
    const zh = val[key];
    delete val[key];

    // 规范化：空白折叠为单空格
    const normalized = key.replace(/\s+/g, ' ').trim();
    // 同时补一条正则：匹配任意空白
    const escaped = normalized
      .split(' ')
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    trans.patterns = trans.patterns || [];
    const exists = trans.patterns.some(p => p[0] === '^' + escaped + '$');
    if (!exists) {
      trans.patterns.unshift(['^' + escaped + '$', zh, '']);
    }
    fixed++;
    console.log('修复多行 key → 正则:', JSON.stringify(normalized).slice(0, 70));
  }
}

// 2. 移除跨分组重复（保留先出现的）
const seen = new Map();
for (const [group, val] of Object.entries(trans)) {
  if (group.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(group)) continue;
  if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
  for (const key of Object.keys(val)) {
    if (seen.has(key)) {
      console.log(`移除重复 key: "${key}" (${group} 中，首次出现在 ${seen.get(key)})`);
      delete val[key];
    } else {
      seen.set(key, group);
    }
  }
}

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));
console.log('\n修复多行 key:', fixed);
console.log('patterns 总数:', (trans.patterns || []).length);
