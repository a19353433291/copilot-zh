// 运行时文案采集：通过 CDP 驱动 Copilot 界面，遍历各视图收集真实 UI 文案。
// 相比静态分析，这里收集到的 100% 是用户真能看到的文字。
//
// 用法：node scripts/collect-live.js [--out 文件]

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

function httpGet(p, port = 9222) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: p }, r => {
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
          const i = this.buf.indexOf('\r\n\r\n');
          if (i < 0) return;
          if (!this.buf.subarray(0, i).toString().includes('101')) return reject(new Error('握手失败'));
          hs = true; this.buf = this.buf.subarray(i + 4); resolve();
        }
        this.process();
      });
      this.sock.on('error', reject);
    });
  }
  process() {
    while (true) {
      if (this.buf.length < 2) return;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const t = this.buf.subarray(off, off + len).toString('utf8');
      this.buf = this.buf.subarray(off + len);
      try {
        const m = JSON.parse(t);
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        }
      } catch (e) { /* ignore */ }
    }
  }
  send(method, params) {
    const id = ++this.id;
    const data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 20000);
    });
  }
  close() { try { this.sock.destroy(); } catch (e) { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// 页面内采集逻辑
// ---------------------------------------------------------------------------

const COLLECT = `
(() => {
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"]';
  const items = new Set();

  function isUiText(el) {
    if (!el) return false;
    try { if (el.closest(SKIP)) return false; } catch (e) {}
    // 跳过过深层级（多为 canvas/svg 内部）
    return true;
  }

  // 1. 可见文本节点
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const raw = n.nodeValue;
    if (!raw) continue;
    const t = raw.trim();
    if (!t || t.length < 2 || t.length > 300) continue;
    if (!isUiText(n.parentElement)) continue;
    if (!/[A-Za-z]/.test(t)) continue;
    // 排除纯数字/符号
    if (!/[a-zA-Z]{2,}/.test(t)) continue;
    items.add(t);
  }

  // 2. 属性文案
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const t = v.trim();
      if (t.length < 2 || t.length > 300) continue;
      if (!/[a-zA-Z]{2,}/.test(t)) continue;
      items.add(t);
    }
  }

  return JSON.stringify([...items]);
})()
`;

/** 找到并点击匹配文字的可见元素，用于导航到其他界面 */
const CLICK_BY_TEXT = (text) => `
(() => {
  const target = ${JSON.stringify(text)};
  const all = document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a, [tabindex]');
  for (const el of all) {
    const t = (el.textContent || '').trim();
    const al = (el.getAttribute && el.getAttribute('aria-label') || '').trim();
    if (t === target || al === target) {
      if (el.offsetParent !== null || el.getClientRects().length) {
        el.click();
        return 'clicked:' + target;
      }
    }
  }
  return 'notfound:' + target;
})()
`;

const PRESS_KEY = (key, modifiers) => `
(() => {
  const opts = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true,
    ctrlKey: ${!!(modifiers && modifiers.ctrl)}, shiftKey: ${!!(modifiers && modifiers.shift)},
    altKey: ${!!(modifiers && modifiers.alt)}, metaKey: ${!!(modifiers && modifiers.meta)} };
  document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', opts));
  document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
  return 'pressed';
})()
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function evalIn(ws, expr) {
  const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}

async function collectOnce(ws, bag) {
  const raw = await evalIn(ws, COLLECT);
  if (!raw) return 0;
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { return 0; }
  let added = 0;
  for (const t of arr) { if (!bag.has(t)) { bag.add(t); added++; } }
  return added;
}

async function main() {
  const args = process.argv.slice(2);
  let outPath = null;
  for (let i = 0; i < args.length; i++) if (args[i] === '--out') outPath = args[i + 1];

  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  if (!page) { console.error('未找到 Copilot 页面，请确认应用已启动且调试端口开启'); process.exit(1); }

  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();
  console.log('已连接 Copilot 页面:', page.url);

  const bag = new Set();
  const screens = [];

  async function snap(label) {
    const n = await collectOnce(ws, bag);
    screens.push({ label, newItems: n, total: bag.size });
    console.log(`  [${label}] 新增 ${n} 条，累计 ${bag.size} 条`);
  }

  await snap('主界面');

  // 依次尝试打开各界面（存在的才点，不存在就跳过）
  const navTargets = [
    'Settings', '设置', 'Automations', 'Customize', 'Extensions', 'Plugins',
    'Skills', 'MCP', 'Canvases', 'Projects', 'Pull requests', 'Issues',
    'Chats', 'Sessions', 'Usage', 'Account', 'Themes', 'Shortcuts',
    'Keyboard shortcuts', 'About', 'Appearance', 'Notifications',
  ];

  for (const t of navTargets) {
    const r = await evalIn(ws, CLICK_BY_TEXT(t));
    if (r && r.startsWith('clicked:')) {
      await sleep(900);
      await snap(t);
      // 尝试返回（Esc）
      await evalIn(ws, PRESS_KEY('Escape'));
      await sleep(400);
    }
  }

  // 命令面板 Ctrl+K
  await evalIn(ws, PRESS_KEY('k', { ctrl: true }));
  await sleep(900);
  await snap('命令面板 Ctrl+K');
  await evalIn(ws, PRESS_KEY('Escape'));
  await sleep(400);

  // 设置里可能有子项，再点一轮常见设置项
  await evalIn(ws, CLICK_BY_TEXT('Settings'));
  await sleep(900);
  await snap('设置页');
  const settingTabs = ['General', 'Appearance', 'Behavior', 'Privacy', 'Security',
    'Notifications', 'Shortcuts', 'Models', 'Account', 'Advanced', 'About',
    'Voice', 'Computer Use', 'Extensions', 'MCP', 'Skills'];
  for (const t of settingTabs) {
    const r = await evalIn(ws, CLICK_BY_TEXT(t));
    if (r && r.startsWith('clicked:')) {
      await sleep(700);
      await snap('设置/' + t);
    }
  }
  await evalIn(ws, PRESS_KEY('Escape'));

  ws.close();

  // 过滤与产出
  const strings = [...bag].sort((a, b) => a.localeCompare(b));

  // 粗筛：去掉明显不是 UI 的
  const noise = /^(https?:|\/|[A-Za-z]:\\)|\.(js|css|png|svg|json|woff2?)$|^[0-9a-f]{16,}$|^\d+$/;
  const filtered = strings.filter(s => !noise.test(s));

  const root = path.resolve(__dirname, '..');
  const target = outPath ? path.resolve(outPath) : path.join(root, 'dist-packs', 'live-strings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    collectedAt: new Date().toISOString(),
    screens,
    count: filtered.length,
    strings: filtered,
  }, null, 1));

  console.log('\n=== 采集完成 ===');
  console.log('访问界面数:', screens.length);
  console.log('唯一文案数:', filtered.length);
  console.log('输出:', target);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
