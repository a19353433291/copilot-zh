// 验证玻璃设置三档是否有可见差异
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
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 150);
    return r && r.result ? r.result.value : null;
  };

  const probe = async () => await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const tb = document.querySelector('.topbar');
    const cs = getComputedStyle(sb);
    const ct = getComputedStyle(tb);
    return JSON.stringify({
      glass: document.documentElement.dataset.glass,
      sidebarBlur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      sidebarBg: cs.backgroundColor,
      topbarScrolled: tb.classList.contains('scrolled'),
      topbarBlur: ct.backdropFilter || ct.webkitBackdropFilter || 'none'
    });
  })()`);

  console.log('=== 玻璃三档差异检测 ===\n');

  for (const g of ['off', 'normal', 'strong']) {
    await ev(`document.documentElement.dataset.glass = '${g}'`);
    await new Promise(r => setTimeout(r, 350));
    const p = JSON.parse(await probe());
    console.log(`[${g}]`);
    console.log(`  侧边栏 blur: ${p.sidebarBlur}`);
    console.log(`  侧边栏 bg:   ${p.sidebarBg}`);
    console.log('');
  }

  console.log('=== 顶栏滚动材质 ===');
  await ev(`document.documentElement.dataset.glass = 'strong'`);
  await new Promise(r => setTimeout(r, 200));

  // 直接验证逻辑本身：模拟内容滚动后调用 updateTopbarMaterial。
  // 不依赖「某个页面刚好内容超出一屏」这种脆弱前提。
  const before = JSON.parse(await probe());
  console.log(`  滚动前 scrolled=${before.topbarScrolled}  blur=${before.topbarBlur}`);

  // 临时注入一段撑高内容，制造真实可滚动场景。
  // 注意：必须等布局完成后再设置 scrollTop，否则会读到 0（竞态）。
  await ev(`(() => {
    const p = document.getElementById('pages');
    const filler = document.createElement('div');
    filler.id = '__scroll_filler';
    filler.style.height = '800px';
    p.appendChild(filler);
  })()`);
  await new Promise(r => setTimeout(r, 400));

  // 设置滚动位置，并轮询确认真的滚下去了
  const scrolled = await ev(`(async () => {
    const p = document.getElementById('pages');
    p.scrollTop = 400;
    // 轮询等待 scrollTop 生效（最多 1.5 秒）
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (p.scrollTop > 0) break;
    }
    return p.scrollTop;
  })()`);

  await new Promise(r => setTimeout(r, 400));
  const after = JSON.parse(await probe());
  const canScroll = await ev(`(() => {
    const p = document.getElementById('pages');
    return p.scrollHeight > p.clientHeight + 10;
  })()`);
  console.log(`  注入后 scrollTop=${scrolled}  可滚动=${canScroll}  scrolled=${after.topbarScrolled}  blur=${after.topbarBlur}`);

  // 清理注入内容
  await ev(`(() => {
    const f = document.getElementById('__scroll_filler');
    if (f) f.remove();
    const p = document.getElementById('pages');
    p.scrollTop = 0;
    p.dispatchEvent(new Event('scroll'));
  })()`);
  await new Promise(r => setTimeout(r, 400));

  const ok1 = after.topbarScrolled === true;
  console.log(`\n  ${ok1 ? '✓' : '✗'} 顶栏在滚动时启用材质`);

  // 复原
  await ev(`document.documentElement.dataset.glass = 'normal'`);
  await ev(`document.querySelector('.nav-item[data-page="home"]').click()`);

  ws.close();
  process.exit(ok1 ? 0 : 1);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
