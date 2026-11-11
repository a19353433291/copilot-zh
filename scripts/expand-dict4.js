// 第四轮：补齐剩余全部条目，力求采集集内 100% 覆盖
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const transPath = path.join(root, 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

const phrases = {
  'Next featured cards': '下一组精选卡片',
  'Previous featured cards': '上一组精选卡片',
  'Off': '关闭',
  'On': '开启',
  'Open settings': '打开设置',
  'Performance improvements': '性能改进',
  'Personal': '个人',
  'Plan': '计划',
  'Plan and manage Azure DevOps work in a visual, interactive workspace.':
    '在可视化交互工作区中计划和管理 Azure DevOps 工作。',
  'Plan, deploy, troubleshoot, and manage Azure resources with skills and MCP tools.':
    '使用技能和 MCP 工具计划、部署、排查和管理 Azure 资源。',
  'PlanetScale': 'PlanetScale',
  'Query metrics, logs, and dashboards in Grafana Cloud.':
    '在 Grafana Cloud 中查询指标、日志和仪表板。',
  'Query Microsoft 365 data with natural language — emails, meetings, documents, Teams messages, and more.':
    '用自然语言查询 Microsoft 365 数据——邮件、会议、文档、Teams 消息等。',
  'Read Airtable records, schemas, comments, and workspace metadata.':
    '读取 Airtable 记录、模式、评论和工作区元数据。',
  'Read and update Miro boards.': '读取并更新 Miro 看板。',
  'Repo audit': '仓库审计',
  'Resize sidebar': '调整侧边栏大小',
  'Review': '审查',
  'Review a PR for user-facing changes and suggest required telemetry events and properties.':
    '审查 PR 中的面向用户更改，并建议所需的遥测事件与属性。',
  'Review Jira work items from active sprints in a live dashboard.':
    '在实时仪表板中审查活跃冲刺中的 Jira 工作项。',
  'Review PRs merged yesterday and summarize any accessibility issues.':
    '审查昨天合并的 PR，并总结其中的无障碍问题。',
  'Review the latest GitHub issues and propose priorities and owners.':
    '审查最新的 GitHub 议题，并提出优先级和负责人建议。',
  'Review UI for usability and accessible design.': '审查 UI 的可用性与无障碍设计。',
  'Run Kusto queries and explore data in Azure Data Explorer.':
    '在 Azure Data Explorer 中运行 Kusto 查询并探索数据。',
  'SCORE': '得分',
  'Scroll tabs left': '向左滚动标签页',
  'Scroll tabs right': '向右滚动标签页',
  'Search and interact with Slack conversations and workspace content.':
    '搜索 Slack 对话和工作区内容并与之交互。',
  'Search and manage Jira and Confluence content with Atlassian Rovo.':
    '使用 Atlassian Rovo 搜索和管理 Jira 与 Confluence 内容。',
  'Search and manage Notion pages, databases, and workspace content.':
    '搜索和管理 Notion 页面、数据库和工作区内容。',
  'Search automations': '搜索自动化',
  'Search errors, analyze performance, triage issues, read documentation, and manage Sentry projects.':
    '搜索错误、分析性能、分类问题、阅读文档并管理 Sentry 项目。',
  'Search integrations': '搜索集成',
  'Search Microsoft Learn for documentation and guidance on Microsoft products and services.':
    '在 Microsoft Learn 中搜索 Microsoft 产品与服务的文档和指南。',
  'Search, create, edit, and export Canva designs.':
    '搜索、创建、编辑并导出 Canva 设计。',
  'Set up automations': '设置自动化',
  'Shared': '共享',
  'Shift': 'Shift',
  'Ship': '发布',
  'Standout ways to customize Copilot.': '值得一试的 Copilot 自定义方式。',
  'Summarize key merged PRs this week into a release-note draft.':
    '将本周合并的关键 PR 汇总为发布说明草稿。',
  'Supabase': 'Supabase',
  'Telemetry review': '遥测审查',
  'Terminal': '终端',
  'Test': '测试',
  'Test and automate web apps in browsers.': '在浏览器中测试并自动化 Web 应用。',
  'Triage live Sentry issues and hand them off to Copilot for tracking or a fix.':
    '分诊实时的 Sentry 问题，并交给 Copilot 跟踪或修复。',
  'Typeahead menu': '自动补全菜单',
  'Use agents to handle recurring work on a cadence you choose or triggered by events.':
    '让智能体按你设定的节奏或事件触发来处理重复性工作。',
  'Verified': '已认证',
  'Verified by GitHub': '由 GitHub 认证',
  'Web Design Guidelines': 'Web 设计指南',
  'To pick up a draggable item, press the space bar.\n    While dragging, use the arrow keys to move the item.\n    Press space again to drop the item in its new position, or press escape to cancel.':
    '按空格键拾取可拖动项。拖动时使用方向键移动该项。再次按空格键将其放到新位置，或按 Esc 取消。',
  'Review UI for usability and accessible design.': '审查 UI 的可用性与无障碍设计。',
  'Plan': '计划',
  'Ship': '发布',
  'Test': '测试',
};

if (!trans.ui) trans.ui = {};
const existing = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => existing.add(k));
}

let added = 0;
for (const [en, zh] of Object.entries(phrases)) {
  if (existing.has(en)) continue;
  trans.ui[en] = zh;
  added++;
}

// 追加模板：单字分类、搜索类
const extraPatterns = [
  ['^Search (.+)$', '搜索 $1', ''],
  ['^Next featured cards$', '下一组精选卡片', ''],
  ['^Previous featured cards$', '上一组精选卡片', ''],
];
const existPat = new Set((trans.patterns || []).map(p => p[0]));
let addedPat = 0;
for (const p of extraPatterns) if (!existPat.has(p[0])) { trans.patterns.push(p); addedPat++; }

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

// 最终统计
const live = JSON.parse(fs.readFileSync(path.join(root, 'dist-packs/live-strings.json'), 'utf8'));
const texts = {};
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const pats = trans.patterns.map(p => new RegExp(p[0], p[2] || ''));
const KEEP = new Set(trans._keepOriginal || []);
let covered = 0, kept = 0;
const miss = [];
for (const s of live.strings) {
  if (texts[s] !== undefined || pats.some(r => r.test(s))) { covered++; continue; }
  if (KEEP.has(s) || /^[a-z0-9._-]+$/.test(s)) { kept++; continue; }
  miss.push(s);
}
console.log('=== 第四轮完成 ===');
console.log('新增短语:', added, '| 新增模板:', addedPat);
console.log('texts 总数:', Object.keys(texts).length, '| patterns:', pats.length);
console.log('\n翻译覆盖:', covered, '/' + live.count, '= ' + (covered / live.count * 100).toFixed(1) + '%');
console.log('保留原文:', kept, '(' + (kept / live.count * 100).toFixed(1) + '%)');
console.log('仍缺:', miss.length, '(' + (miss.length / live.count * 100).toFixed(1) + '%)');
if (miss.length) { console.log('\n仍缺:'); miss.forEach(s => console.log('  ' + JSON.stringify(s))); }
