// 第三轮：补齐剩余常用词与短标签
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const transPath = path.join(root, 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

const newPhrases = {
  // 单字/短标签
  'Daily': '每天',
  'Data': '数据',
  'Debug': '调试',
  'Design': '设计',
  'Editor': '编辑器',
  'Dreaming': '构思中',
  'Install': '安装',
  'Manual': '手动',
  'MCP': 'MCP',
  'Message': '消息',
  'Monitor': '监控',
  'Improvements': '改进',
  'Knowledge': '知识',
  'Alt': 'Alt',
  'Ctrl': 'Ctrl',
  // 自动化
  'Create automation': '创建自动化',
  'New automation': '新建自动化',
  'Filter automations': '筛选自动化',
  'Manage sessions': '管理会话',
  'Issue triage': '议题分类',
  'Customize sections': '自定义区块',
  'Integration categories': '集成分类',
  'Cost tips': '成本优化建议',
  'More tabs': '更多标签页',
  'GitHub verified.': 'GitHub 已认证。',
  'Get personalized tips to reduce token usage and cost.':
    '获取减少令牌用量与成本的个性化建议。',
  'Copy virtualization traces': '复制虚拟化追踪',
  'MCP Servers ·': 'MCP 服务器 ·',
  'Impeccable Design': 'Impeccable 设计',
  // 连接器/集成描述（保留产品名，翻译动作部分）
  'Access Figma design files and design context.': '访问 Figma 设计文件与设计上下文。',
  'Analyze code security with Semgrep.': '使用 Semgrep 分析代码安全性。',
  'Analyze product usage data in Amplitude.': '在 Amplitude 中分析产品使用数据。',
  'Audit open PRs and identify blockers or risky changes.':
    '审查未关闭的 PR，识别阻塞项或高风险更改。',
  'Bring end-to-end Power BI semantic model authoring to your AI agents.':
    '为你的智能体带来端到端的 Power BI 语义模型编写能力。',
  'Build, test, and deploy hosted agents with Microsoft Foundry.':
    '使用 Microsoft Foundry 构建、测试并部署托管智能体。',
  'Create and manage Bitly links and view click analytics.':
    '创建和管理 Bitly 链接，并查看点击分析。',
  'Design, critique, and polish product interfaces with expert guidance.':
    '在专家指导下设计、评审和打磨产品界面。',
  'Explore Mixpanel analytics through its US-hosted MCP server.':
    '通过其美国托管的 MCP 服务器探索 Mixpanel 分析。',
  'Find and manage services and software catalog data in Port.':
    '在 Port 中查找和管理服务与软件目录数据。',
  'Find and run Apify Actors to collect and process web data.':
    '查找并运行 Apify Actors 以收集和处理网页数据。',
  'Find answers across Microsoft 365 emails, meetings, documents, and Teams messages.':
    '在 Microsoft 365 的邮件、会议、文档和 Teams 消息中查找答案。',
  'Find, create, and update issues, projects, and comments in Linear.':
    '在 Linear 中查找、创建和更新议题、项目与评论。',
  'Identify 10 performance improvements, then open a PR for the highest-impact, lowest-effort one.':
    '找出 10 项性能改进，并为影响最大、成本最低的一项发起 PR。',
  'Inspect and manage Cloudflare resources.': '检查和管理 Cloudflare 资源。',
  'Inspect and manage LaunchDarkly feature flags.': '检查和管理 LaunchDarkly 功能开关。',
  'Inspect and manage Netlify sites and deployments.': '检查和管理 Netlify 站点与部署。',
  'Inspect and manage Statsig feature gates and experiments.':
    '检查和管理 Statsig 功能开关与实验。',
  'Inspect and manage Vercel projects and deployments.': '检查和管理 Vercel 项目与部署。',
  'Investigate failing Azure apps with Azure SRE Agent in an interactive canvas.':
    '使用 Azure SRE Agent 在交互式画布中排查失败的 Azure 应用。',
  'Manage Azure DevOps repositories, work items, and pipelines from Copilot.':
    '在 Copilot 中管理 Azure DevOps 仓库、工作项和流水线。',
  'Manage Neon projects and query Postgres databases.':
    '管理 Neon 项目并查询 Postgres 数据库。',
  'Manage scheduling and meetings in Calendly.':
    '在 Calendly 中管理日程与会议。',
};

if (!trans.ui) trans.ui = {};
let added = 0;
const existing = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => existing.add(k));
}
for (const [en, zh] of Object.entries(newPhrases)) {
  if (existing.has(en)) continue;
  trans.ui[en] = zh;
  added++;
}

// 品牌保留名单扩充
const moreBrands = ['LaunchDarkly', 'Lucid', 'Miro', 'Mixpanel', 'Neon', 'Netlify',
  'Vercel', 'Statsig', 'Port', 'Microsoft Learn Docs', 'Microsoft 365', 'Grafana Cloud',
  'LeWang', 'Azure SRE Agent', 'Bitly'];
const keep = new Set(trans._keepOriginal || []);
moreBrands.forEach(b => keep.add(b));
trans._keepOriginal = [...keep];

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

// 统计
const live = JSON.parse(fs.readFileSync(path.join(root, 'dist-packs/live-strings.json'), 'utf8'));
const texts = {};
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.assign(texts, v);
}
const pats = trans.patterns.map(p => new RegExp(p[0], p[2] || ''));
const KEEP = new Set(trans._keepOriginal);
let covered = 0, kept = 0;
const miss = [];
for (const s of live.strings) {
  if (texts[s] !== undefined || pats.some(r => r.test(s))) { covered++; continue; }
  if (KEEP.has(s) || /^[a-z0-9._-]+$/.test(s)) { kept++; continue; }
  miss.push(s);
}
console.log('=== 第三轮完成 ===');
console.log('新增:', added);
console.log('翻译覆盖:', covered, '/' + live.count, '(' + (covered / live.count * 100).toFixed(1) + '%)');
console.log('保留原文:', kept);
console.log('仍缺:', miss.length, '(' + (miss.length / live.count * 100).toFixed(1) + '%)');
console.log('\n仍缺:');
miss.forEach(s => console.log('  ' + JSON.stringify(s)));
console.log('\ntexts 总条目:', Object.keys(texts).length);
