// 验证流程可视化：模拟进度推进，检查 7 个阶段的状态变化
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

  const ev = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 150);
    return r && r.result ? r.result.value : null;
  };

  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: 1120, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  // 切到汉化页并滚动到执行区
  await ev(`document.querySelector('.nav-item[data-page="translate"]').click()`);
  await sleep(400);
  await ev(`document.getElementById('flow-steps').scrollIntoView({block:'center'})`);
  await sleep(400);

  console.log('=== 流程可视化测试 ===');

  // 模拟开始
  await ev(`window.__testFlow = true; resetFlow(); flowState.running = true; flowState.currentStep = 1; advanceFlow(0)`);
  await sleep(200);

  const stages = [
    { pct: 8,   expectActive: 1, label: '检查 Copilot' },
    { pct: 20,  expectActive: 2, label: '写入调试策略' },
    { pct: 33,  expectActive: 3, label: '检查端口' },
    { pct: 42,  expectActive: 4, label: '重启 Copilot' },
    { pct: 60,  expectActive: 5, label: '等待界面就绪' },
    { pct: 75,  expectActive: 6, label: '注入翻译' },
    { pct: 92,  expectActive: 7, label: '验证结果' },
  ];

  let pass = 0;
  for (const s of stages) {
    await ev(`advanceFlow(${s.pct})`);
    await sleep(160);
    const activeStep = await ev(`(() => {
      const el = document.querySelector('.flow-step.active');
      return el ? Number(el.dataset.step) : 0;
    })()`);
    const doneCount = await ev(`document.querySelectorAll('.flow-step.done').length`);
    const ok = activeStep === s.expectActive;
    if (ok) pass++;
    console.log(`  ${ok ? '✓' : '✗'} ${String(s.pct).padStart(3)}% → 阶段 ${activeStep}（期望 ${s.expectActive}）${s.label} · 已完成 ${doneCount} 个`);
  }

  // 截当前状态
  let shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-flow-progress.png', Buffer.from(shot.data, 'base64'));
  console.log('  已保存进度中截图');

  // 测试完成态
  await ev(`completeFlow()`);
  await sleep(250);
  const allDone = await ev(`document.querySelectorAll('.flow-step.done').length`);
  console.log(`  ${allDone === 7 ? '✓' : '✗'} 完成态：${allDone}/7 标记完成`);
  if (allDone === 7) pass++;

  shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-flow-done.png', Buffer.from(shot.data, 'base64'));
  console.log('  已保存完成态截图');

  // 测试失败态
  await ev(`resetFlow(); flowState.running = true; flowState.currentStep = 1; advanceFlow(35); failFlow()`);
  await sleep(250);
  const failedCount = await ev(`document.querySelectorAll('.flow-step.failed').length`);
  console.log(`  ${failedCount === 1 ? '✓' : '✗'} 失败态：${failedCount} 个标红`);
  if (failedCount === 1) pass++;

  // 复原
  await ev(`resetFlow()`);
  await ws.send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});

  console.log(`\n===== 流程可视化 ${pass}/${stages.length + 2} 通过 =====`);

  ws.close();
  process.exit(pass === stages.length + 2 ? 0 : 1);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
