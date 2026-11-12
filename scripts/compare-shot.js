// 量化对比：Qoder vs 汉化助手 的设计精度差异
// 测量维度：留白比例、元素尺寸、字号、字重、行高、对齐
const { execFileSync } = require('child_process');
const fs = require('fs');

const QODER = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\_cmp-qoder.png';
const OURS = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\_cmp-ours.png';

// 先截 Qoder
console.log('=== 截取 Qoder ===');
try {
  const out = execFileSync('node',
    ['scripts/shot-app-window.js', 'Qoder CN', '_cmp-qoder.png'],
    { encoding: 'utf8', timeout: 90000, cwd: 'C:\\Users\\a1935\\Desktop\\copilot-zh' });
  console.log(out.trim());
} catch (e) { console.log('失败:', e.message); }

// 再用 CDP 截我们的（固定视口尺寸，便于对比）
console.log('\n=== 截取汉化助手 ===');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9333, path: p }, r => {
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
        if (!hs) { const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return; hs = true; this.buf = this.buf.subarray(i + 4); resolve(); }
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

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: 1180, height: 820, deviceScaleFactor: 2, mobile: false,
  });
  await new Promise(r => setTimeout(r, 500));

  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OURS, Buffer.from(shot.data, 'base64'));
  console.log('已保存 _cmp-ours.png');

  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
  ws.close();
})().catch(e => { console.error(e.message); process.exit(1); });
