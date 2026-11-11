// UI 功能回归测试：验证弹窗开关、隐藏元素、开关控件
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 15000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const ev = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : null;
  };

  const results = [];
  const check = (name, actual, expected) => {
    const pass = actual === expected;
    results.push({ name, pass, actual, expected });
    console.log(`  ${pass ? '✓' : '✗'} ${name}  (实际=${JSON.stringify(actual)})`);
  };

  console.log('=== UI 功能回归 ===');

  // 隐藏状态
  check('弹窗初始隐藏', await ev(`document.getElementById('settings-modal').hidden`), true);
  check('进度条初始隐藏', await ev(`document.getElementById('progress-wrap').hidden`), true);
  check('提示框初始隐藏', await ev(`document.getElementById('result').hidden`), true);

  // 弹窗开关
  await ev(`document.getElementById('btn-settings').click()`);
  await sleep(350);
  check('点击设置→弹窗显示', await ev(`!document.getElementById('settings-modal').hidden`), true);

  await ev(`document.getElementById('btn-settings-done').click()`);
  await sleep(350);
  check('点击完成→弹窗隐藏', await ev(`document.getElementById('settings-modal').hidden`), true);

  // 点击遮罩关闭
  await ev(`document.getElementById('btn-settings').click()`);
  await sleep(300);
  await ev(`document.getElementById('settings-modal').click()`);
  await sleep(300);
  check('点击遮罩→弹窗隐藏', await ev(`document.getElementById('settings-modal').hidden`), true);

  // 控件存在性
  const switches = await ev(`document.querySelectorAll('.switch input').length`);
  check('开关控件数量', switches, 4);

  const selected = await ev(`document.querySelectorAll('.engine-item.selected').length`);
  check('模式已默认选中', selected, 1);

  const applyEnabled = await ev(`!document.getElementById('btn-apply').disabled`);
  check('执行汉化按钮可用', applyEnabled, true);

  // 设置值读取
  const vals = await ev(`JSON.stringify({
    launch: document.getElementById('set-launch-after-apply').checked,
    auto: document.getElementById('set-auto-inject').checked,
    interval: document.getElementById('set-interval').value,
  })`);
  console.log('  设置当前值:', vals);

  const failed = results.filter(r => !r.pass);
  console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  -', f.name)); }

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
