// 最终验证：开关、对齐、对话框
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
    if (r && r.exceptionDetails) {
      return 'EXC:' + JSON.parse(JSON.stringify(r.exceptionDetails)).exception.description;
    }
    return r && r.result ? r.result.value : null;
  };

  console.log('════ 1. 侧边栏对齐 ════');
  const align = await ev(`(() => {
    const f = document.querySelector('.sidebar-foot').getBoundingClientRect();
    const b = document.querySelector('.statusbar').getBoundingClientRect();
    return JSON.stringify({ footTop: Math.round(f.top), barTop: Math.round(b.top), diff: Math.round(Math.abs(f.top - b.top)) });
  })()`);
  let a = {};
  try { a = JSON.parse(align); } catch (e) {}
  check('两条分割线对齐（≤2px）', a.diff <= 2, `差 ${a.diff}px`);

  console.log('\n════ 2. 设置页开关 ════');
  // 用正确的方式切页
  await ev(`switchPage('settings')`);
  await sleep(700);
  const activePage = await ev(`document.querySelector('.page.active').dataset.page`);
  check('已切到设置页', activePage === 'settings', String(activePage));

  const size = await ev(`(() => {
    const t = document.querySelector('.toggle');
    const r = t.getBoundingClientRect();
    const inp = t.querySelector('input');
    const ir = inp.getBoundingClientRect();
    return JSON.stringify({ toggle: Math.round(r.width) + 'x' + Math.round(r.height),
                            input: Math.round(ir.width) + 'x' + Math.round(ir.height) });
  })()`);
  let s = {};
  try { s = JSON.parse(size); } catch (e) {}
  check('toggle 有尺寸', s.toggle === '33x20', s.toggle);
  check('input 有尺寸（可点击）', s.input === '33x20', s.input);

  // 逐个测试
  const ids = ['set-motion', 'set-launch-after-apply', 'set-auto-restart', 'set-close-on-revert',
               'set-auto-inject', 'set-check-on-start', 'set-run-at-login', 'set-minimize-tray'];
  let okCount = 0;
  for (const id of ids) {
    // 先滚到可见区域（开关可能在上/下视口外，elementFromPoint 会返 null）
    await ev(`(() => {
      const el = document.getElementById('${id}');
      if (el) el.closest('.toggle').scrollIntoView({ block: 'center' });
    })()`);
    // 等滚动与布局稳定（首个元素尤其需要，页面刚切换时尚未完成重排）
    await sleep(450);

    // 用 elementFromPoint 模拟真实用户点击（track 设了 pointer-events:none，
    // 直接 track.click() 不生效，必须点实际命中的元素）
    // 若首次未命中（滚动尚未生效），重试一次
    let r = await ev(`(() => {
      const el = document.getElementById('${id}');
      if (!el) return JSON.stringify({ missing: true });
      const b = el.checked;
      const tr = el.nextElementSibling;
      const rect = tr.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) return JSON.stringify({ before: b, err: 'no hit target', top: Math.round(rect.top) });
      hit.click();
      const mid = el.checked;
      if (mid !== b) { hit.click(); }
      return JSON.stringify({ before: b, after: mid, changed: b !== mid, hitTag: hit.tagName });
    })()`);

    let o = {};
    try { o = JSON.parse(r); } catch (e) { o = { err: r }; }

    if (o.err === 'no hit target') {
      // 再等一轮重试
      await sleep(400);
      r = await ev(`(() => {
        const el = document.getElementById('${id}');
        const b = el.checked;
        const tr = el.nextElementSibling;
        const rect = tr.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit) return JSON.stringify({ before: b, err: 'still no target' });
        hit.click();
        const mid = el.checked;
        if (mid !== b) { hit.click(); }
        return JSON.stringify({ before: b, after: mid, changed: b !== mid, hitTag: hit.tagName });
      })()`);
      try { o = JSON.parse(r); } catch (e) { o = { err: r }; }
    }

    const ok = o.changed === true;
    if (ok) okCount++;
    console.log(`  ${ok ? '✓' : '✗'} ${id.padEnd(24)} ${o.before} → ${o.after}${o.err ? '  ' + o.err : ''}`);
    await sleep(250);
  }
  check(`全部 8 个开关可切换（实际 ${okCount}）`, okCount === 8);

  console.log('\n════ 3. 统一对话框 ════');
  check('Dialog 已加载', await ev(`typeof window.Dialog === 'object'`));
  check('Dialog.confirm 是函数', await ev(`typeof window.Dialog.confirm === 'function'`));

  // 触发一个对话框但不等待结果
  await ev(`window.Dialog.confirm({ title: '测试标题', message: '测试内容', items: ['项目一','项目二'], note: '测试提示', danger: true }); 'started'`);
  await sleep(600);
  const dlg = await ev(`(() => {
    const m = document.querySelector('.dialog-mask');
    if (!m) return JSON.stringify({ exists: false });
    const d = m.querySelector('.dialog');
    const cs = d ? getComputedStyle(d) : null;
    return JSON.stringify({
      exists: true,
      hasTitle: !!m.querySelector('.dialog-title'),
      hasList: m.querySelectorAll('.dialog-list li').length,
      hasNote: !!m.querySelector('.dialog-note'),
      hasConfirm: !!m.querySelector('[data-act="confirm"]'),
      hasCancel: !!m.querySelector('[data-act="cancel"]'),
      radius: cs ? cs.borderRadius : null,
      bg: cs ? cs.backgroundColor : null
    });
  })()`);
  let d = {};
  try { d = JSON.parse(dlg); } catch (e) {}
  check('对话框已渲染', d.exists, '');
  check('含标题', d.hasTitle, '');
  check('含列表项', d.hasList === 2, String(d.hasList));
  check('含提示文字', d.hasNote, '');
  check('含确认按钮', d.hasConfirm, '');
  check('含取消按钮', d.hasCancel, '');
  check('使用设计圆角', parseFloat(d.radius) >= 10, d.radius);

  // 关闭对话框
  // 关闭后轮询等待（动画 140ms + 调度抖动，固定 400ms 不够稳定）
  await ev(`document.querySelector('.dialog-mask [data-act="cancel"]').click()`);
  for (let i = 0; i < 20; i++) {
    if (await ev(`!document.querySelector('.dialog-mask')`)) break;
    await sleep(150);
  }
  const closed = await ev(`!document.querySelector('.dialog-mask')`);
  check('对话框可关闭', closed, '');

  console.log('\n════ 4. 字典包更新入口 ════');
  const btn = await ev(`(() => { const b = document.getElementById('btn-check-update'); return JSON.stringify({ exists: !!b, text: b ? b.textContent.trim() : null }); })()`);
  let b2 = {};
  try { b2 = JSON.parse(btn); } catch (e) {}
  check('检查更新按钮存在', b2.exists, '');

  // 检查 IPC 返回结构（不再是 notConfigured）
  const ipc = await ev(`window.api.checkPackUpdate().then(r => JSON.stringify(r))`);
  console.log('  IPC 返回:', String(ipc).slice(0, 200));
  let ip = {};
  try { ip = JSON.parse(ipc); } catch (e) {}
  check('不再是占位实现（无 notConfigured）', ip.notConfigured === undefined, 'notConfigured=' + ip.notConfigured);

  console.log('\n══════════════════════════════');
  console.log(`  通过 ${pass} / ${pass + fail}`);
  console.log('══════════════════════════════');

  ws.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
