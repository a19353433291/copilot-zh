// 验证设置页与模式选择器的汉化效果
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9222;

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

const COLLECT = `(() => {
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"]';
  const items = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t || t.length < 2 || t.length > 300) continue;
    try { if (n.parentElement && n.parentElement.closest(SKIP)) continue; } catch (e) {}
    items.add(t);
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.trim().length > 1) items.add(v.trim());
    }
  }
  return JSON.stringify([...items]);
})()`;

const CLICK = (text) => `(() => {
  const target = ${JSON.stringify(text)};
  for (const el of document.querySelectorAll('button,[role="button"],[role="tab"],[role="menuitem"],a,[tabindex]')) {
    const t = (el.textContent || '').trim();
    const al = (el.getAttribute && el.getAttribute('aria-label') || '').trim();
    if (t === target || al === target) {
      if (el.offsetParent !== null || el.getClientRects().length) { el.click(); return 'ok'; }
    }
  }
  return 'no';
})()`;

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  const ev = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : null;
  };

  const bag = new Set();
  const screens = [];

  async function snap(label) {
    const raw = await ev(COLLECT);
    if (!raw) return;
    const arr = JSON.parse(raw);
    let added = 0;
    for (const s of arr) if (!bag.has(s)) { bag.add(s); added++; }
    screens.push({ label, added, total: bag.size });
    console.log(`  [${label}] +${added} (累计 ${bag.size})`);
  }

  // 先注入最新字典，确保采集到的是翻译后状态
  try {
    const { registerWin32 } = require('../src/core/platform/win32');
    const { createEngines } = require('../src/core/platform/engine');
    const { applyOneClick } = require('../src/core/applyFlow');
    const loc = require('../src/core/locator');
    const packLib = require('../src/core/dict/pack');
    const { findCopilotPids } = require('../src/core/watcher');
    const pth = require('path');
    registerWin32();
    const eng = createEngines('win32').find(e => e.id === 'runtime-inject');
    const t = await loc.locateApp();
    const pk = packLib.loadPack(pth.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current'));
    if (t.ok && pk.ok) {
      const r = await applyOneClick({
        engine: eng,
        target: { exePath: t.exePath, version: t.version },
        dict: pk.dict,
        launchCopilot: async () => ({ ok: false, reason: 'skip' }),
        findPids: findCopilotPids,
        onProgress: () => {},
      });
      console.log('预注入:', r.ok ? '成功 替换' + (r.stats ? r.stats.replaced : 0) + ' 处' : '失败:' + r.reason);
    }
  } catch (e) { console.log('预注入异常:', e.message); }
  console.log('=== 遍历各界面 ===');
  await snap('主界面');

  // 打开设置（中文界面下按钮文字已是中文，两个都试）
  const openTargets = ['Settings', '设置', '设置, Ctrl + Comma', 'Manage accounts', '管理账户'];
  for (const t of openTargets) {
    const r = await ev(CLICK(t));
    if (r === 'ok') { await sleep(1200); await snap('点击:' + t); }
  }

  // 设置子项
  const subs = ['General', '通用', 'Accessibility', '无障碍', 'Voice dictation', '语音听写',
    'Computer Use', 'Model providers', '模型提供商', 'Experimental', '实验性功能',
    'Environments', '环境', 'Accounts', '账户', 'Appearance', '外观', 'Notifications', '通知'];
  for (const t of subs) {
    const r = await ev(CLICK(t));
    if (r === 'ok') { await sleep(900); await snap(t); }
  }

  // 模式选择器
  const modeTargets = ['Mode', '模式', 'Interactive', '交互式', 'Autopilot', '自动驾驶'];
  for (const t of modeTargets) {
    const r = await ev(CLICK(t));
    if (r === 'ok') { await sleep(900); await snap('模式:' + t); }
  }

  ws.close();

  const all = [...bag];
  const isCjk = s => /[\u4e00-\u9fff]/.test(s);
  const cjk = all.filter(isCjk);
  const en = all.filter(s => !isCjk(s));

  // 过滤掉不该翻译的
  const notTranslatable = (s) => {
    if (/^[a-z0-9._-]+$/.test(s)) return true;                 // 标识符
    if (/^(Ctrl|Alt|Shift|Control|Meta|Enter|Space|Tab|Esc|Escape|OK)$/.test(s)) return true;
    if (/^[A-Z][a-zA-Z]*$/.test(s) && s.length <= 12) return true;   // 单词品牌
    if (/^(Ctrl|Alt|Shift|Control) \+ /.test(s)) return true;
    if (/^[A-Z0-9 ]{2,20}$/.test(s)) return true;
    if (/^\d+$/.test(s)) return true;
    return false;
  };
  const needed = en.filter(s => !notTranslatable(s));

  console.log('\n===== 汉化覆盖统计 =====');
  console.log('界面文案总数:', all.length);
  console.log('已中文化:', cjk.length);
  console.log('仍英文:', en.length, '(需翻译:', needed.length, ')');
  const denom = cjk.length + needed.length;
  console.log('覆盖率:', denom ? (cjk.length / denom * 100).toFixed(1) + '%' : 'N/A');

  console.log('\n=== 需翻译但仍是英文 ===');
  needed.slice(0, 60).forEach(s => console.log('  ·', s.slice(0, 72)));

  console.log('\n=== 已中文化样例 ===');
  cjk.slice(0, 40).forEach(s => console.log('  ✓', s.slice(0, 60)));

  fs.writeFileSync('C:\\Users\\a1935\\Desktop\\copilot-zh\\dist-packs\\coverage-131.json',
    JSON.stringify({ all, cjk, needed }, null, 1));
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
