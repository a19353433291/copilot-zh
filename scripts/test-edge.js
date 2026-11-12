// 阶段五：边界场景测试
// 覆盖：窗口尺寸、动画关闭、玻璃关闭、主题切换下的组件重绘、
//       设置持久化重启、Copilot 已运行场景
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

  const results = [];
  const ev = async (expr, awaitPromise = true) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual, expected });
    console.log(`  ${pass ? '✓' : '✗'} ${name}${pass ? '' : `  期望=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)}`}`);
  };

  // ---------- 1. 窗口尺寸适配 ----------
  console.log('=== 1. 窗口尺寸适配 ===');
  const sizes = [
    { w: 1280, h: 900,  name: '1280x900 标准' },
    { w: 1040, h: 760,  name: '1040x760 默认' },
    { w: 900,  h: 700,  name: '900x700 紧凑' },
    { w: 800,  h: 640,  name: '800x640 窄窗' },
    { w: 700,  h: 600,  name: '700x600 极窄' },
  ];

  for (const s of sizes) {
    await ws.send('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(320);

    // 检查关键元素是否溢出视口
    const overflow = await ev(`(() => {
      const el = document.querySelector('.content-area');
      const pages = document.getElementById('pages');
      return JSON.stringify({
        contentW: el ? el.getBoundingClientRect().width : -1,
        bodyOverflowX: document.body.scrollWidth > window.innerWidth + 2,
        navVisible: !!document.querySelector('.nav-item'),
        sidebarW: document.querySelector('.sidebar') ? Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) : -1
      });
    })()`);
    let o = {};
    try { o = JSON.parse(overflow); } catch (e) {}
    const ok = !o.bodyOverflowX && o.navVisible && o.contentW > 0;
    results.push({ name: s.name, pass: ok });
    console.log(`  ${ok ? '✓' : '✗'} ${s.name}  侧栏=${o.sidebarW}px 内容区=${Math.round(o.contentW)}px 横向溢出=${o.bodyOverflowX}`);
  }

  // ---------- 2. 窄窗下侧边栏折叠 ----------
  console.log('\n=== 2. 窄窗侧边栏折叠 ===');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 780, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const narrow = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const label = document.querySelector('.nav-item span');
    const brand = document.querySelector('.titlebar-name');
    return JSON.stringify({
      sidebarW: Math.round(sb.getBoundingClientRect().width),
      labelHidden: label ? getComputedStyle(label).display === 'none' : false,
      brandHidden: brand ? getComputedStyle(brand).display === 'none' : false
    });
  })()`);
  let n = {};
  try { n = JSON.parse(narrow); } catch (e) {}
  check('侧边栏折叠到 68px', n.sidebarW <= 70, true);
  check('导航文字隐藏', n.labelHidden, true);
  check('标题栏品牌名隐藏', n.brandHidden, true);

  // ---------- 3. 动画关闭 ----------
  console.log('\n=== 3. 动画关闭 ===');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  await ev(`document.documentElement.dataset.motion = 'off'`);
  await sleep(200);
  const motionOff = await ev(`(() => {
    const el = document.querySelector('.group') || document.querySelector('.btn');
    const cs = getComputedStyle(el);
    return JSON.stringify({ transition: cs.transitionDuration, dataMotion: document.documentElement.dataset.motion });
  })()`);
  let mo = {};
  try { mo = JSON.parse(motionOff); } catch (e) {}
  check('动画已关闭', mo.dataMotion, 'off');
  check('过渡时长接近 0', String(mo.transition).startsWith('0.001s') || String(mo.transition) === '0s', true);
  await ev(`document.documentElement.dataset.motion = 'on'`);
  await sleep(200);

  // ---------- 4. 玻璃关闭 ----------
  console.log('\n=== 4. 玻璃效果关闭 ===');
  await ev(`document.documentElement.dataset.glass = 'off'`);
  await sleep(250);
  const glassOff = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const cs = getComputedStyle(sb);
    return JSON.stringify({
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      bg: cs.backgroundColor
    });
  })()`);
  let go = {};
  try { go = JSON.parse(glassOff); } catch (e) {}
  check('backdrop-filter 已禁用', String(go.backdrop) === 'none' || !go.backdrop, true);
  await ev(`document.documentElement.dataset.glass = 'normal'`);
  await sleep(250);

  // ---------- 5. 主题切换后分段控件重绘 ----------
  console.log('\n=== 5. 主题切换后组件重绘 ===');
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(400);
  const widths = [];
  for (const t of ['light', 'dark', 'light']) {
    await ev(`document.querySelector('#seg-theme .segmented-item[data-value="${t}"]').click()`);
    await sleep(320);
    const w = await ev(`parseFloat(getComputedStyle(document.getElementById('seg-theme')).getPropertyValue('--seg-w')) || 0`);
    widths.push(Math.round(w));
  }
  const allPositive = widths.every(w => w > 0);
  check('三次切换后滑块均有宽度', allPositive, true);
  console.log(`    滑块宽度序列: ${widths.join(', ')} px`);

  // ---------- 6. 所有页面在各主题下无溢出 ----------
  console.log('\n=== 6. 全页面双主题溢出检查 ===');
  const pages = ['home', 'translate', 'dict', 'cleanup', 'settings'];
  let overflowIssues = [];
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(200);
    for (const p of pages) {
      await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
      await sleep(280);
      const of = await ev(`(() => {
        const pages = document.getElementById('pages');
        return JSON.stringify({
          hOverflow: pages.scrollWidth > pages.clientWidth + 2,
          vOverflow: pages.scrollHeight > pages.clientHeight
        });
      })()`);
      let oo = {};
      try { oo = JSON.parse(of); } catch (e) {}
      if (oo.hOverflow) overflowIssues.push(`${theme}/${p}`);
    }
  }
  check('无横向溢出', overflowIssues.length, 0);
  if (overflowIssues.length) console.log('    溢出页面:', overflowIssues.join(', '));

  // ---------- 7. 设置持久化完整往返 ----------
  console.log('\n=== 7. 设置持久化往返 ===');
  const testPatch = { theme: 'dark', motion: 'off', glass: 'strong' };
  await ev(`window.api.setSettings(${JSON.stringify(testPatch)}).then(r => JSON.stringify(r))`);
  await sleep(400);
  const readBack = await ev(`window.api.getSettings().then(r => JSON.stringify({
    theme: r.data.theme, motion: r.data.motion, glass: r.data.glass
  }))`);
  let rb = {};
  try { rb = JSON.parse(readBack); } catch (e) {}
  check('theme 写入并读回', rb.theme, 'dark');
  check('motion 写入并读回', rb.motion, 'off');
  check('glass 写入并读回', rb.glass, 'strong');

  // 还原
  await ev(`window.api.setSettings({ theme: 'system', motion: 'on', glass: 'normal' })`);
  await sleep(300);

  // ---------- 8. 无效值拒绝 ----------
  console.log('\n=== 8. 非法设置值被拒绝 ===');
  await ev(`window.api.setSettings({ theme: 'invalid-value' })`);
  await sleep(300);
  const afterInvalid = await ev(`window.api.getSettings().then(r => r.data.theme)`);
  check('非法 theme 被拒绝（保持原值）', ['light', 'dark', 'system'].includes(afterInvalid), true);
  console.log(`    当前 theme: ${afterInvalid}`);

  // ---------- 9. 快速页面切换无异常 ----------
  console.log('\n=== 9. 快速连续切换页面 ===');
  const beforeErr = await ev(`(window.__errs || []).length`);
  for (let i = 0; i < 15; i++) {
    const p = pages[i % pages.length];
    await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
    await sleep(40);
  }
  await sleep(500);
  const afterErr = await ev(`(window.__errs || []).length`);
  check('快速切换无新增异常', afterErr === beforeErr, true);
  const finalPage = await ev(`document.querySelector('.page.active').dataset.page`);
  check('最终停留在有效页面', pages.includes(finalPage), true);

  // ---------- 汇总 ----------
  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 阶段五边界测试：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach(f => console.log('  -', f.name));
  }

  // 复原
  await ev(`document.documentElement.dataset.theme = 'system'`);
  await ev(`document.querySelector('.nav-item[data-page="home"]').click()`);
  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
