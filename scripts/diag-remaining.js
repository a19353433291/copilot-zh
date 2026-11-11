// 诊断：那 14 条残留究竟在文本节点还是属性里
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9222;

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 20000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const targets = [
  'New session, Ctrl + N. New chat, Ctrl + Shift + N.',
  'Add context & more',
  'Mode: Interactive, Ctrl + Shift + M',
  'Default, model and reasoning, Ctrl + Shift + E',
  'Set up voice dictation',
  'Send message',
  'Repository: Chat',
  'Environment: This computer',
  'Typeahead menu',
  'Tool permissions, Approve all',
];

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const ev = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : null;
  };

  console.log('=== 定位残留来源 ===');
  for (const t of targets) {
    const expr = `(() => {
      const q = ${JSON.stringify(t)};
      const res = { text: false, attr: [], tag: null };
      // 检查文本节点
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if ((n.nodeValue || '').trim() === q) { res.text = true; res.tag = n.parentElement ? n.parentElement.tagName : null; break; }
      }
      // 检查属性
      for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
        for (const a of ['placeholder','title','aria-label','alt']) {
          const v = el.getAttribute && el.getAttribute(a);
          if (v && v.trim() === q) res.attr.push({ tag: el.tagName, attr: a });
        }
      }
      return JSON.stringify(res);
    })()`;
    const r = await ev(expr);
    const d = JSON.parse(r || '{}');
    const src = d.text ? '文本(' + d.tag + ')' : (d.attr && d.attr.length ? '属性(' + d.attr.map(x => x.tag + '@' + x.attr).join(',') + ')' : '未找到');
    console.log(`  ${JSON.stringify(t).slice(0, 52)}`);
    console.log(`     来源: ${src}`);
  }

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
