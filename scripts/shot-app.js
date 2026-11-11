// 通过 CDP 直接截取 Electron 应用窗口（最可靠，不受窗口层级影响）
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
const OUT = process.argv[2] || 'C:\\Users\\a1935\\Desktop\\copilot-zh\\_scratch\\app-shot.png';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  if (!page) { console.error('未找到页面'); process.exit(1); }
  console.log('目标:', page.title, page.url);

  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  // 关闭可能打开的弹窗
  await ws.send('Runtime.evaluate', { expression: `document.getElementById('settings-modal').hidden = true; 'ok'`, returnByValue: true });
  await sleep(400);

  const shot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buf = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(OUT, buf);
  console.log('已保存:', OUT, (buf.length / 1024).toFixed(0) + ' KB');

  // 同时导出当前界面结构，便于检查
  const txt = await ws.send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.main');
      return JSON.stringify({
        sections: [...document.querySelectorAll('.section-title')].map(x => x.textContent.trim()),
        status: document.getElementById('watch-text').textContent,
        sub: document.getElementById('watch-sub').textContent,
        pill: document.getElementById('badge-watcher').textContent,
        target: document.getElementById('target-info').textContent.trim(),
        pack: document.getElementById('pack-info').textContent.trim(),
        applyDisabled: document.getElementById('btn-apply').disabled,
      });
    })()`, returnByValue: true,
  });
  console.log('界面状态:', txt.result.value);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
