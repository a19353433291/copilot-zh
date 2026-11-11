// 验证新 UI：分页切换 + 自定义下拉框
const fs = require('fs');
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
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails.text || '');
    return r && r.result ? r.result.value : null;
  };

  const results = [];
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual });
    console.log(`  ${pass ? '✓' : '✗'} ${name}  (${JSON.stringify(actual)})`);
  };

  console.log('=== 分页导航测试 ===');
  const pages = ['home', 'translate', 'dict', 'cleanup', 'settings'];
  for (const p of pages) {
    await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
    await sleep(220);
    const active = await ev(`document.querySelector('.page.active').dataset.page`);
    const title = await ev(`document.getElementById('page-title').textContent`);
    check(`切换到 ${p}`, active, p);
    if (p === 'settings') console.log(`      标题: ${title}`);
  }

  console.log('\n=== 自定义下拉框测试 ===');
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(250);

  const menuHiddenBefore = await ev(`document.querySelector('#sel-interval .select-menu').hidden`);
  check('下拉菜单初始隐藏', menuHiddenBefore, true);

  const labelBefore = await ev(`document.querySelector('#sel-interval .select-label').textContent`);
  console.log(`      当前值: ${labelBefore}`);

  // 展开菜单
  await ev(`document.querySelector('#sel-interval .select-trigger').click()`);
  await sleep(220);
  check('点击后菜单展开', await ev(`!document.querySelector('#sel-interval .select-menu').hidden`), true);

  // 选择 3 秒
  await ev(`document.querySelector('#sel-interval .select-option[data-value="3000"]').click()`);
  await sleep(350);
  check('选择后菜单关闭', await ev(`document.querySelector('#sel-interval .select-menu').hidden`), true);
  check('标签已更新', await ev(`document.querySelector('#sel-interval .select-label').textContent`), '3 秒（省电）');
  check('按钮值已更新', await ev(`document.querySelector('#sel-interval .select-trigger').dataset.value`), '3000');

  // 还原为推荐值
  await ev(`document.querySelector('#sel-interval .select-trigger').click()`);
  await sleep(200);
  await ev(`document.querySelector('#sel-interval .select-option[data-value="1500"]').click()`);
  await sleep(300);

  console.log('\n=== 其他控件 ===');
  check('开关数量', await ev(`document.querySelectorAll('.switch input').length`), 6);
  check('原生 select 已移除', await ev(`document.querySelectorAll('select').length`), 0);
  // 管理员提示：未提权才显示，与 sysCheck 结果一致即为正确
  const elevated = await ev(`window.api.sysCheck().then(x => x.elevated)`);
  const hintShown = await ev(`!document.getElementById('admin-hint').hidden`);
  check('管理员提示与提权状态一致', hintShown, !elevated);

  // 截设置页
  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\_scratch\\paged-settings.png',
    Buffer.from(shot.data, 'base64'));
  console.log('  设置页截图已保存');

  const failed = results.filter(r => !r.pass);
  console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) failed.forEach(f => console.log('  失败:', f.name, '实际=', JSON.stringify(f.actual)));

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
