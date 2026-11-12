// 0.10.1 安装版完整验收
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = Number(process.argv[2] || 9444);
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
  send(method, params, to = 40000) {
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
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.parse(JSON.stringify(r.exceptionDetails)).exception.description;
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 1. 版本 ════');
  const v = await ev(`window.api.env().then(r => r.appVersion)`);
  check('应用版本为 0.10.1', v === '0.10.1', String(v));

  console.log('\n════ 2. 侧边栏对齐 ════');
  const align = await ev(`(() => {
    const f = document.querySelector('.sidebar-foot').getBoundingClientRect();
    const b = document.querySelector('.statusbar').getBoundingClientRect();
    return JSON.stringify({ diff: Number(Math.abs(f.top - b.top).toFixed(2)) });
  })()`);
  let a = {}; try { a = JSON.parse(align); } catch (e) {}
  check('两条线精确对齐', a.diff === 0, `差 ${a.diff}px`);

  console.log('\n════ 3. 更新渠道 ════');
  await ev(`switchPage('settings')`);
  await sleep(900);
  const ch = await ev(`(() => {
    const s = document.getElementById('seg-channel');
    if (!s) return JSON.stringify({exists:false});
    const act = s.querySelector('.segmented-item.active');
    return JSON.stringify({
      exists: true,
      active: act ? act.dataset.value : null,
      count: s.querySelectorAll('.segmented-item').length,
      segW: getComputedStyle(s).getPropertyValue('--seg-w').trim()
    });
  })()`);
  console.log('  ', ch);
  let c = {}; try { c = JSON.parse(ch); } catch (e) {}
  check('渠道控件存在', c.exists, '');
  check('有正式版/测试版两项', c.count === 2, String(c.count));
  check('滑块有宽度', parseFloat(c.segW) > 0, c.segW);

  console.log('\n════ 4. 徽章不显示空占位 ════');
  const badge = await ev(`(() => {
    const b = document.getElementById('update-badge');
    return JSON.stringify({ hidden: b.hidden, text: b.textContent });
  })()`);
  console.log('  ', badge);
  let bd = {}; try { bd = JSON.parse(badge); } catch (e) {}
  check('徽章不是空横线', bd.text !== '—', bd.text);

  console.log('\n════ 5. 更新检查不卡住 ════');
  const t0 = Date.now();
  const r = await ev(`window.api.updateCheck().then(x => JSON.stringify(x))`);
  const el = Date.now() - t0;
  console.log(`  耗时 ${el}ms:`, String(r).slice(0, 150));
  check('在 15 秒内返回', el < 15000, el + 'ms');
  let rr = {}; try { rr = JSON.parse(r); } catch (e) {}
  check('返回明确结果', typeof rr.ok === 'boolean', String(rr.ok));
  await sleep(500);
  const st = await ev(`window.api.updateStatus().then(s => s.state)`);
  check('状态未卡在 checking', st !== 'checking', String(st));

  console.log('\n════ 6. 统一对话框 ════');
  await ev(`window.Dialog.confirm({ title:'测试', message:'内容', items:['a','b'], danger:true }); 0`);
  await sleep(700);
  const dlg = await ev(`(() => {
    const m = document.querySelector('.dialog-mask');
    if (!m) return JSON.stringify({exists:false});
    const d = m.querySelector('.dialog');
    return JSON.stringify({
      exists: true,
      radius: getComputedStyle(d).borderRadius,
      hasShadow: getComputedStyle(d).boxShadow !== 'none',
      listCount: m.querySelectorAll('.dialog-list li').length,
      isDangerRed: !!m.querySelector('.btn-danger-solid')
    });
  })()`);
  console.log('  ', dlg);
  let d = {}; try { d = JSON.parse(dlg); } catch (e) {}
  check('对话框已渲染', d.exists, '');
  check('使用设计圆角', parseFloat(d.radius) >= 10, d.radius);
  check('有阴影', d.hasShadow, '');
  check('危险按钮实心红', d.isDangerRed, '');
  await ev(`document.querySelector('.dialog-mask .dialog-cancel')?.click(); 0`);
  await sleep(700);
  check('可正常关闭', await ev(`!document.querySelector('.dialog-mask')`), '');

  console.log('\n════ 7. 字典包更新入口 ════');
  const pk = await ev(`window.api.checkPackUpdate().then(r => JSON.stringify(r))`);
  console.log('  ', String(pk).slice(0, 160));
  let p = {}; try { p = JSON.parse(pk); } catch (e) {}
  check('不再是占位实现', p.notConfigured === undefined, String(p.notConfigured));

  console.log('\n══════════════════════════════');
  console.log(`  通过 ${pass} / ${pass + fail}`);
  console.log('══════════════════════════════');

  ws.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
