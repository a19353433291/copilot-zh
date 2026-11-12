// 方案 A 验收：统计界面上剩余的有色元素
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

  const pages = ['home', 'translate', 'dict', 'cleanup', 'settings'];
  let totalColored = 0;

  for (const theme of ['light', 'dark']) {
    console.log(`\n════ ${theme === 'light' ? '浅色' : '深色'}主题 · 有色元素扫描 ════`);
    await ev(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(300);

    for (const p of pages) {
      await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
      await sleep(450);

      // 扫描所有可见元素，找出「有饱和度」的背景色
      const found = await ev(`(() => {
        const out = [];
        const els = document.querySelectorAll('#pages *, .sidebar *');
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;

          const checks = [
            { prop: 'backgroundColor', val: cs.backgroundColor },
            { prop: 'borderLeftColor', val: cs.borderLeftColor, needW: parseFloat(cs.borderLeftWidth) },
            { prop: 'boxShadow', val: cs.boxShadow }
          ];

          for (const c of checks) {
            if (c.needW !== undefined && (!c.needW || c.needW < 1)) continue;
            const v = c.val;
            if (!v || v === 'none' || v.includes('rgba(0, 0, 0, 0)')) continue;
            const m = v.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
            if (!m) continue;
            const [_, R, G, B] = m.map(Number);
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            // 饱和度阈值：max-min > 40 视为明显有色
            if (mx - mn > 40) {
              out.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.className || '').toString().slice(0, 40),
                prop: c.prop,
                color: \`rgb(\${R},\${G},\${B})\`,
                size: Math.round(r.width) + 'x' + Math.round(r.height)
              });
            }
          }
        }
        return JSON.stringify(out);
      })()`);

      let arr = [];
      try { arr = JSON.parse(found); } catch (e) {}
      totalColored += arr.length;

      if (arr.length === 0) {
        console.log(`  ✓ ${p.padEnd(10)} 无有色元素`);
      } else {
        console.log(`  ⚠ ${p.padEnd(10)} ${arr.length} 个有色元素:`);
        // 去重展示
        const seen = new Set();
        arr.forEach(x => {
          const k = x.cls + '|' + x.prop + '|' + x.color;
          if (seen.has(k)) return;
          seen.add(k);
          console.log(`      ${x.tag}.${x.cls}  ${x.prop}=${x.color}  ${x.size}`);
        });
      }
    }
  }

  console.log(`\n════ 合计：${totalColored} 个有色元素（双主题 10 个页面合计）════`);

  await ev(`document.documentElement.dataset.theme = 'system'`);
  await ev(`document.querySelector('.nav-item[data-page="home"]').click()`);

  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
