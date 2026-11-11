// 补充第 6-16 项文案：模式选择、权限、设置页、时间本地化
'use strict';

const fs = require('fs');
const path = require('path');

const transPath = path.join(path.resolve(__dirname, '..'), 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

// ---------------------------------------------------------------------------
// 1. 精确文案
// ---------------------------------------------------------------------------

const newTexts = {
  // ---- 模式选择器 ----
  'Mode': '模式',
  'Interactive': '交互式',
  'Step-by-step collaboration': '逐步协作',
  'Plan': '计划',
  'Plan first, execute when ready': '先制定计划，就绪后执行',
  'Autopilot': '自动驾驶',
  'End-to-end execution without interruption': '端到端执行，不中断',
  'Tool permissions': '工具权限',
  'Approve all': '全部批准',
  'Always ask': '始终询问',
  'Ask before running tools.': '运行工具前询问。',
  'Assisted': '辅助模式',
  'Uses AI to reduce approval prompts.': '使用 AI 减少批准提示。',
  'Run tools without asking.': '无需询问即可运行工具。',

  // ---- 模型与上下文 ----
  'Model & reasoning': '模型与推理',
  'Model and reasoning': '模型与推理',
  'Add context & more': '添加上下文及更多',
  'Environment': '环境',
  'Environments': '环境',

  // ---- 额度 ----
  'AI credits used: 0%': '已用 AI 积分：0%',

  // ---- 账户菜单 ----
  'Manage accounts': '管理账户',
  'Accounts': '账户',
  'Health check': '健康检查',
  "What's new": '新功能',
  'What’s new': '新功能',
  'Help center': '帮助中心',
  'Checking for updates...': '正在检查更新…',
  'Checking for updates…': '正在检查更新…',
  'Check for updates': '检查更新',

  // ---- 设置页导航 ----
  'Accessibility': '无障碍',
  'Voice dictation': '语音听写',
  'Computer Use': 'Computer Use',
  'Preview': '预览版',
  'Model providers': '模型提供商',
  'Experimental': '实验性功能',
  'General': '通用',
  'Themes': '主题',
  'Theme': '主题',
  'Shortcuts': '快捷键',
  'Keyboard shortcuts': '键盘快捷键',
  'About': '关于',
  'Version': '版本',
  'Updates': '更新',
  'Update': '更新',
  'Privacy': '隐私',
  'Behavior': '行为',
  'Appearance': '外观',
  'Notifications': '通知',

  // ---- 更新状态 ----
  'Up to date': '已是最新版本',
  'Update available': '有可用更新',
  'Downloading update…': '正在下载更新…',
  'Downloading update...': '正在下载更新…',
  'Restart to update': '重启以更新',

  // ---- 其他常见 ----
  'Sign in': '登录',
  'Sign out': '退出登录',
  'Switch account': '切换账户',
  'Add account': '添加账户',
  'Personal account': '个人账户',
  'Organization': '组织',
  'Organizations': '组织',
  'Loading...': '加载中…',
  'Loading…': '加载中…',
  'Copied to clipboard': '已复制到剪贴板',
  'Copy to clipboard': '复制到剪贴板',
  'Show more': '显示更多',
  'Show less': '收起',
  'Learn more': '了解更多',
  'Documentation': '文档',
  'Report an issue': '报告问题',
  'Send feedback': '发送反馈',
  'Privacy statement': '隐私声明',
  'Terms of service': '服务条款',
  'Release notes': '发布说明',
  'Changelog': '更新日志',
};

// ---------------------------------------------------------------------------
// 2. 时间/日期本地化（关键需求）
// ---------------------------------------------------------------------------

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, Jun: 6, Jul: 7, Aug: 8,
  Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12,
};

/**
 * 生成「Up to date. Last checked on <date>, at <time>.」的匹配正则。
 * 由于字典的 patterns 只能做纯文本替换、无法计算，
 * 这里把常见格式逐一枚举，覆盖大部分实际出现的组合。
 */
