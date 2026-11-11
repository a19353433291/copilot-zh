// 调试注入失败：打印 exceptionDetails
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 20000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

(async () => {
  const curPack = path.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current');
  const loaded = packLib.loadPack(curPack);
  const dict = loaded.dict;

  // 检查字典里是否有会破坏 JS 源码的字符
  const texts = dict.entries.texts;
  const bad = [];
  for (const [k, v] of Object.entries(texts)) {
    for (const s of [k, v]) {
      if (/[\u2028\u2029]/.test(s)) bad.push(['U+2028/2029', s]);
      if (/[\r\n]/.test(s)) bad.push(['换行', s.slice(0, 40)]);
    }
  }
  console.log('危险字符项:', bad.length);
  bad.slice(0, 10).forEach(b => console.log('  ', b[0], JSON.stringify(b[1]).slice(0, 60)));

  // 检查正则是否都能编译
  const badRe = [];
  for (const p of (dict.entries.patterns || [])) {
    try { new RegExp(p[0], p[2] || ''); } catch (e) { badRe.push([p[0], e.message]); }
  }
  for (const p of (dict.entries.attrPatterns || [])) {
    try { new RegExp(p[0], p[2] || ''); } catch (e) { badRe.push([p[0], e.message]); }
  }
  console.log('非法正则:', badRe.length);
  badRe.forEach(b => console.log('  ', b[0], '→', b[1]));

  // 构造最小注入测试
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const test1 = await ws.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
  console.log('\n基础测试 1+1 =', test1.result && test1.result.value);

  const expr = `(() => {
    const DICT = ${JSON.stringify(dict)};
    return { textCount: Object.keys(DICT.entries.texts).length, first: Object.keys(DICT.entries.texts)[0] };
  })()`;
  const r2 = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r2.exceptionDetails) {
    console.log('字典解析异常:', JSON.stringify(r2.exceptionDetails).slice(0, 600));
  } else {
    console.log('字典解析 OK:', JSON.stringify(r2.result.value));
  }

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
