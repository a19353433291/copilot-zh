// 真实点击测试：滚动到每个开关再点击，模拟用户操作
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
function httpGet(p) {
  return new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 6000 }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
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
  send(method, params, to = 20000) {
    const id = ++this.id, data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, to); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 250);
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 真实点击测试：滚动到开关后点击 ════\n');
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(800);

  const ids = ['set-motion', 'set-launch-after-apply', 'set-auto-restart', 'set-close-on-revert',
               'set-auto-inject', 'set-check-on-start', 'set-run-at-login', 'set-minimize-tray'];

  let okCount = 0;
  for (const id of ids) {
    // 1. 滚到可见
    await ev(`(() => { const el = document.getElementById('${id}'); if (el) el.closest('.toggle').scrollIntoView({block:'center'}); })()`);
    await sleep(400);

    // 2. 用真实鼠标坐标点击
    const pos = await ev(`(() => {
      const el = document.getElementById('${id}');
      if (!el) return JSON.stringify({ok:false});
      const track = el.nextElementSibling || el.closest('.toggle');
      const r = track.getBoundingClientRect();
      const before = el.checked;
      return JSON.stringify({
        ok: true, before,
        x: Math.round(r.left + r.width/2),
        y: Math.round(r.top + r.height/2),
        visible: r.top >= 0 && r.bottom <= window.innerHeight
      });
    })()`);
    let p = {};
    try { p = JSON.parse(pos); } catch (e) {}

    if (!p.ok) { console.log(`  ✗ ${id} 找不到`); continue; }
    if (!p.visible) { console.log(`  ⚠ ${id} 滚动后仍不可见`); continue; }

    // 真实鼠标点击
    await ws.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await ws.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(500);

    const after = await ev(`document.getElementById('${id}').checked`);
    const changed = p.before !== after;
    if (changed) okCount++;
    console.log(`  ${changed ? '✓' : '✗'} ${id.padEnd(24)} ${p.before} → ${after}  (点击 ${p.x},${p.y})`);

    // 复原
    if (changed) {
      await ws.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await ws.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(400);
    }
  }

  console.log(`\n  真实点击成功: ${okCount} / ${ids.length}`);

  // 检查设置是否真的持久化了
  console.log('\n════ 设置持久化检查 ════');
  const saved = await ev(`window.api.getSettings().then(r=>JSON.stringify(r.data))`);
  let s = {};
  try { s = JSON.parse(saved); } catch (e) {}
  console.log('  motion:', s.motion);
  console.log('  launchCopilotAfterApply:', s.launchCopilotAfterApply);
  console.log('  minimizeToTray:', s.minimizeToTray);

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
