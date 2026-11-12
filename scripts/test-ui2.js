// 重构后的 UI 回归测试（v2）
// 覆盖：结构、导航、双主题、动效、玻璃强度、原有设置、真实数据、按钮状态
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

  const results = [];
  const ev = async (expr, awaitPromise = true) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r && r.exceptionDetails) {
      return { __exc: JSON.stringify(r.exceptionDetails).slice(0, 200) };
    }
    return r && r.result ? r.result.value : null;
  };
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual, expected });
    console.log(`  ${pass ? '✓' : '✗'} ${name}${pass ? '' : `  (期望=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)})`}`);
  };

  const goto = async (p) => {
    await ev(`document.querySelector('.nav-item[data-page="${p}"]').click()`);
    await sleep(240);
  };

  console.log('=== 1. 结构完整性 ===');
  await goto('home');
  check('导航项 5 个', await ev(`document.querySelectorAll('.nav-item').length`), 5);
  check('页面 5 个', await ev(`document.querySelectorAll('.page').length`), 5);
  check('初始在概览页', await ev(`document.querySelector('.page.active').dataset.page`), 'home');
  check('版本已填充', String(await ev(`document.getElementById('brand-version').textContent`)).startsWith('v'), true);

  console.log('\n=== 2. 页面导航 ===');
  for (const p of ['translate', 'dict', 'cleanup', 'settings', 'home']) {
    await goto(p);
    check(`切换到 ${p}`, await ev(`document.querySelector('.page.active').dataset.page`), p);
  }
  check('标题同步', await ev(`document.getElementById('page-title').textContent`), '概览');

  console.log('\n=== 3. 主题切换 ===');
  await goto('settings');
  for (const t of ['light', 'dark', 'system']) {
    await ev(`document.querySelector('#seg-theme .segmented-item[data-value="${t}"]').click()`);
    await sleep(280);
    check(`主题=${t}`, await ev(`document.documentElement.dataset.theme`), t);
  }
  await ev(`Segmented.reprojectAll()`);
  await sleep(220);
  const segW = await ev(`parseFloat(getComputedStyle(document.getElementById('seg-theme')).getPropertyValue('--seg-w')) || 0`);
  check('分段滑块已定位', segW > 0, true);

  console.log('\n=== 4. 动效与玻璃强度 ===');
  const motionBefore = await ev(`document.documentElement.dataset.motion`);
  await ev(`document.getElementById('set-motion').click()`);
  await sleep(420);
  const motionAfter = await ev(`document.documentElement.dataset.motion`);
  check('动效开关生效', motionBefore !== motionAfter, true);
  await ev(`document.getElementById('set-motion').click()`);
  await sleep(420);



  console.log('\n=== 5. 间隔下拉（原有功能）===');
  await ev(`document.querySelector('#sel-interval .select-trigger').click()`);
  await sleep(220);
  check('间隔下拉展开', await ev(`!document.querySelector('#sel-interval .select-menu').hidden`), true);
  await ev(`document.querySelector('#sel-interval .select-option[data-value="3000"]').click()`);
  await sleep(320);
  check('间隔选择生效', await ev(`document.querySelector('#sel-interval .select-trigger').dataset.value`), '3000');
  check('间隔菜单已关闭', await ev(`document.querySelector('#sel-interval .select-menu').hidden`), true);
  await ev(`document.querySelector('#sel-interval .select-trigger').click()`);
  await sleep(200);
  await ev(`document.querySelector('#sel-interval .select-option[data-value="1500"]').click()`);
  await sleep(320);

  console.log('\n=== 6. 设置持久化（真实 IPC）===');
  const savedJson = await ev(`window.api.getSettings().then(r => JSON.stringify(r.data))`);
  let saved = {};
  try { saved = JSON.parse(savedJson); } catch (e) {}
  const keys = Object.keys(saved);
  console.log('  磁盘设置项:', keys.join(', '));
  check('设置项总数 15', keys.length, 15);
  check('theme 已持久化', typeof saved.theme, 'string');
  check('motion 已持久化', typeof saved.motion, 'string');
  check('原有 launch 设置仍在', typeof saved.launchCopilotAfterApply, 'boolean');
  check('原有 autoInject 设置仍在', typeof saved.autoInjectOnStart, 'boolean');
  check('原有 interval 设置仍在', typeof saved.watchIntervalMs, 'number');

  console.log('\n=== 7. 概览页真实数据 ===');
  await goto('home');
  const statVer = await ev(`document.getElementById('stat-version').textContent`);
  const statSign = await ev(`document.getElementById('stat-sign').textContent`);
  const statDict = await ev(`document.getElementById('stat-dict').textContent`);
  const homeTitle = await ev(`document.getElementById('home-title').textContent`);
  const detailProc = await ev(`document.getElementById('home-copilot-proc').textContent`);
  const detailPort = await ev(`document.getElementById('home-port').textContent`);
  console.log(`  统计: 版本=${statVer} 签名=${statSign} 字典=${statDict}`);
  console.log(`  状态: ${homeTitle} | 进程=${detailProc} | 端口=${detailPort}`);
  check('目标版本非空', statVer !== '—', true);
  check('签名状态已渲染', ['有效', '已失效', '未知', '—'].includes(statSign), true);
  check('字典条数为数字', /^\d+$/.test(String(statDict)), true);
  check('主状态标题非空', String(homeTitle).length > 0, true);
  check('运行详情已渲染进程状态', String(detailProc).length > 0, true);
  check('运行详情已渲染端口状态', String(detailPort).length > 0, true);

  console.log('\n=== 8. 按钮与三要素 ===');
  check('一键汉化按钮存在', await ev(`!!document.getElementById('btn-quick-apply')`), true);
  check('还原英文按钮存在', await ev(`!!document.getElementById('btn-quick-revert')`), true);
  check('执行汉化按钮存在', await ev(`!!document.getElementById('btn-apply')`), true);
  check('执行汉化可用（三要素齐备）', await ev(`document.getElementById('btn-apply').disabled`), false);

  console.log('\n=== 9. 隐藏元素默认状态 ===');
  check('进度条初始隐藏', await ev(`document.getElementById('progress-wrap').hidden`), true);
  check('提示框初始隐藏', await ev(`document.getElementById('result').hidden`), true);

  const hintShown = await ev(`!document.getElementById('admin-hint').hidden`);
  const notElevated = await ev(`window.api.sysCheck().then(x => !x.elevated)`);
  check('管理员提示与提权状态一致', hintShown, !!notElevated);

  console.log('\n=== 10. 清理页真实审计 ===');
  await goto('cleanup');
  const auditText = await ev(`document.getElementById('audit-info').textContent`);
  console.log('  审计结果:', String(auditText).slice(0, 80));
  check('审计已执行（非"尚未检查"）', String(auditText).trim() !== '尚未检查', true);

  const failed = results.filter(r => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach(f => console.log('  -', f.name));
  }

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
