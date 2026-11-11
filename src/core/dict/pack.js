// 字典包：独立于软件本体，可在线更新。
// 包结构：manifest.json（含签名）+ 有效载荷 JSON。
// 采用 ed25519 签名，保证镜像站或中间人无法篡改内容。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACK_SCHEMA = 1;

/** 计算字节的 sha256 */
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 校验证书包并解析。
 * @param {string} packDir 包含 manifest.json 与 payload 的目录
 * @returns {{ok: boolean, dict?: object, meta?: object, reason?: string}}
 */
function loadPack(packDir) {
  const manifestPath = path.join(packDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: '目录中缺少 manifest.json' };
  }

  let signed;
  try {
    signed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: 'manifest.json 格式错误: ' + e.message };
  }

  const { manifest, signature, pubkey } = signed || {};
  if (!manifest || !signature || !pubkey) {
    return { ok: false, reason: 'manifest 缺少签名信息' };
  }

  // 1. 验签（防篡改核心）
  try {
    const mBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    const sigOk = crypto.verify(null, mBytes, pubkey, Buffer.from(signature, 'base64'));
    if (!sigOk) return { ok: false, reason: '签名校验失败：字典包可能被篡改' };
  } catch (e) {
    return { ok: false, reason: '签名校验异常: ' + e.message };
  }

  // 2. 校验载荷哈希
  const payloadName = manifest.payload && manifest.payload.name;
  if (!payloadName) return { ok: false, reason: 'manifest 未声明载荷文件名' };
  const payloadPath = path.join(packDir, payloadName);
  if (!fs.existsSync(payloadPath)) {
    return { ok: false, reason: '载荷文件缺失: ' + payloadName };
  }
  const payloadBytes = fs.readFileSync(payloadPath);
  if (sha256(payloadBytes) !== manifest.payload.sha256) {
    return { ok: false, reason: '载荷校验失败：sha256 不匹配' };
  }

  // 3. 解析并校验结构
  let dict;
  try {
    dict = JSON.parse(payloadBytes.toString('utf8'));
  } catch (e) {
    return { ok: false, reason: '载荷 JSON 解析失败: ' + e.message };
  }
  if (dict.schema !== PACK_SCHEMA) {
    return { ok: false, reason: `不支持的字典格式版本: ${dict.schema}（本工具支持 ${PACK_SCHEMA}）` };
  }
  if (!dict.entries || typeof dict.entries !== 'object') {
    return { ok: false, reason: '字典内容缺少 entries 字段' };
  }

  return { ok: true, dict, meta: manifest };
}

/**
 * 判断字典包是否兼容给定的 App 版本。
 * @param {object} meta manifest
 * @param {string} appVersion 例如 "1.2.0"
 */
function isCompatible(meta, appVersion) {
  const range = meta && meta.appCompat;
  if (!range || !appVersion) return { ok: true };   // 未声明则不限制

  const norm = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const cmp = (a, b) => {
    const A = norm(a), B = norm(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };

  if (range.min && cmp(appVersion, range.min) < 0) {
    return { ok: false, reason: `字典包要求 Copilot >= ${range.min}，当前为 ${appVersion}` };
  }
  if (range.max && cmp(appVersion, range.max) > 0) {
    return { ok: false, reason: `字典包仅支持 Copilot <= ${range.max}，当前为 ${appVersion}` };
  }
  return { ok: true };
}

/**
 * 统计字典条目数量。
 */
function countEntries(dict) {
  const e = (dict && dict.entries) || {};
  return {
    texts: Object.keys(e.texts || {}).length,
    patterns: Array.isArray(e.patterns) ? e.patterns.length : 0,
    attrs: Object.keys(e.attrs || {}).length,
    attrPatterns: Array.isArray(e.attrPatterns) ? e.attrPatterns.length : 0,
  };
}

/**
 * 打包字典目录为可发布字典包（供维护者使用）。
 * @param {object} dict  字典对象
 * @param {object} opts  { packVersion, appCompat, outDir, privateKeyPem }
 */
function buildPack(dict, opts) {
  const { packVersion, appCompat = { min: null, max: null }, outDir, privateKeyPem } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const payloadName = `zh-CN-${packVersion}.json`;
  const payload = Buffer.from(JSON.stringify(dict), 'utf8');
  fs.writeFileSync(path.join(outDir, payloadName), payload);

  const manifest = {
    packVersion,
    locale: dict.locale || 'zh-CN',
    schema: PACK_SCHEMA,
    appCompat,
    createdAt: new Date().toISOString(),
    entryCounts: countEntries(dict),
    payload: { name: payloadName, size: payload.length, sha256: sha256(payload) },
  };

  const mBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const signature = crypto.sign(null, mBytes, privateKeyPem);
  const pubkey = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    manifest,
    signature: signature.toString('base64'),
    pubkey,
  }, null, 2));

  return { manifest, files: [payloadName, 'manifest.json'] };
}

module.exports = {
  loadPack, isCompatible, countEntries, buildPack, sha256, PACK_SCHEMA,
};
