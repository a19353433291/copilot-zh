// 真实端到端测试：通过 UI 点击「执行汉化」，验证流程可视化与实际汉化效果
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 90000); });
  }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const ev = async (expr, awaitPromise = true) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  };

  console.log('=== 真实端到端汉化测试 ===');

  // 切到汉化页
  await ev(`document.querySelector('.nav-item[data-page="translate"]').click()`);
  await sleep(400);

  console.log('1. 执行前状态');
  console.log('   目标:', await ev(`document.getElementById('target-info').textContent`));
  console.log('   执行按钮禁用:', await ev(`document.getElementById('btn-apply').disabled`));
  console.log('   Copilot 进程:', await ev(`document.getElementById('check-proc-value').textContent`));

  console.log('\n2. 点击「执行汉化」，观察阶段推进');
  // 不等待完成，先启动
  await ev(`document.getElementById('btn-apply').click()`, false);
  await sleep(600);

  // 采样阶段变化
  const stagesSeen = new Set();
  for (let i = 0; i < 45; i++) {
    await sleep(300);
    const active = await ev(`(() => {
      const a = document.querySelector('.flow-step.active');
      const d = document.querySelectorAll('.flow-step.done').length;
      return JSON.stringify({ active: a ? Number(a.dataset.step) : 0, done: d });
    })()`);
    let s = {};
    try { s = JSON.parse(active); } catch (e) {}
    if (s.active) stagesSeen.add(s.active);
    // 检查是否结束
    const busy = await ev(`state.busy`);
    if (!busy && i > 3) break;
  }
  console.log('   观察到的阶段:', [...stagesSeen].sort((a, b) => a - b).join(', '));

  console.log('\n3. 执行结果');
  const busy = await ev(`state.busy`);
  const resultHidden = await ev(`document.getElementById('result').hidden`);
  const resultText = await ev(`document.getElementById('result').textContent`);
  const doneCount = await ev(`document.querySelectorAll('.flow-step.done').length`);
  const failedCount = await ev(`document.querySelectorAll('.flow-step.failed').length`);

  console.log('   busy:', busy);
  console.log('   结果提示可见:', !resultHidden);
  console.log('   结果内容:', String(resultText).slice(0, 160).replace(/\n/g, ' | '));
  console.log('   完成阶段数:', doneCount);
  console.log('   失败阶段数:', failedCount);

  console.log('\n4. 汉化实际效果验证');
  const verify = await ev(`window.api.watcherStatus().then(s => JSON.stringify({
    copilotRunning: s.copilotRunning,
    injected: s.injected,
    pid: s.copilotPid,
    lastError: s.lastError,
    lastInjectAt: s.lastInjectAt
  }))`);
  let v = {};
  try { v = JSON.parse(verify); } catch (e) {}
  console.log('   Copilot 运行:', v.copilotRunning);
  console.log('   已注入:', v.injected);
  console.log('   PID:', v.pid);
  console.log('   错误:', v.lastError || '无');

  console.log('\n5. 页面内实际文本');
  const cjk = await ev(`window.api.watcherStatus().then(async () => {
    // 通过 CDP 无法访问 Copilot 页面，改用主进程已暴露的状态
    return 'n/a';
  })`);

  // 截图
  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: 1120, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(300);
  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-e2e-result.png', Buffer.from(shot.data, 'base64'));
  console.log('   已保存结果截图');

  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});

  const ok = v.injected === true && doneCount === 7;
  console.log(`\n===== ${ok ? '端到端汉化成功' : '需要检查'} =====`);

  ws.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
