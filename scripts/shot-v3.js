// 稳定截图 v2：先 enable Page 域再截图
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\';

function httpGet(p) {
  return new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('timeout', () => { r.destroy(); rej(new Error('http timeout')); });
    r.on('error', rej);
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
  send(method, params, timeoutMs = 25000) {
    const id = ++this.id, data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, timeoutMs); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shotOne(ws, page_name, fileName) {
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : null;
  };

  await ev(`document.querySelector('.nav-item[data-page="${page_name}"]').click()`);
  await sleep(1300);

  // 等布局稳定：连续两次读取同一尺寸
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const h = await ev(`Math.round(document.querySelector('.content-area').getBoundingClientRect().height)`);
    if (prev === h) break;
    prev = h;
    await sleep(250);
  }

  const shot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
  fs.writeFileSync(OUT + fileName, Buffer.from(shot.data, 'base64'));
  console.log('✓ ' + fileName);
}

(async () => {
  const pages = process.argv.slice(2);
  const targets = pages.length ? pages : ['home', 'translate', 'dict', 'cleanup', 'settings'];

  for (const p of targets) {
    // 每次重建连接，避免长连接状态累积
    const list = JSON.parse(await httpGet('/json/list'));
    const page = list.find(t => t.type === 'page');
    const ws = new WS(page.webSocketDebuggerUrl);
    await ws.connect();

    // 关键：先初始化 Page 域
    try { await ws.send('Page.enable', {}, 10000); } catch (e) {}
    await sleep(300);

    try {
      await shotOne(ws, p, `_v3-${p}.png`);
    } catch (e) {
      console.log('✗ ' + p + ': ' + e.message);
    }
    ws.close();
    await sleep(400);
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
