// 检查用户报告的第 6-16 项文案在字典中的覆盖情况
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const trans = JSON.parse(fs.readFileSync(path.join(root, 'src/core/dict/translations.json'), 'utf8'));

// 收集所有已翻译 key
const texts = {};
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const patterns = (trans.patterns || []).map(p => new RegExp(p[0], p[2] || ''));
const attrs = trans.attrs || {};
const attrPatterns = (trans.attrPatterns || []).map(p => new RegExp(p[0], p[2] || ''));

const reported = [
  // 6
  'Projects', 'No projects yet', 'Sessions', 'No sessions yet',
  // 7 Mode
  'Mode', 'Interactive', 'Step-by-step collaboration', 'Plan',
  'Plan first, execute when ready', 'Autopilot',
  'End-to-end execution without interruption', 'Tool permissions', 'Approve all',
  // 8 权限
  'Always ask', 'Ask before running tools.', 'Assisted',
  'Uses AI to reduce approval prompts.', 'Run tools without asking.',
  // 9-10
  'Model & reasoning', 'Model and reasoning',
  // 11
  'Add context & more',
  // 12
  'Environment',
  // 13
  'AI credits used: 0%',
  // 14
  'Manage accounts', 'Health check', "What's new", 'About', 'Help center',
  'General', 'Accounts', 'Themes',
  // 15-16
  'Checking for updates...', 'Up to date. Last checked on November 11, 2026, at 10:21 PM.',
  'Accessibility', 'Voice dictation', 'Computer Use', 'Preview',
  'Model providers', 'Experimental', 'Environments',
];

console.log('=== 覆盖检查 ===');
const missing = [];
for (const s of reported) {
  const inTexts = texts[s] !== undefined;
  const inAttrs = attrs[s] !== undefined;
  const inPattern = patterns.some(re => re.test(s));
  const inAttrPattern = attrPatterns.some(re => re.test(s));
  const covered = inTexts || inAttrs || inPattern || inAttrPattern;
  if (!covered) missing.push(s);
  console.log(`  ${covered ? '✓' : '✗'} ${JSON.stringify(s).slice(0, 60)}`);
}

console.log(`\n缺失 ${missing.length} / ${reported.length}`);
console.log('\n=== 缺失清单 ===');
missing.forEach(s => console.log('  ' + JSON.stringify(s)));
