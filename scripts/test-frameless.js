// 验证无边框窗口布局：控制按钮位置、拖拽区、主题跟随
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 20000); });
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
    if (r && r.exceptionDetails) return 'EXC';
    return r && r.result ? r.result.value : null;
  };

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  };

  console.log('=== 无边框布局验证 ===\n');

  // 1. 侧边栏是否顶到窗口顶部
  const sidebarTop = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const r = sb.getBoundingClientRect();
    return JSON.stringify({ top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left) });
  })()`);
  const sb = JSON.parse(sidebarTop);
  check('侧边栏顶到窗口最上沿', sb.top === 0, `top=${sb.top}px`);
  check('侧边栏占满高度', sb.height > 700, `${sb.height}px`);

  // 2. 内容区是否为浮起面板
  const panel = await ev(`(() => {
    const ca = document.querySelector('.content-area');
    const r = ca.getBoundingClientRect();
    const cs = getComputedStyle(ca);
    return JSON.stringify({
      top: Math.round(r.top),
      left: Math.round(r.left),
      right: Math.round(window.innerWidth - r.right),
      bottom: Math.round(window.innerHeight - r.bottom),
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      shadow: cs.boxShadow !== 'none'
    });
  })()`);
  const pn = JSON.parse(panel);
  check('面板四周有留白', pn.right > 0 && pn.bottom > 0, `右${pn.right}px 下${pn.bottom}px 顶${pn.top}px`);
  check('面板有圆角', parseFloat(pn.radius) >= 10, pn.radius);
  check('面板有阴影', pn.shadow, '');

  // 3. 拖拽区存在且不遮挡按钮
  const drag = await ev(`(() => {
    const d = document.querySelector('.titlebar-drag');
    if (!d) return JSON.stringify({ exists: false });
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return JSON.stringify({
      exists: true,
      height: Math.round(r.height),
      right: Math.round(window.innerWidth - r.right),
      appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region'),
      pointerEvents: cs.pointerEvents
    });
  })()`);
  const dg = JSON.parse(drag);
  check('拖拽区存在', dg.exists, '');
  check('拖拽区右侧留出按钮空间', dg.right >= 100, `留 ${dg.right}px`);
  check('拖拽区不拦截点击', dg.pointerEvents === 'none', dg.pointerEvents);

  // 4. 页面底部不受影响
  const bottom = await ev(`(() => {
    const sb = document.querySelector('.statusbar');
    const r = sb.getBoundingClientRect();
    return JSON.stringify({ bottomGap: Math.round(window.innerHeight - r.bottom), visible: r.height > 0 });
  })()`);
  const bt = JSON.parse(bottom);
  check('状态栏可见', bt.visible, '');
  check('状态栏在面板内（距窗口底有留白）', bt.bottomGap > 0, `距底 ${bt.bottomGap}px`);

  // 5. 双主题下面板颜色
  console.log('\n=== 主题跟随 ===');
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(400);
    const colors = await ev(`(() => {
      const app = document.querySelector('.app');
      const ca = document.querySelector('.content-area');
      const sb = document.querySelector('.sidebar');
      return JSON.stringify({
        appBg: getComputedStyle(app).backgroundColor,
        panelBg: getComputedStyle(ca).backgroundColor,
        sidebarBg: getComputedStyle(sb).backgroundColor
      });
    })()`);
    const c = JSON.parse(colors);
    console.log(`  [${theme}] 背景=${c.appBg}  面板=${c.panelBg}  侧栏=${c.sidebarBg}`);
    // 面板应与背景不同，形成层次
    check(`${theme} 面板与背景有层次`, c.panelBg !== c.appBg, '');
  }

  // 6. 窄窗适配
  console.log('\n=== 窄窗适配 ===');
  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: 800, height: 640, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);
  const narrow = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const ca = document.querySelector('.content-area');
    return JSON.stringify({
      sidebarW: Math.round(sb.getBoundingClientRect().width),
      panelVisible: ca.getBoundingClientRect().width > 400,
      overflowX: document.body.scrollWidth > window.innerWidth + 2
    });
  })()`);
  const nw = JSON.parse(narrow);
  check('窄窗侧边栏折叠', nw.sidebarW <= 70, `${nw.sidebarW}px`);
  check('窄窗面板仍可见', nw.panelVisible, '');
  check('窄窗无横向溢出', !nw.overflowX, '');
  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});

  await ev(`document.documentElement.dataset.theme = 'system'`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 无边框布局：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) failed.forEach(f => console.log('  -', f.name));

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
