// 基于采集数据自动补全字典：把高频模板类文案转为 pattern，实体名加入白名单
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const live = JSON.parse(fs.readFileSync(path.join(root, 'dist-packs/live-strings.json'), 'utf8'));
const transPath = path.join(root, 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

// 统计缺失项，归类
const known = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => known.add(k));
}
const missing = live.strings.filter(s => !known.has(s));

// 分类器
const buckets = {
  skillSuffix: [],      // "xxx skill"
  viewDetails: [],      // "xxx, view details"
  actionsFor: [],       // "Actions for xxx"
  serverAdd: [],        // "Add server: xxx"
  brand: [],            // 品牌/服务名（保留原文）
  codeName: [],         // 小写标识符（技能/插件 id）
  sentence: [],         // 真正的句子
  other: [],
};

for (const s of missing) {
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s) || /^[a-z]{1,3}$/.test(s)) { buckets.codeName.push(s); continue; }
  if (/ skill$/.test(s)) { buckets.skillSuffix.push(s); continue; }
  if (/, view details$/.test(s)) { buckets.viewDetails.push(s); continue; }
  if (/^Actions for /.test(s)) { buckets.actionsFor.push(s); continue; }
  if (/^Add server: /.test(s)) { buckets.serverAdd.push(s); continue; }
  if (s.includes('. ')) { buckets.sentence.push(s); continue; }
  if (/\s/.test(s) && /^[A-Z]/.test(s)) { buckets.other.push(s); continue; }
  buckets.brand.push(s);
}

console.log('=== 缺失分类 ===');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(14)} ${v.length}`);

console.log('\n=== sentence（需人工翻译）===');
buckets.sentence.slice(0, 40).forEach(s => console.log('  ' + JSON.stringify(s)));
console.log('\n=== other（需人工翻译）===');
buckets.other.slice(0, 60).forEach(s => console.log('  ' + JSON.stringify(s)));
console.log('\n=== brand（保留原文，共 ' + buckets.brand.length + '）===');
console.log('  ' + buckets.brand.slice(0, 40).join(' | '));
