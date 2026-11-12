// 诊断渲染进程崩溃原因
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const PORT = 9333;

function httpGet(p) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    });
    req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
    req.on('error', rej);
  });
}

(async () => {
  console.log('=== 1. CDP targets ===');
  let list;
  try {
    list = JSON.parse(await httpGet('/json/list'));
    console.log('  targets:', list.length);
    list.forEach(t => console.log(`    [${t.type}] ${t.title} — ${t.url}`));
  } catch (e) {
    console.log('  无法获取 targets:', e.message);
    process.exit(1);
  }

  const page = list.find(t => t.type === 'page');
  if (!page) { console.log('  无 page target'); process.exit(1); }

  console.log('\n=== 2. 连接页面并读取错误 ===');
  const url = new URL(page.webSocketDebuggerUrl);
  const key = crypto.randomBytes(16).toString('base64');

  const sock = net.connect(Number(url.port), url.hostname, () => {
    sock.write([`GET ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, 'Upgrade: websocket',
      'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'));
  });

  let buf = Buffer.alloc(0);
  let hs = false;
  let id = 0;
  const pending = new Map();

  function send(method, params) {
    const mid = ++id;
    const data = Buffer.from(JSON.stringify({ id: mid, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let h;
    if (data.length < 126) h = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(data.length), 2); }
    sock.write(Buffer.concat([h, mask, masked]));
    return new Promise((res, rej) => {
      pending.set(mid, { resolve: res, reject: rej });
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 8000);
    });
  }

  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    if (!hs) {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      hs = true;
      buf = buf.subarray(i + 4);
    }
    while (true) {
      if (buf.length < 2) return;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const text = buf.subarray(off, off + len).toString('utf8');
      buf = buf.subarray(off + len);
      try {
        const m = JSON.parse(text);
        if (m.id && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        }
      } catch (e) {}
    }
  });

  sock.on('error', e => console.log('  socket error:', e.message));

  await new Promise(r => setTimeout(r, 600));

  // 读取页面基本信息
  try {
    const r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        url: location.href,
        title: document.title,
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        readyState: document.readyState,
        hasApi: typeof window.api,
        hasTheme: typeof window.ThemeController,
        hasIcons: typeof window.icon,
        hasSegmented: typeof window.Segmented,
        bodyPreview: document.body ? document.body.innerHTML.slice(0, 300) : ''
      })`,
      returnByValue: true,
    });
    console.log('  页面状态:', r.result.value);
  } catch (e) {
    console.log('  evaluate 失败:', e.message);
  }

  // 收集控制台错误
  console.log('\n=== 3. 重新加载页面并捕获错误 ===');
  await send('Runtime.enable', {}).catch(() => {});
  await send('Log.enable', {}).catch(() => {});

  const errors = [];
  sock.on('data', d => {
    // 简化：重新解析一次（上面已有解析器，这里只追加错误收集）
  });

  try {
    await send('Page.enable', {});
    await send('Page.reload', {});
    await new Promise(r => setTimeout(r, 3000));

    const r2 = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        hasApi: typeof window.api,
        errCount: (window.__errs || []).length
      })`,
      returnByValue: true,
    });
    console.log('  重载后:', r2.result.value);
  } catch (e) {
    console.log('  重载失败:', e.message);
  }

  sock.destroy();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
