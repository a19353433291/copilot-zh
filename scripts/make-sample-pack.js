// 生成一个最小可用字典包（用于验证整条链路）
// 用法：node scripts/make-sample-pack.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildPack } = require('../src/core/dict/pack');

// 第一批：首页与侧边栏的高频文案（实测确认存在于 v1.2.0）
const dict = {
  schema: 1,
  locale: 'zh-CN',
  entries: {
    texts: {
      // 侧边栏
      'Sidebar': '侧边栏',
      'Quick links': '快捷链接',
      'New': '新建',
      'Pull requests': '拉取请求',
      'Issues': '议题',
      'Automations': '自动化',
      'Customize': '自定义',
      'Projects': '项目',
      'No projects yet': '暂无项目',
      'Sessions': '会话',
      'No sessions yet': '暂无会话',
      'Chat': '对话',
      'Chats': '对话',
      'Home': '主页',
      'Search': '搜索',
      'Settings': '设置',
      'Cancel': '取消',
      'Close': '关闭',
      'Dismiss': '忽略',
      'Retry': '重试',
      'Save': '保存',
      'Delete': '删除',
      'Copy': '复制',
      'Edit': '编辑',
      'Open': '打开',
      'Create': '创建',
      'Retry': '重试',
      'Loading': '加载中',
      'Loading…': '加载中…',
      // 主区
      'Interactive': '交互式',
      'Default': '默认',
      'Model and reasoning:': '模型与推理：',
      'Mode:': '模式：',
      'Share feedback': '分享反馈',
      'Report a bug or suggest a feature': '报告问题或建议功能',
      'This will be posted as a public GitHub issue.': '这将被公开发布为 GitHub 议题。',
      'Set up voice dictation': '设置语音听写',
      'Open voice settings': '打开语音设置',
      'See what’s new': '查看新功能',
      'Explore the latest launches in GitHub Copilot.': '探索 GitHub Copilot 的最新发布。',
      'Get started with one of these project ideas.': '从这些项目创意开始。',
      'Build a personal landing page with dark mode.': '构建一个带深色模式的个人落地页。',
      'Build a weather app that shows live forecasts.': '构建一个显示实时天气的应用。',
      'Build a snake game with score tracking and increasing speed.': '构建一个带计分与加速的贪吃蛇游戏。',
      'GitHub Copilot uses AI. Check for mistakes.': 'GitHub Copilot 使用 AI，请核对可能的错误。',
      'This computer': '此电脑',
      'New chat': '新建对话',
      'New session': '新建会话',
      'Ask anything or paste a URL. Use / for commands, & sessions, # issues…':
        '输入任何内容或粘贴 URL。使用 / 调用命令、& 查看会话、# 查看议题…',
    },
    patterns: [
      ['^(\\d+)% used$', '$1% 已使用', ''],
      ['^(\\d+) (session|sessions)$', '$1 个会话', ''],
      ['^(\\d+) (result|results)$', '$1 个结果', ''],
      ['^(\\d+) (minute|minutes) ago$', '$1 分钟前', ''],
      ['^(\\d+) (hour|hours) ago$', '$1 小时前', ''],
      ['^(\\d+) (day|days) ago$', '$1 天前', ''],
    ],
    attrs: {
      'Toggle sidebar, Ctrl + B': '切换侧边栏, Ctrl + B',
      'Resize sidebar': '调整侧边栏大小',
      'Search, Ctrl + K': '搜索, Ctrl + K',
      'Create new project or session': '新建项目或会话',
      'Change how sessions are grouped': '更改会话分组方式',
      'New session, Ctrl + N. New chat, Ctrl + Shift + N.': '新建会话 Ctrl + N。新建对话 Ctrl + Shift + N。',
    },
    attrPatterns: [
      ['^Search (\\d+) skills…$', '搜索 $1 个技能…', ''],
    ],
  },
};

// 生成签名密钥（首次生成后应固定保存，这里每次生成仅为演示）
const keyPath = path.resolve(__dirname, '..', 'build', 'pack-signing-key.pem');
fs.mkdirSync(path.dirname(keyPath), { recursive: true });
let privateKeyPem;
if (fs.existsSync(keyPath)) {
  privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  console.log('复用已有签名密钥');
} else {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(keyPath, privateKeyPem);
  console.log('生成新签名密钥:', keyPath);
  console.log('  ! 请妥善保管，后续所有字典包都应使用同一密钥签名');
}

const outDir = path.resolve(__dirname, '..', 'dist-packs', 'zh-CN-0.1.0');
const r = buildPack(dict, {
  packVersion: '0.1.0',
  appCompat: { min: '1.0.0', max: null },
  outDir,
  privateKeyPem,
});

console.log('\n字典包已生成:', outDir);
console.log('  版本:', r.manifest.packVersion);
console.log('  条目:', JSON.stringify(r.manifest.entryCounts));
console.log('  文件:', r.files.join(', '));
