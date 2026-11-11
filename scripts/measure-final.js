// 最终覆盖率测量：用已验证可用的注入方式，逐个界面注入后采集
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const root = path.resolve(__dirname, '..');
const packLib = require(path.join(root, 'src/core/dict/pack'));

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}
class WS {
  constructor(u) { this.url = new URL(u); this.buf = Buffer.alloc(0); this.id = 0; this.pending = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(Number(this.url.port), this.url.hostname, () => {
        this.sock.write([`GET ${this.url.pathname} HTTP/1.1`, `Host: ${this.url.host}`, 'Upgrade: websocket',
          'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'));
      });
      let hs = false;
      this.sock.on('data', d => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!hs) {
          const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return;
          if (!this.buf.subarray(0, i).toString().includes('101')) return reject(new Error('hs'));
          hs = true; this.buf = this.buf.subarray(i + 4); resolve();
        }
        this.p();
      });
      this.sock.on('error', reject);
    });
  }
  p() {
    while (true) {
      if (this.buf.length < 2) return;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const t = this.buf.subarray(off, off + len).toString('utf8');
      this.buf = this.buf.subarray(off + len);
      try { const m = JSON.parse(t); if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } catch (e) {}
    }
  }
  send(method, params) {
    const id = ++this.id, data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 25000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 完整翻译器（与引擎一致）
const TRANSLATOR = (dict) => `(() => {
  const DICT = ${JSON.stringify(dict)};
  const texts = DICT.entries.texts || {};
  const attrs = DICT.entries.attrs || {};
  const patterns = (DICT.entries.patterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);
  const attrPatterns = (DICT.entries.attrPatterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"]';
  window.__zhCount = window.__zhCount || 0;
  function tt(node) {
    const raw = node.nodeValue;
    if (!raw) return;
    const t = raw.trim();
    if (!t || t.length < 2 || t.length > 500) return;
    try { if (node.parentElement && node.parentElement.closest(SKIP)) return; } catch (e) {}
    let out = null;
    if (texts[t] !== undefined) out = texts[t];
    else {
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i][0].test(t)) { const v = t.replace(patterns[i][0], patterns[i][1]); if (v !== t) { out = v; break; } }
      }
    }
    if (out !== null && raw !== out) {
      const l = raw.match(/^\\s*/)[0], r = raw.match(/\\s*$/)[0];
      node.nodeValue = l + out + r;
      window.__zhCount++;
    }
  }
  function ta(el) {
    for (const nm of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute && el.getAttribute(nm);
      if (!v) continue;
      let out = null;
      if (attrs[v] !== undefined) out = attrs[v];
      else for (let i = 0; i < attrPatterns.length; i++) {
        if (attrPatterns[i][0].test(v)) { const x = v.replace(attrPatterns[i][0], attrPatterns[i][1]); if (x !== v) { out = x; break; } }
      }
      if (out !== null) { el.setAttribute(nm, out); window.__zhCount++; }
    }
  }
  function walk(r) {
    if (!r) return;
    if (r.nodeType === 3) { tt(r); return; }
    if (r.nodeType !== 1 && r.nodeType !== 9 && r.nodeType !== 11) return;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) tt(n);
    if (r.querySelectorAll) r.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(ta);
  }
  walk(document.body || document.documentElement);
  document.documentElement.lang = 'zh-CN';
  return { total: window.__zhCount };
})();`;

const COLLECT = `(() => {
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"]';
  const items = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t || t.length < 2 || t.length > 300) continue;
    try { if (n.parentElement && n.parentElement.closest(SKIP)) continue; } catch (e) {}
    if (!/[a-zA-Z\\u4e00-\\u9fff]{2,}/.test(t)) continue;
    items.add(t);
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const t = v.trim();
      if (t.length < 2 || t.length > 300) continue;
      items.add(t);
    }
  }
  return JSON.stringify([...items]);
})()`;

async function ev(ws, expr) {
  const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : null;
}

(async () => {
  const curPack = path.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current');
  const loaded = packLib.loadPack(curPack);
  console.log('字典:', JSON.stringify(packLib.countEntries(loaded.dict)));

  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const bag = new Set();

  // 每个界面：注入 → 等 → 采集
  async function visit(label) {
    const inj = await ev(ws, TRANSLATOR(loaded.dict));
    await sleep(900);
    const raw = await ev(ws, COLLECT);
    const arr = raw ? JSON.parse(raw) : [];
    let added = 0;
    for (const s of arr) if (!bag.has(s)) { bag.add(s); added++; }
    console.log(`  [${label}] 注入替换 ${inj ? inj.total : '?'} 次，采集 +${added}，累计 ${bag.size}`);
  }

  await visit('主界面');

  const navs = ['Automations', 'Customize', 'Projects', 'Pull requests', 'Issues', 'Settings', 'Sessions'];
  for (const t of navs) {
    const r = await ev(ws, `(() => {
      for (const el of document.querySelectorAll('button,[role="button"],[role="tab"],a,[tabindex]')) {
        const x = (el.textContent || '').trim();
        const al = (el.getAttribute && el.getAttribute('aria-label') || '').trim();
        if (x === ${JSON.stringify(t)} || al === ${JSON.stringify(t)}) {
          if (el.offsetParent !== null || el.getClientRects().length) { el.click(); return 'ok'; }
        }
      }
      return 'no';
    })()`);
    if (r === 'ok') { await sleep(1200); await visit(t); }
  }

  ws.close();

  const all = [...bag];
  const isCjk = s => /[\u4e00-\u9fff]/.test(s);
  const cjk = all.filter(isCjk);
  const en = all.filter(s => !isCjk(s));

  // 排除本质上不该翻译的
  const notTranslatable = (s) => {
    if (/^[a-z0-9._-]+$/.test(s)) return true;              // 标识符
    if (/^(Ctrl|Alt|Shift|Control|Meta|Enter|Space|Tab|Esc|Escape|SCORE|OK)$/.test(s)) return true;
    if (/^[A-Z][a-zA-Z]*$/.test(s) && s.length <= 12) return true;  // 单词品牌名
    if (/^Ctrl \+ /.test(s) || /^Alt \+ /.test(s)) return true;      // 快捷键
    if (/^[A-Z0-9 ]{2,20}$/.test(s)) return true;            // 全大写
    return false;
  };
  const needed = en.filter(s => !notTranslatable(s));
  const denom = cjk.length + needed.length;

  console.log('\n===== 汉化覆盖率 =====');
  console.log('界面文案总数:', all.length);
  console.log('已中文化:', cjk.length);
  console.log('仍英文:', en.length, '（需翻译:', needed.length, '| 可不译:', en.length - needed.length, '）');
  console.log('覆盖率:', (cjk.length / denom * 100).toFixed(1) + '%');

  console.log('\n=== 已中文化（前 30）===');
  cjk.slice(0, 30).forEach(s => console.log('  ✓', s.slice(0, 68)));
  console.log('\n=== 需翻译但仍是英文（前 30）===');
  needed.slice(0, 30).forEach(s => console.log('  ·', s.slice(0, 68)));

  fs.writeFileSync(path.join(root, 'dist-packs', 'coverage-v12.json'),
    JSON.stringify({ all, cjk, needed }, null, 1));
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
