// 精确验证下拉菜单是否被遮挡
// 方法：打开下拉 → 取菜单矩形 → 用 elementFromPoint 检查菜单区域内的点
//       是否真的属于菜单本身（而不是被上层元素覆盖）
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 25000); });
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
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: 1120, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  };

  // 切到设置页，那里有两个下拉框
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(500);

  console.log('=== 下拉遮挡检测 ===');

  for (const selId of ['sel-glass', 'sel-interval']) {
    // 确保是浅色主题 + 标准玻璃（复现用户报告的条件）
    await ev(`document.documentElement.dataset.theme = 'light'`);
    await ev(`document.documentElement.dataset.glass = 'normal'`);
    await sleep(250);

    // 滚动到该控件
    await ev(`document.querySelector('#${selId}').scrollIntoView({block:'center'})`);
    await sleep(400);

    // 打开下拉
    await ev(`document.querySelector('#${selId} .select-trigger').click()`);
    await sleep(400);

    // 检测：菜单区域内多个采样点是否都属于菜单
    const probe = await ev(`(() => {
      const menu = document.querySelector('#${selId} .select-menu');
      const r = menu.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return JSON.stringify({ error: 'menu not visible' });

      // 在菜单区域内取 9 个采样点（3x3 网格）
      const points = [];
      for (let i = 1; i <= 3; i++) {
        for (let j = 1; j <= 3; j++) {
          const x = r.left + (r.width * i) / 4;
          const y = r.top + (r.height * j) / 4;
          const hit = document.elementFromPoint(x, y);
          const inMenu = !!(hit && (hit === menu || menu.contains(hit)));
          points.push({ x: Math.round(x), y: Math.round(y), inMenu, tag: hit ? hit.className || hit.tagName : 'null' });
        }
      }
      const blocked = points.filter(p => !p.inMenu);
      return JSON.stringify({
        rect: { top: Math.round(r.top), height: Math.round(r.height) },
        total: points.length,
        blocked: blocked.length,
        sample: blocked.slice(0, 3)
      });
    })()`);

    let p = {};
    try { p = JSON.parse(probe); } catch (e) {}
    check(`${selId} 菜单未被遮挡`, p.blocked === 0,
      `采样 ${p.total} 点，被遮挡 ${p.blocked} 点` + (p.blocked ? ` ${JSON.stringify(p.sample)}` : ''));

    // 关闭
    await ev(`document.querySelector('#${selId} .select-trigger').click()`);
    await sleep(250);
  }

  // 视觉截图：打开 glass 下拉
  await ev(`document.querySelector('#sel-glass').scrollIntoView({block:'center'})`);
  await sleep(300);
  await ev(`document.querySelector('#sel-glass .select-trigger').click()`);
  await sleep(500);
  let shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-dropdown-light.png', Buffer.from(shot.data, 'base64'));
  console.log('  已保存浅色下拉截图');

  // 深色主题下同样测试
  await ev(`document.documentElement.dataset.theme = 'dark'`);
  await sleep(400);

  // 确保菜单处于关闭状态再打开（避免连点导致状态翻转）
  await ev(`(() => {
    const m = document.querySelector('#sel-glass .select-menu');
    if (!m.hidden) { document.querySelector('#sel-glass .select-trigger').click(); }
  })()`);
  await sleep(350);
  await ev(`document.querySelector('#sel-glass').scrollIntoView({block:'center'})`);
  await sleep(350);
  await ev(`document.querySelector('#sel-glass .select-trigger').click()`);
  await sleep(600);

  const menuVisible = await ev(`!document.querySelector('#sel-glass .select-menu').hidden`);
  check('深色下菜单已展开', menuVisible === true);

  const darkProbe = await ev(`(() => {
    const menu = document.querySelector('#sel-glass .select-menu');
    const r = menu.getBoundingClientRect();
    if (r.height === 0) return JSON.stringify({ error: 'not visible', blocked: -1 });
    let blocked = 0;
    for (let i = 1; i <= 3; i++) {
      for (let j = 1; j <= 3; j++) {
        const hit = document.elementFromPoint(r.left + (r.width*i)/4, r.top + (r.height*j)/4);
        if (!(hit && (hit === menu || menu.contains(hit)))) blocked++;
      }
    }
    return JSON.stringify({ blocked });
  })()`);
  let dp = {};
  try { dp = JSON.parse(darkProbe); } catch (e) {}
  check('深色主题下菜单未被遮挡', dp.blocked === 0, `被遮挡 ${dp.blocked} 点`);

  shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-dropdown-dark.png', Buffer.from(shot.data, 'base64'));
  console.log('  已保存深色下拉截图');

  // 关闭下拉并复原
  await ev(`document.querySelector('#sel-glass .select-trigger').click()`);
  await sleep(200);
  await ev(`document.documentElement.dataset.theme = 'system'`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 下拉遮挡测试：${results.length - failed.length}/${results.length} 通过 =====`);

  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
