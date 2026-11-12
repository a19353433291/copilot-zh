// 更新 UI 功能测试
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;
function httpGet(p) {
  return new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
    r.on('error', rej);
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
  send(method, params, timeoutMs = 25000) {
    const id = ++this.id, data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, timeoutMs); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();
  try { await ws.send('Page.enable', {}, 10000); } catch (e) {}

  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  console.log('=== 1. UI 元素存在性 ===');
  check('UpdateUI 已加载', await ev(`typeof window.UpdateUI === 'object'`));
  check('更新徽章', await ev(`!!document.getElementById('update-badge')`));
  check('当前版本行', await ev(`!!document.getElementById('update-current')`));
  check('检查按钮', await ev(`!!document.getElementById('btn-update-check')`));
  check('更新源下拉', await ev(`!!document.getElementById('sel-update-source')`));
  check('自定义地址行', await ev(`!!document.getElementById('row-update-custom')`));
  check('启动检查开关', await ev(`!!document.getElementById('set-check-on-start')`));
  check('检查间隔下拉', await ev(`!!document.getElementById('sel-update-hours')`));
  check('进度行', await ev(`!!document.getElementById('row-update-progress')`));

  console.log('\n=== 2. 初始状态 ===');
  // 重复运行测试时，上一轮可能把 userInitiated 置为 true（用户主动检查过），
  // 那会让后续「后台错误不打扰」的判断失效。这里先复位。
  await ev(`(() => { if (window.UpdateUI && window.UpdateUI._resetForTest) window.UpdateUI._resetForTest(); })()`);
  await sleep(300);

  check('当前版本已填充', await ev(`(document.getElementById('update-current').textContent||'').includes('v')`),
    await ev(`document.getElementById('update-current').textContent`));

  // 等启动时的后台检查走完（最多 8 秒），再判断进度行可见性
  for (let i = 0; i < 16; i++) {
    const st = await ev(`window.api.updateStatus().then(s=>s.state)`);
    if (st !== 'checking') break;
    await sleep(500);
  }
  check('后台检查失败不显示进度行', await ev(`document.getElementById('row-update-progress').hidden`));
  check('自定义地址行默认隐藏', await ev(`document.getElementById('row-update-custom').hidden`));

  console.log('\n=== 3. IPC 接口 ===');
  const apiList = await ev(`JSON.stringify(Object.keys(window.api).filter(k=>k.toLowerCase().includes('update')))`);
  console.log('  更新相关 API:', apiList);
  check('updateStatus 可用', await ev(`typeof window.api.updateStatus === 'function'`));
  check('updateCheck 可用', await ev(`typeof window.api.updateCheck === 'function'`));
  check('updateDownload 可用', await ev(`typeof window.api.updateDownload === 'function'`));
  check('updateInstall 可用', await ev(`typeof window.api.updateInstall === 'function'`));

  const st = await ev(`window.api.updateStatus().then(s=>JSON.stringify(s))`);
  console.log('  当前状态:', st);
  let stObj = {};
  try { stObj = JSON.parse(st); } catch (e) {}
  check('状态含 state', typeof stObj.state === 'string', stObj.state);
  check('状态含 currentVersion', typeof stObj.currentVersion === 'string', stObj.currentVersion);

  console.log('\n=== 4. 设置项已接入 ===');
  const settings = await ev(`window.api.getSettings().then(r=>JSON.stringify(r.data))`);
  let sObj = {};
  try { sObj = JSON.parse(settings); } catch (e) {}
  check('updateSource 存在', sObj.updateSource !== undefined, String(sObj.updateSource));
  check('checkUpdateOnStart 存在', sObj.checkUpdateOnStart !== undefined, String(sObj.checkUpdateOnStart));
  check('updateCheckHours 存在', sObj.updateCheckHours !== undefined, String(sObj.updateCheckHours));
  check('updateGithubRepo 存在', sObj.updateGithubRepo !== undefined, String(sObj.updateGithubRepo));

  console.log('\n=== 5. 切换更新源 UI ===');
  await ev(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  await sleep(600);
  await ev(`document.getElementById('sel-update-source').scrollIntoView({block:'center'})`);
  await sleep(400);
  await ev(`document.querySelector('#sel-update-source .select-trigger').click()`);
  await sleep(400);
  check('源下拉展开', await ev(`!document.querySelector('#sel-update-source .select-menu').hidden`));
  await ev(`document.querySelector('#sel-update-source .select-option[data-value="generic"]').click()`);
  await sleep(800);
  check('切到自定义源后地址行显示', await ev(`!document.getElementById('row-update-custom').hidden`));
  const newSource = await ev(`window.api.getSettings().then(r=>r.data.updateSource)`);
  check('设置已持久化', newSource === 'generic', String(newSource));

  // 切回 github
  await ev(`document.querySelector('#sel-update-source .select-trigger').click()`);
  await sleep(300);
  await ev(`document.querySelector('#sel-update-source .select-option[data-value="github"]').click()`);
  await sleep(800);
  check('切回 GitHub 后地址行隐藏', await ev(`document.getElementById('row-update-custom').hidden`));

  console.log('\n=== 6. 检查更新（真实网络）===');
  await ev(`document.getElementById('btn-update-check').click()`);
  await sleep(6000);
  const afterCheck = await ev(`window.api.updateStatus().then(s=>JSON.stringify(s))`);
  console.log('  检查后状态:', afterCheck);
  let ac = {};
  try { ac = JSON.parse(afterCheck); } catch (e) {}
  check('状态已更新', ac.state !== 'checking', ac.state);
  const badgeText = await ev(`document.getElementById('update-badge').textContent`);
  console.log('  徽章文本:', badgeText);

  console.log('\n==================================');
  console.log(`  通过 ${passed} / ${passed + failed}`);
  console.log('==================================');

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
