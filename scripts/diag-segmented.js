// 调试分段控件定位
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 15000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await new Promise(r => setTimeout(r, 600));
  await ev(`Segmented.reprojectAll()`);
  await new Promise(r => setTimeout(r, 400));

  console.log('--- 分段控件诊断 ---');
  console.log('active 项:', await ev(`document.querySelector('#seg-theme .segmented-item.active')?.dataset.value`));
  console.log('--seg-w:', await ev(`getComputedStyle(document.getElementById('seg-theme')).getPropertyValue('--seg-w')`));
  console.log('--seg-x:', await ev(`getComputedStyle(document.getElementById('seg-theme')).getPropertyValue('--seg-x')`));
  console.log('容器宽:', await ev(`document.getElementById('seg-theme').getBoundingClientRect().width`));
  console.log('::before 宽度:', await ev(`getComputedStyle(document.getElementById('seg-theme'), '::before').width`));
  console.log('::before 背景:', await ev(`getComputedStyle(document.getElementById('seg-theme'), '::before').backgroundColor`));
  console.log('::before transform:', await ev(`getComputedStyle(document.getElementById('seg-theme'), '::before').transform`));
  console.log('内联样式:', await ev(`document.getElementById('seg-theme').getAttribute('style')`));

  // 检查各 item 位置
  console.log('\n各项位置:');
  const items = await ev(`JSON.stringify([...document.querySelectorAll('#seg-theme .segmented-item')].map(it => {
    const r = it.getBoundingClientRect();
    return { v: it.dataset.value, x: Math.round(r.left), w: Math.round(r.width) };
  }))`);
  console.log(' ', items);

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
