// 稳定截图：先重置所有 Emulation 状态，再截图
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\';

function httpGet(p) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    });
    req.on('timeout', () => { req.destroy(); rej(new Error('http timeout')); });
    req.on('error', rej);
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('ws timeout: ' + method)); } }, 15000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  // 1. 先清除任何残留的 Emulation 覆盖
  try { await ws.send('Emulation.clearDeviceMetricsOverride', {}); } catch (e) {}
  try { await ws.send('Emulation.resetPageScaleFactor', {}); } catch (e) {}
  await sleep(600);

  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC';
    return r && r.result ? r.result.value : null;
  };

  // 2. 回到概览页，等动画结束
  await ev(`document.querySelector('.nav-item[data-page="home"]').click()`);
  await sleep(1200);

  // 3. 检查布局是否正常
  const layout = await ev(`JSON.stringify({
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
    panelW: Math.round(document.querySelector('.content-area').getBoundingClientRect().width),
    heroW: Math.round(document.querySelector('.hero-status').getBoundingClientRect().width)
  })`);
  console.log('布局:', layout);

  // 4. 截图
  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_stable.png', Buffer.from(shot.data, 'base64'));
  console.log('已保存 _stable.png');

  // 5. 各页面
  for (const p of ['translate', 'dict', 'cleanup', 'settings']) {
    await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
    await sleep(900);
    const s = await ws.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + `_stable-${p}.png`, Buffer.from(s.data, 'base64'));
    console.log('已保存 _stable-' + p + '.png');
  }

  await ev(`document.querySelector('.nav-item[data-page="home"]').click()`);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
