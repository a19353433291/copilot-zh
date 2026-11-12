// 精确定位边缘强度的来源：测量每个元素的边框与文字对比
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

  console.log('=== 元素边框强度分析 ===\n');

  // 1. 统计所有有边框的元素
  const borders = await ev(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      const cs = getComputedStyle(el);
      const bw = ['Top','Right','Bottom','Left'].map(d => parseFloat(cs['border'+d+'Width']) || 0);
      const maxBw = Math.max(...bw);
      if (maxBw >= 0.5) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className||'').toString().slice(0,36),
          w: Math.round(r.width), h: Math.round(r.height),
          bw: maxBw,
          color: cs.borderTopColor
        });
      }
    }
    return JSON.stringify(out);
  })()`);
  let bArr = [];
  try { bArr = JSON.parse(borders); } catch(e) {}
  console.log(`有边框元素: ${bArr.length} 个`);
  // 按颜色分组统计
  const byColor = {};
  bArr.forEach(b => { byColor[b.color] = (byColor[b.color]||0)+1; });
  console.log('按边框色分组:');
  Object.entries(byColor).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .forEach(([c,n]) => console.log(`  ${c}  ${n} 个`));

  // 2. 文字对比度分布
  console.log('\n=== 文字对比度 ===');
  const texts = await ev(`(() => {
    const els = document.querySelectorAll('#pages *, .sidebar *');
    const out = [];
    const seen = new Set();
    for (const el of els) {
      if (!el.childNodes.length) continue;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      const key = el.className + '|' + getComputedStyle(el).fontSize;
      if (seen.has(key)) continue;
      seen.add(key);
      const cs = getComputedStyle(el);
      out.push({
        cls: (el.className||'').toString().slice(0,30),
        size: cs.fontSize, weight: cs.fontWeight,
        color: cs.color
      });
    }
    return JSON.stringify(out);
  })()`);
  let tArr = [];
  try { tArr = JSON.parse(texts); } catch(e) {}
  console.log(`带文字元素: ${tArr.length} 个（去重后）`);
  tArr.slice(0, 15).forEach(t => console.log(`  ${t.size.padEnd(8)} w${t.weight.padEnd(4)} ${t.color.padEnd(20)} .${t.cls}`));

  // 3. 检查是否有多余的阴影
  console.log('\n=== 阴影使用 ===');
  const shadows = await ev(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('.group, .card, .hero-status, .stat-grid, .check-grid, .btn, .select-trigger, .toggle-track')) {
      const cs = getComputedStyle(el);
      if (cs.boxShadow && cs.boxShadow !== 'none') {
        out.push({ cls: (el.className||'').toString().slice(0,40), shadow: cs.boxShadow.slice(0,70) });
      }
    }
    return JSON.stringify(out);
  })()`);
  let sArr = [];
  try { sArr = JSON.parse(shadows); } catch(e) {}
  console.log(`有阴影元素: ${sArr.length} 个`);
  sArr.slice(0,8).forEach(s => console.log(`  .${s.cls}\n    ${s.shadow}`));

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
