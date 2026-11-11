// 校验 README markdown 结构
const fs = require('fs');

for (const f of ['README.md', 'README.en.md']) {
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split(/\r?\n/);
  console.log('--- ' + f + ' ---');
  console.log('  总行数:', lines.length);

  const h = {};
  lines.forEach(l => {
    const m = l.match(/^(#{1,6})\s/);
    if (m) h[m[1].length] = (h[m[1].length] || 0) + 1;
  });
  console.log('  标题层级:', JSON.stringify(h));

  const fence = '```';
  let codeBlocks = 0;
  for (const l of lines) if (l.trim().startsWith(fence)) codeBlocks++;
  console.log('  代码围栏数:', codeBlocks, codeBlocks % 2 === 0 ? '(成对 ✓)' : '(奇数 ✗ 未闭合)');

  const tables = lines.filter(l => /^\|/.test(l)).length;
  console.log('  表格行数:', tables);

  // 检查表格列数一致性
  let inTable = false, cols = 0, bad = 0;
  lines.forEach((l, i) => {
    if (/^\|/.test(l)) {
      const n = (l.match(/\|/g) || []).length;
      if (!inTable) { inTable = true; cols = n; }
      else if (n !== cols) { bad++; console.log('  ⚠ 第' + (i + 1) + ' 行表格列数不一致'); }
    } else {
      inTable = false;
    }
  });
  if (!bad) console.log('  ✓ 表格结构一致');

  // 检查标题唯一性（避免锚点冲突）
  const titleTexts = lines.filter(l => /^#{1,6}\s/.test(l)).map(l => l.replace(/^#+\s*/, '').trim());
  const dup = titleTexts.filter((t, i) => titleTexts.indexOf(t) !== i);
  if (dup.length) console.log('  ⚠ 重复标题:', dup.join(', '));
  else console.log('  ✓ 标题无重复');
}
