// 打印注入的完整 CDP 响应，定位 undefined 原因
const path = require('path');
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

// 极简翻译器：只验证注入链路可行
const SIMPLE = (dict) => `(() => {
  const DICT = ${JSON.stringify(dict)};
  const texts = DICT.entries.texts || {};
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"]';
  let replaced = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const raw = n.nodeValue;
    if (!raw) continue;
    const t = raw.trim();
    if (!t || texts[t] === undefined) continue;
    try { if (n.parentElement && n.parentElement.closest(SKIP)) continue; } catch (e) {}
    if (raw !== texts[t]) {
      const l = raw.match(/^\\s*/)[0];
      const r = raw.match(/\\s*$/)[0];
      n.nodeValue = l + texts[t] + r;
      replaced++;
    }
  }
  return { replaced: replaced, ok: true };
})();`;

(async () => {
  const curPack = path.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current');
  const loaded = packLib.loadPack(curPack);
  console.log('字典:', JSON.stringify(packLib.countEntries(loaded.dict)));

  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const src = SIMPLE(loaded.dict);
  console.log('脚本长度:', src.length);

  const r = await ws.send('Runtime.evaluate', {
    expression: src, returnByValue: true, awaitPromise: false,
  });
  console.log('完整响应:', JSON.stringify(r).slice(0, 900));

  await sleep(600);
  const chk = await ws.send('Runtime.evaluate', {
    expression: `(() => {
      const s = new Set();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) s.add(t); }
      const arr = [...s];
      return JSON.stringify({ total: arr.length, cjk: arr.filter(x => /[\\u4e00-\\u9fff]/.test(x)).length,
        sample: arr.slice(0, 12) });
    })()`,
    returnByValue: true,
  });
  console.log('页面状态:', chk.result && chk.result.value);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