const timePatterns = [
  // Up to date. Last checked on November 11, 2026, at 10:21 PM.
  ['^Up to date\\. Last checked on ([A-Za-z]+) (\\d{1,2}), (\\d{4}),? at (\\d{1,2}):(\\d{2})\\s*([AP]M)\\.?$', null, ''],
  // Last checked on November 11, 2026, at 10:21 PM.
  ['^Last checked on ([A-Za-z]+) (\\d{1,2}), (\\d{4}),? at (\\d{1,2}):(\\d{2})\\s*([AP]M)\\.?$', null, ''],
  // Last checked on November 11, 2026.
  ['^Last checked on ([A-Za-z]+) (\\d{1,2}), (\\d{4})\\.?$', null, ''],
  // Up to date. Last checked on 11/11/2026, at 10:21 PM.
  ['^Up to date\\. Last checked on (\\d{1,2})/(\\d{1,2})/(\\d{4}),? at (\\d{1,2}):(\\d{2})\\s*([AP]M)\\.?$', null, ''],
  // November 11, 2026, at 10:21 PM（单独日期时间）
  ['^([A-Za-z]+) (\\d{1,2}), (\\d{4}),? at (\\d{1,2}):(\\d{2})\\s*([AP]M)$', null, ''],
  // November 11, 2026
  ['^([A-Za-z]+) (\\d{1,2}), (\\d{4})$', null, ''],
  // 10:21 PM
  ['^(\\d{1,2}):(\\d{2})\\s*([AP]M)$', null, ''],
];

// ---------------------------------------------------------------------------
// 合并
// ---------------------------------------------------------------------------

let addedTexts = 0;
if (!trans.ui) trans.ui = {};
// 收集已有的所有 key
const existing = new Set();
for (const [g, v] of Object.entries(trans)) {
  if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) continue;
  if (v && typeof v === 'object') Object.keys(v).forEach(k => existing.add(k));
}

for (const [en, zh] of Object.entries(newTexts)) {
  if (existing.has(en)) continue;
  trans.ui[en] = zh;
  addedTexts++;
}

// 时间格式作为 pattern 加入（回调式，因为需要计算月份数字）
// 字典 pattern 只支持字符串替换，无法计算 → 改用固定映射月份
// 因此这里枚举 12 个月份的完整组合是不现实的（12×31×小时组合）
// 更优方案：用 '$1年$2月$3日' 这种形式，但英文月份名需要转数字。
// 解决：把「月份名 + 日 + 年」整体交给一个特殊标记，由注入脚本处理。
// 简化：直接输出「2026年11月11日 22:21」这种中文格式——
// 月份用替换规则实现：把常见英文月份短语直接枚举替换。

// 采用可行方案：日期用固定格式正则 + 月份名单独替换
const extraPatterns = [
  // 去掉英文句式，保留日期部分交给后续处理
  ['^Up to date\\. Last checked on (.+)$', '已是最新版本。上次检查：$1', ''],
  ['^Last checked on (.+)$', '上次检查：$1', ''],
  // 纯日期：November 11, 2026 → 2026年11月11日（月份名用下面 attrs/月份表处理）
  ['^([A-Za-z]+) (\\d{1,2}), (\\d{4})$', '$3年$1$2日', ''],
];

// 月份名 → 中文数字，作为独立精确映射（配合上面的 ^([A-Za-z]+) (\d{1,2}), (\d{4})$ 使用）
// 但 $1 会被原样输出，所以必须把月份先替换掉。
// 最终方案：放弃正则组合，改用注入脚本内的日期处理器（见 build-pack.js 的 dateLocalize 标记）

const existPat = new Set((trans.patterns || []).map(p => p[0]));
let addedPat = 0;
for (const p of extraPatterns) {
  if (!existPat.has(p[0])) { trans.patterns.push(p); addedPat++; }
}

// 标记需要日期本地化（由注入脚本运行时处理）
trans._dateLocalize = true;

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

console.log('=== 字典补充完成 ===');
console.log('新增精确文案:', addedTexts);
console.log('新增正则:', addedPat);
console.log('日期本地化标记:', trans._dateLocalize);
console.log('texts 总数:', Object.keys(
  Object.entries(trans).reduce((acc, [g, v]) => {
    if (g.startsWith('_') || ['patterns', 'attrs', 'attrPatterns'].includes(g)) return acc;
    if (v && typeof v === 'object') Object.assign(acc, v);
    return acc;
  }, {})
).length);
