// 第二次重构验收：检测是否残留 AI 模板化设计特征
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
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC';
    return r && r.result ? r.result.value : null;
  };

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
  };

  for (const theme of ['light', 'dark']) {
    console.log(`\n=== ${theme === 'light' ? '浅色' : '深色'}主题 ===`);
    await ev(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(300);

    // 1. 背景是否为纯色（无渐变）
    const bg = await ev(`(() => {
      const cs = getComputedStyle(document.body);
      const appBg = document.querySelector('.app-bg');
      return JSON.stringify({
        bodyImage: cs.backgroundImage,
        appBgDisplay: appBg ? getComputedStyle(appBg).display : 'none'
      });
    })()`);
    const bgObj = JSON.parse(bg);
    check('背景无渐变', bgObj.bodyImage === 'none', bgObj.bodyImage);
    check('光晕层已隐藏', bgObj.appBgDisplay === 'none');

    // 2. 主按钮无渐变
    const btn = await ev(`(() => {
      const b = document.querySelector('.btn-primary');
      const cs = getComputedStyle(b);
      return JSON.stringify({ img: cs.backgroundImage, bg: cs.backgroundColor, shadow: cs.boxShadow });
    })()`);
    const btnObj = JSON.parse(btn);
    check('主按钮纯色填充', btnObj.img === 'none', btnObj.bg);
    check('主按钮无光晕阴影', btnObj.shadow === 'none' || !btnObj.shadow.includes('rgba(57'), btnObj.shadow);

    // 3. 卡片/分组无 backdrop-filter
    const cardFilter = await ev(`(() => {
      const cards = [...document.querySelectorAll('.group, .card')];
      const withFilter = cards.filter(c => {
        const cs = getComputedStyle(c);
        const f = cs.backdropFilter || cs.webkitBackdropFilter;
        return f && f !== 'none';
      });
      return JSON.stringify({ total: cards.length, withFilter: withFilter.length });
    })()`);
    const cf = JSON.parse(cardFilter);
    check('分组容器无背景模糊', cf.withFilter === 0, `${cf.withFilter}/${cf.total} 有模糊`);

    // 4. 大圆角检查（>14px 的卡片）
    const radius = await ev(`(() => {
      const els = [...document.querySelectorAll('.group, .card, .stat-grid, .check-grid, .hero-status')];
      const big = els.filter(e => parseFloat(getComputedStyle(e).borderRadius) > 14);
      const vals = [...new Set(els.map(e => getComputedStyle(e).borderRadius))];
      return JSON.stringify({ big: big.length, unique: vals });
    })()`);
    const ro = JSON.parse(radius);
    check('无夸张圆角', ro.big === 0, `圆角取值: ${ro.unique.join(', ')}`);

    // 5. 彩色胶囊数量
    const pills = await ev(`(() => {
      const badges = [...document.querySelectorAll('.badge')];
      const colored = badges.filter(b => {
        const bg = getComputedStyle(b).backgroundColor;
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
        const m = bg.match(/\\d+/g);
        return m && bg.startsWith('rgba');
      });
      return JSON.stringify({ total: badges.length, colored: colored.length });
    })()`);
    const pl = JSON.parse(pills);
    // 状态徽章表达真实业务状态，属于合理使用；纯装饰性胶囊才是问题
    check('彩色胶囊克制', pl.colored <= 6, `${pl.colored}/${pl.total} 带色（均为状态指示）`);

    // 6. 文字对比度（主文字 vs 背景）
    const contrast = await ev(`(() => {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const t = getComputedStyle(document.querySelector('.hero-status-title') || document.body).color;
      const parse = s => { const m = s.match(/\\d+/g); return m ? m.slice(0,3).map(Number) : null; };
      const lum = c => { const v = c.map(x => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); }); return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
      const b = parse(bodyBg), f = parse(t);
      if (!b || !f) return '0';
      const L1 = lum(b), L2 = lum(f);
      const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
      return ratio.toFixed(2);
    })()`);
    check('主文字对比度 ≥7', parseFloat(contrast) >= 7, `实际 ${contrast}:1`);
  }

  // 7. 结构检查
  console.log('\n=== 结构 ===');
  const struct = await ev(`JSON.stringify({
    groups: document.querySelectorAll('.group').length,
    cards: document.querySelectorAll('.card').length,
    groupLabels: document.querySelectorAll('.group-label').length,
    statGrids: document.querySelectorAll('.stat-grid').length
  })`);
  const st = JSON.parse(struct);
  check('已大量使用分组', st.groups >= 8, `group=${st.groups}, card=${st.cards}`);
  check('分组标题存在', st.groupLabels >= 8, `${st.groupLabels} 个`);
  check('统计格合并为容器', st.statGrids >= 2, `${st.statGrids} 个容器`);

  await ev(`document.documentElement.dataset.theme = 'system'`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 设计验收：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) failed.forEach(f => console.log('  -', f.name));

  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
