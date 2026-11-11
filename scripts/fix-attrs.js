// 修正属性正则（处理快捷键提示类文案），并补充 attrs
'use strict';

const fs = require('fs');
const path = require('path');

const transPath = path.join(path.resolve(__dirname, '..'), 'src/core/dict/translations.json');
const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));

// 属性正则：顺序重要，具体在前、通用在后
trans.attrPatterns = [
  ['^Back, Ctrl \\+ Left bracket$', '返回, Ctrl + [', ''],
  ['^Forward, Ctrl \\+ Right bracket$', '前进, Ctrl + ]', ''],
  ['^New project, Ctrl \\+ Alt \\+ Shift \\+ N$', '新建项目, Ctrl + Alt + Shift + N', ''],
  ['^New session, Ctrl \\+ N\\. New chat, Ctrl \\+ Shift \\+ N\\.$',
    '新建会话 Ctrl + N。新建对话 Ctrl + Shift + N。', ''],
  ['^Settings, Ctrl \\+ Comma$', '设置, Ctrl + ,', ''],
  ['^Share feedback, Control \\+ Enter$', '分享反馈, Control + Enter', ''],
  ['^Search, Ctrl \\+ K$', '搜索, Ctrl + K', ''],
  ['^Toggle sidebar, Ctrl \\+ B$', '切换侧边栏, Ctrl + B', ''],
  ['^(.+), view details$', '$1，查看详情', ''],
  ['^Actions for (.+)$', '$1 的操作', ''],
  ['^(.+), open user menu$', '打开 $1 的用户菜单', ''],
  ['^Open user menu for (.+)$', '打开 $1 的用户菜单', ''],
  ['^(.+), Ctrl \\+ (.+)$', '$1, Ctrl + $2', ''],
  ['^(.+), Control \\+ (.+)$', '$1, Control + $2', ''],
  ['^(.+), Alt \\+ (.+)$', '$1, Alt + $2', ''],
  ['^Search (\\d+) skills…$', '搜索 $1 个技能…', ''],
  ['^(.+) skill$', '$1 技能', ''],
  ['^(\\d+) (session|sessions)$', '$1 个会话', ''],
];

trans.attrs = Object.assign(trans.attrs || {}, {
  'Configure sessions': '配置会话',
  'User profile and settings': '用户资料与设置',
  'Open detail panel': '打开详情面板',
  'Command palette': '命令面板',
  'Dismiss': '忽略',
  'Utility': '实用工具',
  'What feedback would you like to share?': '你想分享什么反馈？',
  'Search projects, repositories, PRs, issues, or paste a URL…':
    '搜索项目、仓库、PR、议题，或粘贴 URL…',
  'Notifications': '通知',
  'New session': '新建会话',
  'Share feedback': '分享反馈',
  'Close': '关闭',
  'Back': '返回',
  'Forward': '前进',
  'Open settings': '打开设置',
  'Open': '打开',
  'Sticky note': '便签',
});

fs.writeFileSync(transPath, JSON.stringify(trans, null, 2));

console.log('attrPatterns:', trans.attrPatterns.length);
console.log('attrs:', Object.keys(trans.attrs).length);
console.log('patterns:', trans.patterns.length);
