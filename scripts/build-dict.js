// 把运行时采集的文案整理成「待翻译清单」，并应用已有翻译合并成新字典。
//
// 用法：
//   node scripts/build-dict.js --prepare         生成待翻译清单 todo.json
//   node scripts/build-dict.js --merge           合并 translations.json 到字典并出包

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const LIVE = path.join(root, 'dist-packs', 'live-strings.json');
const TODO = path.join(root, 'dist-packs', 'todo.json');
const TRANS = path.join(root, 'src', 'core', 'dict', 'translations.json');
const SAMPLE = path.join(root, 'scripts', 'make-sample-pack.js');

const args = process.argv.slice(2);
const mode = args.includes('--merge') ? 'merge' : 'prepare';

/**
 * 判断一条文案是否值得翻译（排除标识符、技能名、占位文本等）
 */
function shouldTranslate(s) {
  const t = s.trim();
  if (!t || t.length < 2) return false;
  // 纯标识符（小写+连字符），多为技能/插件名
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(t)) return false;
  // 单个小写单词
  if (/^[a-z]+$/.test(t)) return false;
  // 形如 "xxx, view details" 的模板串，由 attrs/patterns 处理
  if (/^[a-z0-9-]+, view details$/.test(t)) return false;
  if (/^Actions for [a-z0-9-]+$/.test(t)) return false;
  if (/^[a-z0-9-]+ skill$/.test(t)) return false;
  // 单个按键名
  if (/^(Ctrl|Alt|Shift|Enter|Space|Tab|Esc|Escape|Arrow(Up|Down|Left|Right)|Meta|Cmd|Backspace|Delete|Home|End|Page(Up|Down)|F\d{1,2})$/.test(t)) return false;
  // 纯大写缩写
  if (/^[A-Z]{2,6}$/.test(t)) return false;
  // 邮箱/URL/路径
  if (/@|^https?:|^\/|^[A-Za-z]:\\/.test(t)) return false;
  // 单字符或纯符号
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  // 品牌/产品名（保留原文更合适）—— 只保留有明确中文习惯的
  const KEEP_AS_IS = new Set([
    'GitHub', 'GitHub Copilot', 'Copilot', 'Git', 'VS Code', 'Visual Studio Code',
    'Markdown', 'JSON', 'YAML', 'API', 'MCP', 'CI', 'PR', 'SDK', 'CLI', 'URL',
    'Airtable', 'Amplitude', 'Apify', 'Atlassian Rovo', 'Figma', 'Playwright',
    'Power BI', 'Azure DevOps', 'Semgrep', 'Linear', 'Notion', 'Slack', 'Jira',
    'Sentry', 'Datadog', 'Stripe', 'Postman', 'Docker', 'Kubernetes', 'Grafana',
  ]);
  if (KEEP_AS_IS.has(t)) return false;
  return true;
}

if (mode === 'prepare') {
  if (!fs.existsSync(LIVE)) {
    console.error('缺少采集数据，请先运行: node scripts/collect-live.js');
    process.exit(1);
  }
  const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const existing = fs.existsSync(TRANS) ? JSON.parse(fs.readFileSync(TRANS, 'utf8')) : {};
  const done = new Set(Object.keys(existing));

  const cand = live.strings.filter(s => shouldTranslate(s) && !done.has(s));
  // 按长度排序，先翻短的（界面按钮/标签优先）
  cand.sort((a, b) => a.length - b.length);

  fs.mkdirSync(path.dirname(TODO), { recursive: true });
  fs.writeFileSync(TODO, JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: '把每条 en 的 zh 填上中文即可，留空表示不翻译',
    count: cand.length,
    items: cand.map(en => ({ en, zh: '' })),
  }, null, 1));

  const stats = {
    collected: live.count,
    alreadyTranslated: done.size,
    todo: cand.length,
    filteredOut: live.count - cand.length - [...live.strings].filter(s => done.has(s)).length,
  };
  console.log('=== 待翻译清单已生成 ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('\n输出:', TODO);
  console.log('\n前 25 条待翻译：');
  cand.slice(0, 25).forEach((s, i) => console.log(`  ${String(i + 1).padStart(3)}. ${s.slice(0, 80)}`));
} else {
  // merge 模式：把 translations.json + 示例字典合成最终字典并出包
  console.log('合并模式：将 translations.json 合入示例字典');
  const extra = fs.existsSync(TRANS) ? JSON.parse(fs.readFileSync(TRANS, 'utf8')) : {};
  console.log('  translations.json 条目:', Object.keys(extra).length);
  console.log('  请运行 node scripts/make-sample-pack.js 出包（该脚本会读取 translations.json）');
}
