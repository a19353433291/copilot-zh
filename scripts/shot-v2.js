// 全页面截图（双主题），用于视觉评审
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images';

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

(async () => {
  const jobs = [];
  for (const theme of ['light', 'dark']) {
    for (const page of ['home', 'translate', 'dict', 'cleanup', 'settings']) {
      jobs.push({ theme, page, file: `v2-${theme}-${page}.png` });
    }
  }

  for (const j of jobs) {
    const list = JSON.parse(await httpGet('/json/list'));
    const page = list.find(t => t.type === 'page');
    const ws = new WS(page.webSocketDebuggerUrl);
    await ws.connect();

    const ev = async (expr) => {
      const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r && r.result ? r.result.value : null;
    };

    await ws.send('Emulation.setDeviceMetricsOverride', {
      width: 1180, height: 820, deviceScaleFactor: 1, mobile: false,
    });
    await ev(`document.documentElement.dataset.theme = '${j.theme}'`);
    await sleep(280);
    await ev(`document.querySelector('.nav-item[data-page="${j.page}"]').click()`);
    await sleep(620);

    const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, j.file), Buffer.from(shot.data, 'base64'));
    console.log('已保存', j.file);

    await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
    ws.close();
    await sleep(120);
  }

  // 健康检查
  const list = JSON.parse(await httpGet('/json/list'));
  const pg = list.find(t => t.type === 'page');
  const ws = new WS(pg.webSocketDebuggerUrl);
  await ws.connect();
  const ev = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : null;
  };
  console.log('\n=== 设计系统状态 ===');
  console.log('  页面数:', await ev(`document.querySelectorAll('.page').length`));
  console.log('  导航项:', await ev(`document.querySelectorAll('.nav-item').length`));
  console.log('  统计格容器:', await ev(`document.querySelectorAll('.stat-grid').length`));
  console.log('  检测格容器:', await ev(`document.querySelectorAll('.check-grid').length`));
  console.log('  开关数:', await ev(`document.querySelectorAll('.toggle input').length`));
  console.log('  下拉数:', await ev(`document.querySelectorAll('.select').length`));
  console.log('  body 背景:', await ev(`getComputedStyle(document.body).backgroundColor`));
  console.log('  主按钮背景:', await ev(`(() => {
    const b = document.querySelector('.btn-primary');
    return b ? getComputedStyle(b).backgroundImage + ' | ' + getComputedStyle(b).backgroundColor : 'none';
  })()`));
  await ev(`document.documentElement.dataset.theme = 'system'`);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
