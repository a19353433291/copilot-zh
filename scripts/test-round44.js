// 验证本轮修复：对齐、渠道切换、更新不卡住、对话框
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
  send(method, params, to = 60000) {
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
  try { await ws.send('Page.enable', {}, 10000); } catch (e) {}
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.parse(JSON.stringify(r.exceptionDetails)).exception.description;
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 1. 侧边栏与状态栏对齐 ════');
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
  check('两条分割线对齐（<0.5px）', a.diff < 0.5, `差 ${a.diff}px`);
  check('高度一致', Math.abs(a.footH - a.barH) < 0.5, `${a.footH} vs ${a.barH}`);

  console.log('\n════ 2. 更新渠道切换 ════');
  await ev(`switchPage('settings')`);
  await sleep(800);

  const segExists = await ev(`!!document.getElementById('seg-channel')`);
  check('渠道分段控件存在', segExists, '');

  // 切到测试版
  await ev(`document.querySelector('#seg-channel .segmented-item[data-value="beta"]').click()`);
  await sleep(2500);
  const betaSetting = await ev(`window.api.getSettings().then(r=>r.data.updateChannel)`);
  check('切到测试版已持久化', betaSetting === 'beta', String(betaSetting));

  const betaState = await ev(`window.api.updateStatus().then(s=>JSON.stringify({state:s.state,latest:s.latestVersion,pre:s.prerelease}))`);
  console.log('  测试版渠道状态:', betaState);

  // 切回正式版
  await ev(`document.querySelector('#seg-channel .segmented-item[data-value="stable"]').click()`);
  await sleep(2500);
  const stableSetting = await ev(`window.api.getSettings().then(r=>r.data.updateChannel)`);
  check('切回正式版已持久化', stableSetting === 'stable', String(stableSetting));

  console.log('\n════ 3. 更新不会卡在检查中 ════');
  const t0 = Date.now();
  const r = await ev(`window.api.updateCheck().then(x=>JSON.stringify(x))`);
  const elapsed = Date.now() - t0;
  console.log(`  耗时 ${elapsed}ms:`, String(r).slice(0, 180));
  check('检查在 25 秒内返回', elapsed < 25000, `${elapsed}ms`);
  let rr = {};
  try { rr = JSON.parse(r); } catch (e) {}
  check('返回明确的 ok/失败', typeof rr.ok === 'boolean', String(rr.ok));

  // 状态不应残留 checking
  await sleep(600);
  const finalState = await ev(`window.api.updateStatus().then(s=>s.state)`);
  check('状态未卡在 checking', finalState !== 'checking', String(finalState));

  console.log('\n════ 4. 对话框统一设计 ════');
  await ev(`window.Dialog.confirm({ title:'测试', message:'内容', items:['a','b'], danger:true }); 'ok'`);
  await sleep(700);
  const dlg = await ev(`(() => {
    const m = document.querySelector('.dialog-mask');
    const d = m && m.querySelector('.dialog');
    if (!d) return JSON.stringify({exists:false});
    const cs = getComputedStyle(d);
    return JSON.stringify({
      exists: true,
      radius: cs.borderRadius,
      hasShadow: cs.boxShadow !== 'none',
      hasList: m.querySelectorAll('.dialog-list li').length,
      confirmBtnClass: m.querySelector('[data-act="confirm"]').className
    });
  })()`);
  console.log('  ', dlg);
  let d = {};
  try { d = JSON.parse(dlg); } catch (e) {}
  check('对话框已渲染', d.exists, '');
  check('圆角符合设计', parseFloat(d.radius) >= 10, d.radius);
  check('有阴影', d.hasShadow, '');
  check('危险按钮为实心红', String(d.confirmBtnClass).includes('btn-danger-solid'), d.confirmBtnClass);

  await ev(`document.querySelector('.dialog-mask [data-act="cancel"]').click()`);
  await sleep(400);
  check('对话框可关闭', await ev(`!document.querySelector('.dialog-mask')`), '');

  console.log('\n════ 5. 更新区右侧元素 ════');
  const rightEl = await ev(`(() => {
    const row = document.getElementById('row-update-progress');
    if (!row) return JSON.stringify({exists:false});
    const actions = row.querySelector('.row-actions');
    return JSON.stringify({
      exists: true,
      hidden: row.hidden,
      hasActionBtn: !!row.querySelector('#btn-update-action'),
      hasCancelBtn: !!row.querySelector('#btn-update-cancel'),
      actionHidden: row.querySelector('#btn-update-action')?.hidden,
      cancelHidden: row.querySelector('#btn-update-cancel')?.hidden
    });
  })()`);
  console.log('  ', rightEl);

  console.log('\n══════════════════════════════');
  console.log(`  通过 ${pass} / ${pass + fail}`);
  console.log('══════════════════════════════');

  ws.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
