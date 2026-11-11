// 从 translations.json 构建可发布的字典包。
//
// translations.json 是面向维护者的分组格式（便于阅读），
// 本脚本将其展开为运行时需要的 entries 结构并签名出包。
//
// 用法：
//   node scripts/build-pack.js                     # 用默认版本号出包
//   node scripts/build-pack.js --version 0.2.0     # 指定版本

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPack, countEntries } = require('../src/core/dict/pack');

const root = path.resolve(__dirname, '..');
const TRANS = path.join(root, 'src', 'core', 'dict', 'translations.json');
const KEY = path.join(root, 'build', 'pack-signing-key.pem');

const argv = process.argv.slice(2);
let version = '0.2.0';
for (let i = 0; i < argv.length; i++) if (argv[i] === '--version') version = argv[i + 1];

const raw = JSON.parse(fs.readFileSync(TRANS, 'utf8'));

// 收集分组中的文本（跳过下划线开头的元数据组、patterns、attrs 等）
const RESERVED = new Set(['patterns', 'attrs', 'attrPatterns', '_comment']);
const texts = {};
for (const [group, val] of Object.entries(raw)) {
  if (group.startsWith('_') || RESERVED.has(group)) continue;
  if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
  for (const [en, zh] of Object.entries(val)) {
    if (typeof zh !== 'string' || !zh) continue;
    if (texts[en] !== undefined && texts[en] !== zh) {
      console.warn(`  警告：键重复且译文不同 → "${en}"：保留 "${texts[en]}"，忽略 "${zh}"`);
      continue;
    }
    texts[en] = zh;
  }
}

const dict = {
  schema: 1,
  locale: 'zh-CN',
  entries: {
    texts,
    patterns: raw.patterns || [],
    attrs: raw.attrs || {},
    attrPatterns: raw.attrPatterns || [],
  },
};

// 检查密钥
let privateKeyPem;
if (!fs.existsSync(KEY)) {
  console.log('未找到签名密钥，生成新密钥:', KEY);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(KEY), { recursive: true });
  fs.writeFileSync(KEY, privateKeyPem);
} else {
  privateKeyPem = fs.readFileSync(KEY, 'utf8');
}

const outDir = path.join(root, 'dist-packs', `zh-CN-${version}`);
const manifest = buildPack(dict, {
  packVersion: version,
  appCompat: { min: '1.0.0', max: null },
  outDir,
  privateKeyPem,
});

// 输出明文字典，便于检查
fs.writeFileSync(path.join(outDir, 'dict-plain.json'), JSON.stringify(dict, null, 2));

const counts = countEntries(dict);
console.log('\n=== 字典包已生成 ===');
console.log('版本:', version);
console.log('输出:', outDir);
console.log('条目:', JSON.stringify(counts));
console.log('载荷大小:', (manifest.manifest.payload.size / 1024).toFixed(1), 'KB');

// 检查重复键（同一英文在不同分组出现不同译法）
const seen = new Map();
let dup = 0;
for (const [group, val] of Object.entries(raw)) {
  if (group.startsWith('_') || RESERVED.has(group) || !val || typeof val !== 'object') continue;
  for (const en of Object.keys(val)) {
    if (seen.has(en)) {
      if (seen.get(en) !== group) { dup++; console.log(`  分组重复: "${en}" 同时出现在 ${seen.get(en)} 和 ${group}`); }
    } else seen.set(en, group);
  }
}
if (dup) console.log(`\n共 ${dup} 个键跨分组重复（已自动去重，建议清理）`);
