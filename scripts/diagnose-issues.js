// 复现用户报告的 4 个问题
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
  send(method, params, to = 25000) {
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
  try { await ws.send('Page.enable', {}, 10000); } catch (e) {}
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 问题 2：侧边栏分割线 vs 状态栏分割线 ════');
  const lines = await ev(`(() => {
    const foot = document.querySelector('.sidebar-foot');
    const bar = document.querySelector('.statusbar');
    const sb = document.querySelector('.sidebar');
    return JSON.stringify({
      sidebarFootTop: foot ? Math.round(foot.getBoundingClientRect().top) : null,
      sidebarWidth: sb ? Math.round(sb.getBoundingClientRect().width) : null,
      statusbarTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      statusbarHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      footHeight: foot ? Math.round(foot.getBoundingClientRect().height) : null
    });
  })()`);
  console.log('  ', lines);
  let L = {};
  try { L = JSON.parse(lines); } catch (e) {}
  const diff = Math.abs((L.sidebarFootTop || 0) - (L.statusbarTop || 0));
  console.log(`  两条线垂直差: ${diff}px ${diff <= 2 ? '✓ 对齐' : '✗ 不对齐'}`);

  console.log('\n════ 问题 3：设置开关能否切换 ════');
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(700);

  const toggleIds = ['set-launch-after-apply', 'set-auto-restart', 'set-close-on-revert',
                     'set-auto-inject', 'set-run-at-login', 'set-minimize-tray', 'set-motion', 'set-check-on-start'];

  for (const id of toggleIds) {
    const info = await ev(`(() => {
      const el = document.getElementById('${id}');
      if (!el) return JSON.stringify({exists:false});
      const before = el.checked;
      el.click();
      return JSON.stringify({exists:true, before, after: el.checked, disabled: el.disabled});
    })()`);
    let o = {};
    try { o = JSON.parse(info); } catch (e) {}
    if (!o.exists) { console.log(`  ✗ ${id} 不存在`); continue; }
    const changed = o.before !== o.after;
    console.log(`  ${changed ? '✓' : '✗'} ${id.padEnd(24)} ${o.before} → ${o.after}${o.disabled ? ' (disabled)' : ''}`);
    await sleep(200);
    // 复原
    await ev(`document.getElementById('${id}').click()`);
    await sleep(150);
  }

  console.log('\n════ 问题 4：清理确认框是否为原生 confirm ════');
  const confirmCheck = await ev(`(() => {
    // 检查是否存在自定义模态框
    const modal = document.getElementById('confirm-modal');
    const nativeConfirm = window.confirm.toString();
    return JSON.stringify({
      hasCustomModal: !!modal,
      confirmIsNative: nativeConfirm.includes('[native code]'),
      dialogTags: document.querySelectorAll('dialog').length
    });
  })()`);
  console.log('  ', confirmCheck);

  console.log('\n════ 问题 5：字典包检查更新 ════');
  const packUpdate = await ev(`(() => {
    const btn = document.getElementById('btn-check-update');
    return JSON.stringify({ exists: !!btn, text: btn ? btn.textContent.trim() : null });
  })()`);
  console.log('  ', packUpdate);

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
