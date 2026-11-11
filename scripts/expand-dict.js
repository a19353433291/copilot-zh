// 基于采集结果自动扩充 translations.json：
// 1. 模板类（xxx 技能 / xxx 的操作 / 查看详情）→ 转为 pattern，无需逐条翻译
// 2. 常见界面短语 → 补充精确映射
// 3. 品牌/服务名 → 加入「保留原文」白名单（不翻译）
//
// 用法：node scripts/expand-dict.js

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const livePath = path.join(root, 'dist-packs/live-strings.json');
const transPath = path.join(root, 'src/core/dict/translations.json');

const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

// 已收录的 key
const known = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => known.add(k));
}

const missing = live.strings.filter(s => !known.has(s));

// ---------------------------------------------------------------------------
// 1. 高频界面短语（人工翻译）
// ---------------------------------------------------------------------------
const newPhrases = {
  // 通用动作
  'Actions': '操作',
  'Browse': '浏览',
  'Browser': '浏览器',
  'Build': '构建',
  'Built-in': '内置',
  'All types': '所有类型',
  'Change theme mode': '切换主题模式',
  'Change view…': '更改视图…',
  'Check for updates': '检查更新',
  'Command palette': '命令面板',
  'Configure sessions': '配置会话',
  'Connecting': '正在连接',
  'Copy link': '复制链接',
  'Copy path': '复制路径',
  'Create from…': '创建自…',
  'Customize': '自定义',
  'Details': '详情',
  'Documentation': '文档',
  'Filter by…': '筛选条件…',
  'Go to Home': '前往主页',
  'Go to Issues': '前往议题',
  'Go to Pull requests': '前往拉取请求',
  'Go to Automations': '前往自动化',
  'Go to Settings': '前往设置',
  'Navigation': '导航',
  'New issue': '新建议题',
  'New project': '新建项目',
  'New session': '新建会话',
  'New chat': '新建对话',
  'No GitHub repositories yet': '暂无 GitHub 仓库',
  'Nothing to undo.': '没有可撤销的操作。',
  'Open detail panel': '打开详情面板',
  'Open URL from clipboard': '从剪贴板打开 URL',
  'Reset zoom level': '重置缩放',
  'Resume remote session': '恢复远程会话',
  'Resume session by ID': '按 ID 恢复会话',
  'User profile and settings': '用户资料与设置',
  'Utility': '实用工具',
  'What feedback would you like to share?': '你想分享什么反馈？',
  'Automation goal': '自动化目标',
  'Automation views': '自动化视图',
  'Accessibility audit': '无障碍审查',
  'Changelog draft': '更新日志草稿',
  'Checking installed plugins': '正在检查已安装插件',
  'Connect': '连接',
  'Disconnect': '断开连接',
  'Installed': '已安装',
  'Available': '可用',
  'Featured': '精选',
  'Popular': '热门',
  'Recent': '最近',
  'Favorites': '收藏',
  'Pinned': '已置顶',
  'Archived': '已归档',
  'More actions': '更多操作',
  'View': '查看',
  'Hide': '隐藏',
  'Show': '显示',
  'Expand': '展开',
  'Collapse': '折叠',
  'Search projects, repositories, PRs, issues, or paste a URL…':
    '搜索项目、仓库、PR、议题，或粘贴 URL…',
  'Computer Use is currently in preview.': 'Computer Use 目前处于预览阶段。',
  'To pick up a draggable item, press the space bar.': '要拾取可拖动项，请按空格键。',
};

// 2. 品牌/服务名：保留原文（不翻译）。放进独立分组用于说明，不进 texts。
const brands = [
  'Airtable', 'Amplitude', 'Apify', 'Atlassian Rovo', 'Azure', 'Azure Data Explorer',
  'Azure DevOps', 'Azure SRE Agent', 'Bitly', 'Buildkite', 'Calendly', 'Canva',
  'ClickUp', 'Cloudflare', 'Composio', 'Datadog', 'Figma', 'Grafana', 'Jira',
  'Kubernetes', 'Linear', 'Notion', 'Playwright', 'Postman', 'Power BI',
  'Semgrep', 'Sentry', 'Slack', 'Stripe', 'Docker', 'Microsoft Foundry',
];

// 3. 模板类 → pattern（避免逐条翻译实体名）
const newPatterns = [
  // "xxx skill" / "xxx, view details" / "Actions for xxx"
  ['^(.+) skill$', '$1 技能', ''],
  ['^(.+), view details$', '$1，查看详情', ''],
  ['^Actions for (.+)$', '$1 的操作', ''],
  ['^Add server: (.+)$', '添加服务器：$1', ''],
  ['^Connect (.+)$', '连接 $1', ''],
  ['^(.+), new session$', '$1，新会话', ''],
  ['^(.+), open user menu$', '打开 $1 的用户菜单', ''],
  // 快捷键提示
  ['^(.+), Ctrl \\+ (.+)$', '$1, Ctrl + $2', ''],
  ['^(.+), Control \\+ (.+)$', '$1, Control + $2', ''],
  ['^(.+), Alt \\+ (.+)$', '$1, Alt + $2', ''],
  // 以句号结尾的示例卡描述（"xxx。Creates a sample folder."）
  ['^(.+)\\. Creates a sample folder\\.$', '创建示例文件夹。', ''],
  // 数字类
  ['^(\\d+) improvements available$', '有 $1 项改进可用', ''],
  ['^AI credits quota: (\\d+)% used(.*)$', 'AI 积分配额：已用 $1%$2', ''],
];

// ---------------------------------------------------------------------------
// 合并
// ---------------------------------------------------------------------------

// 清理样例卡描述里重复的句号问题
delete newPhrases['New chat']; // 已有

let addedPhrases = 0;
for (const [en, zh] of Object.entries(newPhrases)) {
  if (known.has(en)) continue;
  if (!trans.actions) trans.actions = {};
  // 放到 ui 分组
  if (!trans.ui) trans.ui = {};
  trans.ui[en] = zh;
  addedPhrases++;
}

// 追加 pattern（去重）
const existPat = new Set((trans.patterns || []).map(p => p[0]));
let addedPat = 0;
for (const p of newPatterns) {
  if (!existPat.has(p[0])) { trans.patterns.push(p); addedPat++; }
}

// 记录品牌保留名单（供文档与检查用，不进字典）
trans._keepOriginal = brands;

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

console.log('=== 字典扩充完成 ===');
console.log('新增短语:', addedPhrases);
console.log('新增模板规则:', addedPat);
console.log('保留原文品牌数:', brands.length);
console.log('当前 pattern 总数:', trans.patterns.length);

// 重新统计缺口
const texts = {};
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const patterns = trans.patterns.map(p => new RegExp(p[0], p[2] || ''));
let covered = 0;
const stillMissing = [];
for (const s of live.strings) {
  if (texts[s] !== undefined) { covered++; continue; }
  if (patterns.some(re => re.test(s))) { covered++; continue; }
  stillMissing.push(s);
}
console.log('\n=== 覆盖情况（针对已采集 ' + live.count + ' 条）===');
console.log('可覆盖:', covered, '(' + (covered / live.count * 100).toFixed(1) + '%)');
console.log('仍缺:', stillMissing.length);
console.log('\n仍缺前 30:');
stillMissing.slice(0, 30).forEach(s => console.log('  ' + JSON.stringify(s)));
