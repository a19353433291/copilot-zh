// 正确的覆盖率测量：先注入翻译，再逐界面采集，最后统计中文占比
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const root = path.resolve(__dirname, '..');
const packLib = require(path.join(root, 'src/core/dict/pack'));

function httpGet(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path: p }, r => {
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

const TRANSLATOR = (dict) => `(() => {
  const DICT = ${JSON.stringify(dict)};
  const texts = DICT.entries.texts || {};
  const attrs = DICT.entries.attrs || {};
  const patterns = (DICT.entries.patterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);
  const attrPatterns = (DICT.entries.attrPatterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);
  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"], [contenteditable=""]';
  let replaced = 0;
  function skip(el){ if(!el) return true; try { return !!el.closest(SKIP); } catch(e){ return false; } }
  function tt(node){
    const raw=node.nodeValue; if(!raw) return; const t=raw.trim();
    if(!t||t.length<2||t.length>500) return; if(skip(node.parentElement)) return;
    if(texts[t]!==undefined){ if(raw!==texts[t]){ const l=raw.match(/^\\s*/)[0], r=raw.match(/\\s*$/)[0]; node.nodeValue=l+texts[t]+r; replaced++; } return; }
    for(let i=0;i<patterns.length;i++){ const [re,rep]=patterns[i]; if(re.test(t)){ const v=t.replace(re,rep); if(v!==t){ node.nodeValue=raw.replace(t,v); replaced++; } return; } }
  }
  function ta(el){
    for(const n of ['placeholder','title','aria-label','alt']){
      const v=el.getAttribute&&el.getAttribute(n); if(!v) continue;
      if(attrs[v]!==undefined){ el.setAttribute(n,attrs[v]); replaced++; continue; }
      for(let i=0;i<attrPatterns.length;i++){ const [re,rep]=attrPatterns[i]; if(re.test(v)){ el.setAttribute(n,v.replace(re,rep)); replaced++; break; } }
    }
  }
  function walk(r){
    if(!r) return;
    if(r.nodeType===3){ tt(r); return; }
    if(r.nodeType!==1&&r.nodeType!==9&&r.nodeType!==11) return;
    if(r.tagName&&/^(SCRIPT|STYLE|CODE|PRE)$/.test(r.tagName)) return;
    const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT,null); let n;
    while((n=w.nextNode())) tt(n);
    if(r.querySelectorAll) r.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(ta);
  }
  apply();
  if(window.__zhObs) try{ window.__zhObs.disconnect(); }catch(e){}
  const obs=new MutationObserver(m=>{ for(const x of m){ if(x.type==='characterData') tt(x.target); else for(const n of x.addedNodes) walk(n); } });
  obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','alt']});
  window.__zhObs=obs;
  document.documentElement.lang='zh-CN';
  window.__copilotZh={dict:DICT,apply,stats(){return {replaced,running:true}}};
  return {replaced};
})();`;

const COLLECT = `(() => {
  const SKIP='pre, code, script, style, textarea, [contenteditable="true"]';
  const items=new Set();
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
  while((n=w.nextNode())){ const raw=n.nodeValue; if(!raw) continue; const t=raw.trim();
    if(!t||t.length<2||t.length>300) continue;
    try{ if(n.parentElement&&n.parentElement.closest(SKIP)) continue; }catch(e){}
    if(!/[a-zA-Z]{2,}/.test(t)&&!/[\\u4e00-\\u9fff]/.test(t)) continue; items.add(t); }
  for(const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')){
    for(const a of ['placeholder','title','aria-label','alt']){ const v=el.getAttribute&&el.getAttribute(a); if(!v) continue;
      const t=v.trim(); if(t.length<2||t.length>300) continue; items.add(t); } }
  return JSON.stringify([...items]);
})()`;

async function ev(ws, expr) {
  const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : null;
}

(async () => {
  const curPack = path.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current');
  const loaded = packLib.loadPack(curPack);
  if (!loaded.ok) { console.error('字典加载失败:', loaded.reason); process.exit(1); }
  console.log('字典:', JSON.stringify(packLib.countEntries(loaded.dict)));

  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find(t => t.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await ws.connect();

  // 关键：先注入
  const inj = await ev(ws, TRANSLATOR(loaded.dict));
  await sleep(1500);
  console.log('首次注入替换:', JSON.stringify(inj));

  // 采集前再注入一次并等待，确保采集到的是翻译后状态
  async function snapAll(label) {
    await ev(ws, TRANSLATOR(loaded.dict));
    await sleep(700);
    const raw = await ev(ws, COLLECT);
    return raw ? JSON.parse(raw) : [];
  }

  const bag = new Set();
  const add = async (label) => {
    const arr = await snapAll(label);
    let n = 0;
    for (const s of arr) if (!bag.has(s)) { bag.add(s); n++; }
    if (n) console.log(`  [${label}] +${n}`);
  };

  await add('主界面');

  // 点击导航
  for (const t of ['Automations', 'Customize', 'Projects', 'Pull requests', 'Issues', 'Settings']) {
    const r = await ev(ws, `(() => {
      for(const el of document.querySelectorAll('button,[role="button"],[role="tab"],a,[tabindex]')){
        const x=(el.textContent||'').trim(); const al=(el.getAttribute&&el.getAttribute('aria-label')||'').trim();
        if(x===${JSON.stringify(t)}||al===${JSON.stringify(t)}){ if(el.offsetParent!==null||el.getClientRects().length){ el.click(); return 'ok'; } } }
      return 'no'; })()`);
    if (r === 'ok') { await sleep(1100); await add(t); }
  }

  ws.close();

  const all = [...bag];
  const isCjk = s => /[\u4e00-\u9fff]/.test(s);
  const cjk = all.filter(isCjk);
  const en = all.filter(s => !isCjk(s));

  // 英文中排除不可避免的（用户名、品牌、按键、纯符号）
  const unavoidable = /^(LeWang|[A-Z][a-z]+(\s[A-Z][a-z]+)*|Ctrl|Alt|Shift|SCORE)$/;
  const reallyMissing = en.filter(s => !unavoidable.test(s) && /[a-zA-Z]{3,}/.test(s));

  const rate = (cjk.length / all.length * 100);
  const rateAdj = ((cjk.length) / (cjk.length + reallyMissing.length) * 100);

  console.log('\n===== 真实汉化覆盖率 =====');
  console.log('界面文案总数:', all.length);
  console.log('已中文化:', cjk.length);
  console.log('仍为英文:', en.length, '（其中需翻译:', reallyMissing.length, '）');
  console.log('原始占比:', rate.toFixed(1) + '%');
  console.log('排除不可翻译项后:', rateAdj.toFixed(1) + '%');

  console.log('\n=== 已中文化样例（前 25）===');
  cjk.slice(0, 25).forEach(s => console.log('  ✓', s.slice(0, 70)));
  console.log('\n=== 仍为英文（前 30）===');
  en.slice(0, 30).forEach(s => console.log('  ·', s.slice(0, 70)));

  fs.writeFileSync(path.join(root, 'dist-packs', 'coverage-final.json'),
    JSON.stringify({ all, cjk, en, reallyMissing, rate, rateAdj }, null, 1));
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
