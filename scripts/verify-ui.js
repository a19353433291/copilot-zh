// 通过 CDP 读取 GitHub Copilot 页面的当前文本，验证汉化效果
const http = require('http');
const crypto = require('crypto');
const net = require('net');

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
        if (!hs) { const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return;
          if (!this.buf.subarray(0, i).toString().includes('101')) return reject(new Error('hs'));
          hs = true; this.buf = this.buf.subarray(i + 4); resolve(); }
        this.process();
      });
      this.sock.on('error', reject);
    });
  }
  process() {
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 15000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const r = await ws.send('Runtime.evaluate', {
    expression: `(() => {
      const texts = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) texts.push(t); }
      const uniq = [...new Set(texts)];
      const isCjk = s => /[\\u4e00-\\u9fff]/.test(s);
      return JSON.stringify({
        translatorLoaded: typeof window.__copilotZh !== 'undefined',
        lang: document.documentElement.lang,
        title: document.title,
        total: uniq.length,
        cjk: uniq.filter(isCjk),
        nonCjk: uniq.filter(s => !isCjk(s)),
        stats: window.__copilotZh ? window.__copilotZh.stats() : null
      });
    })()`,
    returnByValue: true,
  });
  const d = JSON.parse(r.result.value);
  console.log('翻译器已加载:', d.translatorLoaded);
  console.log('页面 lang:', d.lang, '| 标题:', d.title);
  console.log('统计:', JSON.stringify(d.stats));
  console.log('\n=== 已中文化 (' + d.cjk.length + ' 项) ===');
  d.cjk.slice(0, 40).forEach(x => console.log('  ✓', x.slice(0, 70)));
  console.log('\n=== 仍为英文 (' + d.nonCjk.length + ' 项) ===');
  d.nonCjk.slice(0, 40).forEach(x => console.log('  ·', x.slice(0, 70)));
  ws.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
