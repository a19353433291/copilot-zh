// 测试：页面刷新后，监控器是否会自动重新注入
const http = require('http');
const crypto = require('crypto');
const net = require('net');

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path: p }, r => {
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
        if (!hs) {
          const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return;
          if (!this.buf.subarray(0, i).toString().includes('101')) return reject(new Error('hs'));
          hs = true; this.buf = this.buf.subarray(i + 4); resolve();
        }
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
const CHECK = `(() => {
  const s = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) s.add(t); }
  const a = [...s];
  return JSON.stringify({
    translator: typeof window.__copilotZh !== 'undefined',
    cjk: a.filter(x => /[\u4e00-\u9fff]/.test(x)).length,
    total: a.length,
  });
})()`;

async function check(ws) {
  const r = await ws.send('Runtime.evaluate', { expression: CHECK, returnByValue: true });
  return JSON.parse(r.result.value);
}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  console.log('=== 刷新前 ===');
  const before = await check(ws);
  console.log('  翻译器:', before.translator, '| 中文', before.cjk, '/', before.total);

  console.log('\n=== 强制刷新页面（模拟用户按 F5 / 应用重载）===');
  await ws.send('Page.enable', {});
  await ws.send('Page.reload', {});
  ws.close();

  // 刷新后立刻检查（此时应该丢失翻译）
  await sleep(3000);
  const list2 = JSON.parse(await httpGet('/json/list'));
  const page2 = list2.find(t => t.type === 'page');
  const ws2 = new WS(page2.webSocketDebuggerUrl);
  await ws2.connect();
  const justAfter = await check(ws2);
  console.log('  刷新后立即:', '翻译器:', justAfter.translator, '| 中文', justAfter.cjk, '/', justAfter.total);

  // 等监控器自动补注入（间隔 1500ms，留足余量）
  console.log('\n=== 等待监控器自动重新注入（最多 20 秒）===');
  let restored = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const c = await check(ws2);
    if (c.translator) {
      restored = { after: i + 1, ...c };
      break;
    }
    process.stdout.write('.');
  }
  console.log('');

  if (restored) {
    console.log(`✓ 监控器在 ${restored.after} 秒内自动恢复了翻译`);
    console.log(`  翻译器: ${restored.translator} | 中文 ${restored.cjk}/${restored.total}`);
  } else {
    console.log('✗ 20 秒内未自动恢复');
  }
  ws2.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
