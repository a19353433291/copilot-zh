// 第二轮扩充：补齐模板类、快捷键、前缀类文案
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const transPath = path.join(root, 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

const newPhrases = {
  'Checking…': '检查中…',
  'Dashboards is not available.': '仪表板不可用。',
  'Editor’s picks': '编辑精选',
  'Pressure-test your product plan.': '压力测试你的产品计划。',
  'Search MCP servers, plugins, skills and more…': '搜索 MCP 服务器、插件、技能等…',
  'Search personal automations…': '搜索个人自动化…',
  'What task would you like to automate?': '你想自动化什么任务？',
  'MCP Servers': 'MCP 服务器',
  'Communication': '沟通',
  'Environment: This computer': '环境：此电脑',
  'Filter by type: All types': '按类型筛选：所有类型',
  'Review your session\'s changes for vulnerabilities and fix code scanning alerts':
    '审查会话中的更改是否存在漏洞，并修复代码扫描警报',
  'Copy PR description scroll logs': '复制 PR 描述滚动日志',
  'Copy widget creation logs': '复制小组件创建日志',
  'Browser, new session': '浏览器，新会话',
  'New session for Browser': '为浏览器新建会话',
  'New session for Editor': '为编辑器新建会话',
  'New session for Terminal': '为终端新建会话',
  'Repository: Chat': '仓库：对话',
  'Install skill: Web Design Guidelines': '安装技能：Web 设计指南',
  'Install skill: Grill Me by Matt Pocock': '安装技能：Grill Me（Matt Pocock）',
  'Grill Me by Matt Pocock': 'Grill Me（Matt Pocock）',
  'Enable: Impeccable Design': '启用：Impeccable 设计',
  'GitHub Security': 'GitHub 安全',
  'Universe ’26': 'Universe ’26',
};

// 模板规则
const newPatterns = [
  ['^Install: (.+)$', '安装：$1', ''],
  ['^Install skill: (.+)$', '安装技能：$1', ''],
  ['^Enable: (.+)$', '启用：$1', ''],
  ['^Environment: (.+)$', '环境：$1', ''],
  ['^Repository: (.+)$', '仓库：$1', ''],
  ['^Filter by type: (.+)$', '按类型筛选：$1', ''],
  ['^New session for (.+)$', '为 $1 新建会话', ''],
  ['^(.+) plugin$', '$1 插件', ''],
  ['^(Ctrl|Alt|Shift|Control) \\+ (.+)$', '$1 + $2', ''],
];

let added = 0;
if (!trans.ui) trans.ui = {};
for (const [en, zh] of Object.entries(newPhrases)) {
  // ui 组已有则不覆盖
  let exists = false;
  for (const [g, v] of Object.entries(trans)) {
    if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
    if (v && typeof v === 'object' && v[en] !== undefined) { exists = true; break; }
  }
  if (!exists) { trans.ui[en] = zh; added++; }
}

const existPat = new Set((trans.patterns || []).map(p => p[0]));
let addedPat = 0;
for (const p of newPatterns) if (!existPat.has(p[0])) { trans.patterns.push(p); addedPat++; }

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

// 重新统计
const live = JSON.parse(fs.readFileSync(path.join(root, 'dist-packs/live-strings.json'), 'utf8'));
const texts = {};
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const pats = trans.patterns.map(p => new RegExp(p[0], p[2] || ''));

const KEEP = new Set(trans._keepOriginal || []);
let covered = 0, keptBrand = 0;
const stillMissing = [];
for (const s of live.strings) {
  if (texts[s] !== undefined) { covered++; continue; }
  if (pats.some(re => re.test(s))) { covered++; continue; }
  if (KEEP.has(s)) { keptBrand++; continue; }
  // 纯小写标识符视为不需要翻译
  if (/^[a-z0-9-]+$/.test(s)) { keptBrand++; continue; }
  stillMissing.push(s);
}

console.log('=== 第二轮扩充 ===');
console.log('新增短语:', added, '| 新增模板:', addedPat);
console.log('\n=== 覆盖统计（采集 ' + live.count + ' 条）===');
console.log('已覆盖翻译:', covered, '(' + (covered / live.count * 100).toFixed(1) + '%)');
console.log('保留原文(品牌/标识符):', keptBrand);
console.log('仍缺:', stillMissing.length, '(' + (stillMissing.length / live.count * 100).toFixed(1) + '%)');
console.log('\n仍缺全部:');
stillMissing.forEach(s => console.log('  ' + JSON.stringify(s)));
