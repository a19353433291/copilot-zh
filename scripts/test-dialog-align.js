// 验证对话框关闭与对齐修复
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
  send(method, params, to = 30000) {
    const id = ++this.id, data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, to); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.parse(JSON.stringify(r.exceptionDetails)).exception.description;
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 对话框关闭 ════');
  await ev(`window.Dialog.confirm({ title: 'T', message: 'M' }); 0`);
  await sleep(700);
  check('对话框已打开', await ev(`!!document.querySelector('.dialog-mask')`), '');

  // 用 querySelector 找按钮并点击（避免深层引号转义）
  const clicked = await ev(`(() => {
    const b = document.querySelector('.dialog-mask .dialog-cancel');
    if (!b) return 'no-cancel-btn';
    b.click();
    return 'clicked';
  })()`);
  console.log('  点击结果:', clicked);
  await sleep(900);
  const stillThere = await ev(`!!document.querySelector('.dialog-mask')`);
  check('点取消后对话框消失', !stillThere, stillThere ? '仍存在' : '');

  console.log('\n════ ESC 关闭 ════');
  await ev(`window.Dialog.confirm({ title: 'T2', message: 'M2' }); 0`);
  await sleep(700);
  check('对话框已打开', await ev(`!!document.querySelector('.dialog-mask')`), '');
  await ws.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(900);
  const escClosed = !(await ev(`!!document.querySelector('.dialog-mask')`));
  check('ESC 可关闭', escClosed, escClosed ? '' : '仍存在');

  // 清理残留
  await ev(`document.querySelectorAll('.dialog-mask').forEach(m => m.remove()); 0`);

  console.log('\n════ 侧边栏对齐 ════');
  const align = await ev(`(() => {
    const f = document.querySelector('.sidebar-foot').getBoundingClientRect();
    const b = document.querySelector('.statusbar').getBoundingClientRect();
    return JSON.stringify({
      footTop: Number(f.top.toFixed(2)),
      barTop: Number(b.top.toFixed(2)),
      diff: Number(Math.abs(f.top - b.top).toFixed(2)),
      footH: Number(f.height.toFixed(2)),
      barH: Number(b.height.toFixed(2))
    });
  })()`);
  console.log('  ', align);
  let a = {};
  try { a = JSON.parse(align); } catch (e) {}
  check('分割线对齐（<0.5px）', a.diff < 0.5, `差 ${a.diff}px`);

  console.log('\n══════════════════════════════');
  console.log(`  通过 ${pass} / ${pass + fail}`);
  console.log('══════════════════════════════');

  ws.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
