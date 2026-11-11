// 补充属性正则：处理 "Mode: Interactive, Ctrl + Shift + M" 这类组合提示
'use strict';

const fs = require('fs');
const path = require('path');

const transPath = path.join(path.resolve(__dirname, '..'), 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

// 补充精确文本
const moreTexts = {
  'Add context & more': '添加上下文及更多',
  'Set up voice dictation': '设置语音听写',
  'Send message': '发送消息',
  'Typeahead menu': '自动补全菜单',
  'Tool permissions, Approve all': '工具权限，全部批准',
  'Repository: Chat': '仓库：对话',
  'Environment: This computer': '环境：此电脑',
  'Build a weather app that shows live forecasts. Creates a sample folder.':
    '构建一个显示实时天气的应用。创建示例文件夹。',
  'Build a personal landing page with dark mode. Creates a sample folder.':
    '构建一个带深色模式的个人落地页。创建示例文件夹。',
  'Create a space exploration quiz with animated feedback. Creates a sample folder.':
    '创建一个带动态反馈的太空探索问答。创建示例文件夹。',
  'New session, Ctrl + N. New chat, Ctrl + Shift + N.':
    '新建会话 Ctrl + N。新建对话 Ctrl + Shift + N。',
};

// 属性正则（顺序很重要：具体在前）
const attrPatterns = [
  // Mode: Interactive, Ctrl + Shift + M
  ['^Mode: (.+), Ctrl \\+ Shift \\+ ([A-Z])$', '模式：$1, Ctrl + Shift + $2', ''],
  ['^Mode: (.+), Ctrl \\+ Shift \\+([A-Z])$', '模式：$1, Ctrl + Shift + $2', ''],
  // Default, model and reasoning, Ctrl + Shift + E
  ['^(.+), model and reasoning, Ctrl \\+ Shift \\+ ([A-Z])$', '$1, 模型与推理, Ctrl + Shift + $2', ''],
  ['^(.+), model and reasoning$', '$1, 模型与推理', ''],
  // Tool permissions, Approve all
  ['^Tool permissions, (.+)$', '工具权限，$1', ''],
  // Environment: xxx
  ['^Environment: (.+)$', '环境：$1', ''],
  // Repository: xxx
  ['^Repository: (.+)$', '仓库：$1', ''],
  // 通用：xxx, Ctrl + X
  ['^(.+), Ctrl \\+ (.+)$', '$1, Ctrl + $2', ''],
  ['^(.+), Control \\+ (.+)$', '$1, Control + $2', ''],
  ['^(.+), Alt \\+ (.+)$', '$1, Alt + $2', ''],
  ['^(.+), Shift \\+ (.+)$', '$1, Shift + $2', ''],
];

// 补充模式/权限选项文案
const modeTexts = {
  'Interactive': '交互式',
  'Plan': '计划',
  'Autopilot': '自动驾驶',
  'Step-by-step collaboration': '逐步协作',
  'Plan first, execute when ready': '先制定计划，就绪后执行',
  'End-to-end execution without interruption': '端到端执行，不中断',
  'Always ask': '始终询问',
  'Ask before running tools.': '运行工具前询问。',
  'Assisted': '辅助模式',
  'Uses AI to reduce approval prompts.': '使用 AI 减少批准提示。',
  'Approve all': '全部批准',
  'Run tools without asking.': '无需询问即可运行工具。',
  'Tool permissions': '工具权限',
  'Mode': '模式',
};

// 合并
if (!trans.ui) trans.ui = {};
const existing = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => existing.add(k));
}

let added = 0;
for (const [en, zh] of Object.entries({ ...moreTexts, ...modeTexts })) {
  if (existing.has(en)) continue;
  trans.ui[en] = zh;
  added++;
}

// 属性正则：新的在前，保证具体规则优先匹配
const existAttrPat = new Set((trans.attrPatterns || []).map(p => p[0]));
const toAdd = attrPatterns.filter(p => !existAttrPat.has(p[0]));
// 移除旧的通用规则避免歧义：保留但排在后
const oldGeneric = (trans.attrPatterns || []).filter(p =>
  !toAdd.some(n => n[0] === p[0])
);
trans.attrPatterns = toAdd.concat(oldGeneric);

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

console.log('新增文本:', added);
console.log('attrPatterns 总数:', trans.attrPatterns.length);
console.log('新增属性规则:', toAdd.length);
