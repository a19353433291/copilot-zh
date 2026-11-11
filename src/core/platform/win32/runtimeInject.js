// 模式 A 引擎：运行时注入（CDP）
// 不改应用本体。通过 WebView2 调试端口连接页面，把翻译注入到 DOM。
//
// 已验证的关键事实（Windows / Copilot v1.2.0）：
//  - 环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 会被应用自带的参数覆盖，无效。
//  - HKCU 注册表策略无效。
//  - 必须写 HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments
//    的 <exe名> 值（需要管理员权限）。

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { I18nEngine } = require('../engine');

const POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const DEFAULT_PORT = 9222;

// ---------------------------------------------------------------------------
// 注册表策略读写（需要管理员）
// ---------------------------------------------------------------------------

function isElevated() {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', timeout: 8000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

function readPolicy(exeName) {
  try {
    const out = execFileSync('reg', ['query', POLICY_KEY, '/v', exeName],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const m = out.match(/REG_SZ\s+(.*)/);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

function writePolicy(exeName, value) {
  if (!isElevated()) {
    return { ok: false, reason: '需要管理员权限才能写入调试端口策略' };
  }
  try {
    execFileSync('reg', ['add', POLICY_KEY, '/v', exeName, '/t', 'REG_SZ', '/d', value, '/f'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: '写入注册表失败: ' + e.message };
  }
}

function removePolicy(exeName) {
  if (!isElevated()) return { ok: false, reason: '需要管理员权限' };
  const cleaned = [];
  try {
    // 1. 删除 github.exe 这条值
    execFileSync('reg', ['delete', POLICY_KEY, '/v', exeName, '/f'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    cleaned.push('已删除策略值 ' + exeName);
  } catch (e) {
    // 值不存在也视为成功
  }

  // 2. 若 AdditionalBrowserArguments 键下已无任何值，删除该空键
  try {
    const out = execFileSync('reg', ['query', POLICY_KEY],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const valNames = [];
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/^\s{2,}(\S+)\s+REG_/);
      if (m) valNames.push(m[1]);
    }
    if (valNames.length === 0) {
      execFileSync('reg', ['delete', POLICY_KEY, '/f'],
        { encoding: 'utf8', timeout: 10000, windowsHide: true });
      cleaned.push('已删除空的 AdditionalBrowserArguments 键');

      // 3. 再检查父键 WebView2 是否也为空
      const parentKey = POLICY_KEY.replace(/\\AdditionalBrowserArguments$/, '');
      const pOut = execFileSync('reg', ['query', parentKey],
        { encoding: 'utf8', timeout: 10000, windowsHide: true });
      const pLines = String(pOut).split(/\r?\n/).filter(l => l.trim());
      // 只有键头一行说明该键下无值无子键
      if (pLines.length <= 1) {
        execFileSync('reg', ['delete', parentKey, '/f'],
          { encoding: 'utf8', timeout: 10000, windowsHide: true });
        cleaned.push('已删除空的 WebView2 策略键');
      }
    }
  } catch (e) {
    // 键已不存在，无需处理
  }

  return { ok: true, cleaned };
}

// ---------------------------------------------------------------------------
// CDP 客户端（极简 WebSocket，无第三方依赖）
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const net = require('net');

function httpGetJson(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('响应非 JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('连接超时')); });
    req.on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.url = new URL(wsUrl);
    this.buf = Buffer.alloc(0);
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(Number(this.url.port), this.url.hostname, () => {
        sock.write([
          `GET ${this.url.pathname} HTTP/1.1`,
          `Host: ${this.url.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '', '',
        ].join('\r\n'));
      });
      this.sock = sock;
      let handshook = false;

      sock.on('data', d => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!handshook) {
          const i = this.buf.indexOf('\r\n\r\n');
          if (i === -1) return;
          const head = this.buf.subarray(0, i).toString();
          if (!head.includes('101')) {
            reject(new Error('WebSocket 握手失败: ' + head.split('\r\n')[0]));
            return;
          }
          handshook = true;
          this.buf = this.buf.subarray(i + 4);
          resolve();
        }
        this._drain();
      });
      sock.on('error', e => { this.closed = true; reject(e); });
      sock.on('close', () => { this.closed = true; });
      setTimeout(() => { if (!handshook) reject(new Error('CDP 连接超时')); }, 8000);
    });
  }

  _drain() {
    while (true) {
      if (this.buf.length < 2) return;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); off = 10;
      }
      if (this.buf.length < off + len) return;
      const text = this.buf.subarray(off, off + len).toString('utf8');
      this.buf = this.buf.subarray(off + len);
      let msg;
      try { msg = JSON.parse(text); } catch (e) { continue; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'CDP 错误'));
        else resolve(msg.result);
      }
    }
  }

  send(method, params) {
    if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'));
    const id = ++this.nextId;
    const data = Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8');
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    this.sock.write(Buffer.concat([header, mask, masked]));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 调用超时: ${method}`));
        }
      }, 20000);
    });
  }

  close() {
    this.closed = true;
    try { this.sock.destroy(); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// 页面内翻译脚本：在页面上下文中执行
// ---------------------------------------------------------------------------

/**
 * 生成注入到页面的翻译器源码。
 * 设计要点：
 *  - 只替换匹配字典的文本，绝不臆测翻译
 *  - 跳过代码块、输入框、可编辑区，避免破坏用户内容
 *  - 用 MutationObserver 跟踪 React 重渲染
 */
function buildTranslatorSource(dict) {
  return `(() => {
  const DICT = ${JSON.stringify(dict)};
  const texts = DICT.entries.texts || {};
  const attrs = DICT.entries.attrs || {};
  const patterns = (DICT.entries.patterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);
  const attrPatterns = (DICT.entries.attrPatterns || []).map(p => [new RegExp(p[0], p[2] || ''), p[1]]);

  if (window.__copilotZh) {
    window.__copilotZh.dict = DICT;
    try { window.__copilotZh.apply(); } catch (e) {}
    return window.__copilotZh.stats();
  }

  const SKIP = 'pre, code, script, style, textarea, [contenteditable="true"], [contenteditable=""]';
  let replaced = 0;
  let lastRun = 0;

  function shouldSkip(el) {
    if (!el) return true;
    try { return !!el.closest(SKIP); } catch (e) { return false; }
  }

  // ---------------------------------------------------------------------
  // 日期时间本地化
  // 目标：把 "November 11, 2026, at 10:21 PM" 变成 "2026年11月11日 22:21"
  // 字典只能做文本替换、无法计算，所以日期必须在运行时处理。
  // ---------------------------------------------------------------------
  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };

  /** 把 12 小时制转 24 小时制，输出 HH:mm */
  function to24h(h, m, ampm) {
    let hh = parseInt(h, 10);
    const mm = String(m).padStart(2, '0');
    if (ampm) {
      const up = ampm.toUpperCase();
      if (up === 'PM' && hh < 12) hh += 12;
      if (up === 'AM' && hh === 12) hh = 0;
    }
    return String(hh).padStart(2, '0') + ':' + mm;
  }

  /**
   * 尝试把一段文本中的英文日期时间替换为中文习惯格式。
   * 支持：
   *   November 11, 2026, at 10:21 PM  → 2026年11月11日 22:21
   *   November 11, 2026               → 2026年11月11日
   *   10:21 PM                        → 22:21
   * @returns {string|null} 转换后的文本，无匹配返回 null
   */
  function localizeDateTime(s) {
    let out = s;
    let changed = false;

    // 1) 完整日期 + 时间
    out = out.replace(
      /([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),\\s*(\\d{4}),?\\s*(?:at\\s*)?(\\d{1,2}):(\\d{2})\\s*([AP]M)?/gi,
      (m, mon, day, year, hh, mi, ap) => {
        const n = MONTHS[String(mon).toLowerCase()];
        if (!n) return m;
        changed = true;
        return year + '年' + n + '月' + parseInt(day, 10) + '日 ' + to24h(hh, mi, ap);
      }
    );

    // 2) 只有日期
    out = out.replace(
      /([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),\\s*(\\d{4})/g,
      (m, mon, day, year) => {
        const n = MONTHS[String(mon).toLowerCase()];
        if (!n) return m;
        changed = true;
        return year + '年' + n + '月' + parseInt(day, 10) + '日';
      }
    );

    // 3) 只有时间（AM/PM）
    out = out.replace(
      /\\b(\\d{1,2}):(\\d{2})\\s*([AP]M)\\b/gi,
      (m, hh, mi, ap) => {
        changed = true;
        return to24h(hh, mi, ap);
      }
    );

    return changed ? out : null;
  }

  function translateText(node) {
    const raw = node.nodeValue;
    if (!raw) return;
    const t = raw.trim();
    if (!t || t.length < 2 || t.length > 500) return;
    if (shouldSkip(node.parentElement)) return;

    if (texts[t] !== undefined) {
      if (raw !== texts[t]) {
        const lead = raw.match(/^\\s*/)[0];
        const trail = raw.match(/\\s*$/)[0];
        node.nodeValue = lead + texts[t] + trail;
        replaced++;
      }
      return;
    }
    for (let i = 0; i < patterns.length; i++) {
      const [re, rep] = patterns[i];
      if (re.test(t)) {
        const v = t.replace(re, rep);
        if (v !== t) {
          // 正则替换后再做日期本地化（例如 "上次检查：November 11, 2026, at 10:21 PM"）
          const localized = localizeDateTime(v);
          node.nodeValue = raw.replace(t, localized || v);
          replaced++;
        }
        return;
      }
    }
    // 兜底：整段都是英文日期时间
    const loc = localizeDateTime(t);
    if (loc) {
      node.nodeValue = raw.replace(t, loc);
      replaced++;
    }
  }

  function translateAttrs(el) {
    for (const name of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute && el.getAttribute(name);
      if (!v) continue;

      // 1) attrs 精确匹配
      if (attrs[v] !== undefined) { el.setAttribute(name, attrs[v]); replaced++; continue; }

      // 2) 回退到 texts 精确匹配
      //    很多 aria-label 与可见文案完全一样（如 "Send message"），
      //    若只在 attrs 里找会漏掉；这里共享同一份精确词典。
      if (texts[v] !== undefined) { el.setAttribute(name, texts[v]); replaced++; continue; }

      // 3) 属性专用正则
      let hit = false;
      for (let i = 0; i < attrPatterns.length; i++) {
        const [re, rep] = attrPatterns[i];
        if (re.test(v)) {
          let nv = v.replace(re, rep);
          const loc = localizeDateTime(nv);
          el.setAttribute(name, loc || nv);
          replaced++;
          hit = true;
          break;
        }
      }
      if (hit) continue;

      // 4) 通用文本正则（属性里也可能出现动态文案）
      for (let i = 0; i < patterns.length; i++) {
        const [re, rep] = patterns[i];
        if (re.test(v)) {
          const nv = v.replace(re, rep);
          if (nv !== v) {
            const loc = localizeDateTime(nv);
            el.setAttribute(name, loc || nv);
            replaced++;
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;

      // 5) 属性里含日期
      const loc2 = localizeDateTime(v);
      if (loc2) { el.setAttribute(name, loc2); replaced++; }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.tagName && /^(SCRIPT|STYLE|CODE|PRE)$/.test(root.tagName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) translateText(n);
    if (root.querySelectorAll) {
      root.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(translateAttrs);
    }
  }

  function apply() {
    const before = replaced;
    walk(document.body || document.documentElement);
    lastRun = Date.now();
    return replaced - before;
  }

  // ---------------------------------------------------------------------
  // 持续补偿：
  // React 应用会分批渲染，首次 apply 时很多元素（尤其是 aria-label 属性）
  // 尚未挂载，MutationObserver 也可能因防抖而错过。
  // 因此保留一个低频定时器做兜底扫描，直到连续多次无新增为止。
  // ---------------------------------------------------------------------
  let idleRounds = 0;
  let sweepTimer = null;

  function sweep() {
    if (!window.__copilotZh || !window.__copilotZh.running) return;
    const n = apply();
    if (n > 0) {
      idleRounds = 0;
    } else {
      idleRounds++;
      // 连续 20 次（约 10 秒）无新增，降到低频巡检
      if (idleRounds === 20) {
        clearInterval(sweepTimer);
        sweepTimer = setInterval(sweep, 3000);
      }
    }
  }

  const observer = new MutationObserver(muts => {
    // 防抖：React 频繁重渲染时避免卡顿
    if (Date.now() - lastRun < 120) return;
    for (const m of muts) {
      if (m.type === 'characterData') translateText(m.target);
      else if (m.type === 'attributes' && m.target && m.target.getAttribute) {
        translateAttrs(m.target);
      } else {
        for (const n of m.addedNodes) walk(n);
      }
    }
    lastRun = Date.now();
  });

  function boot() {
    apply();
    try {
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'],
      });
    } catch (e) {}
    // 密集扫描：每 500ms 补偿一次，覆盖 React 分批渲染的窗口
    sweepTimer = setInterval(sweep, 500);
    document.documentElement.lang = 'zh-CN';
    if (document.title === 'GitHub Copilot') document.title = 'GitHub Copilot（中文）';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.__copilotZh = {
    dict: DICT,
    apply,
    running: true,
    stop() {
      this.running = false;
      try { observer.disconnect(); } catch (e) {}
      if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    },
    stats() { return { replaced, running: this.running }; },
  };
  return { replaced, running: true };
})();`;
}

// ---------------------------------------------------------------------------
// 引擎实现
// ---------------------------------------------------------------------------

class RuntimeInjectEngine extends I18nEngine {
  get id() { return 'runtime-inject'; }
  get displayName() { return '模式 A：运行时注入'; }

  capabilities() {
    return {
      modifiesApp: false,
      breaksSignature: false,
      survivesUpgrade: true,
      needsResidentProcess: true,
      needsDebugPort: true,
      dictUpdateLive: true,
      revertible: true,
    };
  }

  async probe(target) {
    const details = {};
    details.elevated = isElevated();
    details.port = DEFAULT_PORT;
    details.existingPolicy = readPolicy(path.basename(target.exePath));

    if (!fs.existsSync(target.exePath)) {
      return { ok: false, reason: '目标程序不存在', details };
    }
    if (!details.elevated) {
      return {
        ok: false,
        reason: '模式 A 需要管理员权限：要写入 WebView2 调试端口策略',
        details,
      };
    }
    return { ok: true, details };
  }

  /**
   * 应用汉化。
   *
   * @param {object} target { exePath, version }
   * @param {object} dict   字典
   * @param {object} opts
   *   - onProgress(pct, msg)
   *   - requirePolicy: 是否强制写策略（默认 true）。
   *       常驻监控场景传 false：策略已由用户首次「执行汉化」写入，
   *       若每次都写会频繁触发 UAC / 反复改动注册表。
   *   - ensurePolicy: 若策略缺失则补写（默认 true）
   */
  async apply(target, dict, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const requirePolicy = opts.requirePolicy !== false;
    const ensurePolicy = opts.ensurePolicy !== false;
    const exeName = path.basename(target.exePath || 'github.exe');

    onProgress(5, '检查权限…');
    if (requirePolicy) {
      if (!isElevated()) {
        return { ok: false, reason: '需要管理员权限才能开启调试端口' };
      }
      onProgress(15, '配置调试端口…');
      const w = writePolicy(exeName, `--remote-debugging-port=${DEFAULT_PORT}`);
      if (!w.ok) return { ok: false, reason: w.reason };
    } else if (ensurePolicy) {
      // 监控模式：仅在策略缺失时补写，避免无谓改动
      const cur = readPolicy(exeName);
      if (!cur || !String(cur).includes(`--remote-debugging-port=${DEFAULT_PORT}`)) {
        if (!isElevated()) {
          return { ok: false, reason: '调试端口策略缺失，且当前没有管理员权限补写' };
        }
        const w = writePolicy(exeName, `--remote-debugging-port=${DEFAULT_PORT}`);
        if (!w.ok) return { ok: false, reason: w.reason };
      }
    }

    onProgress(30, '连接应用界面…');
    // 等端口就绪（应用需已启动）
    let targets = null;
    const maxWait = opts.maxWaitMs || 10000;
    const steps = Math.ceil(maxWait / 400);
    for (let i = 0; i < steps; i++) {
      try {
        targets = await httpGetJson(DEFAULT_PORT, '/json/list', 2000);
        if (targets && targets.length) break;
      } catch (e) { /* 未就绪 */ }
      await new Promise(r => setTimeout(r, 400));
    }
    if (!targets || !targets.length) {
      return {
        ok: false,
        reason: requirePolicy
          ? '未能连接应用界面。请确认：① GitHub Copilot 已启动 ② 启动后等待数秒 ③ 完全退出后重启一次以加载调试端口策略'
          : '未能连接应用界面（调试端口未就绪）',
      };
    }

    onProgress(50, '注入翻译脚本…');
    const page = targets.find(t => t.type === 'page');
    if (!page) return { ok: false, reason: '未找到应用主页面' };

    const client = new CDPClient(page.webSocketDebuggerUrl);
    try {
      await client.connect();
      const src = buildTranslatorSource(dict);
      const res = await client.send('Runtime.evaluate', {
        expression: src,
        returnByValue: true,
        awaitPromise: false,
      });
      const value = res && res.result && res.result.value;
      onProgress(100, '完成');
      return {
        ok: true,
        stats: { replaced: (value && value.replaced) || 0, port: DEFAULT_PORT, pageUrl: page.url },
      };
    } catch (e) {
      return { ok: false, reason: '注入失败: ' + e.message };
    } finally {
      client.close();
    }
  }

  async revert(target) {
    const exeName = path.basename(target.exePath);
    // 彻底移除调试端口痕迹（含空键清理）
    const r = removePolicy(exeName);
    if (!r.ok) return { ok: false, reason: r.reason };
    return {
      ok: true,
      cleaned: r.cleaned || [],
      reason: '已彻底移除调试端口策略。请重启 GitHub Copilot，界面即恢复英文。',
    };
  }

  async status(target) {
    const exeName = path.basename(target.exePath);
    const policy = readPolicy(exeName);
    let live = false;
    try {
      const t = await httpGetJson(DEFAULT_PORT, '/json/list', 1500);
      live = Array.isArray(t) && t.length > 0;
    } catch (e) { live = false; }
    return {
      state: policy ? 'applied' : 'none',
      info: { policyValue: policy, debugPortLive: live, port: DEFAULT_PORT },
    };
  }
}

// ---------------------------------------------------------------------------
// 供常驻监控使用的轻量查询
// ---------------------------------------------------------------------------

/**
 * 检查页面里的翻译器是否仍然存活。
 * 用于监控器判断「页面是否被重载」，避免无谓的重复注入。
 *
 * @param {number} port
 * @returns {Promise<boolean|null>} true=存活, false=已丢失, null=无法连接
 */
async function queryTranslatorAlive(port = DEFAULT_PORT) {
  let targets;
  try {
    targets = await httpGetJson(port, '/json/list', 2000);
  } catch (e) {
    return null;   // 端口不通
  }
  if (!Array.isArray(targets) || !targets.length) return null;
  const page = targets.find(t => t.type === 'page');
  if (!page) return null;

  const client = new CDPClient(page.webSocketDebuggerUrl);
  try {
    await client.connect();
    const res = await client.send('Runtime.evaluate', {
      expression: 'typeof window.__copilotZh !== "undefined" && !!window.__copilotZh.apply',
      returnByValue: true,
    });
    return res && res.result ? res.result.value === true : false;
  } catch (e) {
    return null;
  } finally {
    client.close();
  }
}

/**
 * 在页面中执行任意表达式（返回字符串结果）。
 * 供 applyFlow 探测界面状态使用。
 *
 * @param {number} port
 * @param {string} expression
 * @returns {Promise<string|null>}
 */
async function evaluateInPage(port, expression) {
  let targets;
  try {
    targets = await httpGetJson(port, '/json/list', 2000);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(targets) || !targets.length) return null;
  const page = targets.find(t => t.type === 'page');
  if (!page) return null;

  const client = new CDPClient(page.webSocketDebuggerUrl);
  try {
    await client.connect();
    const res = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (!res || !res.result) return null;
    const v = res.result.value;
    return v === undefined || v === null ? null : String(v);
  } catch (e) {
    return null;
  } finally {
    client.close();
  }
}

/**
 * 检查调试端口是否可访问（不注入，仅探测）。
 */
async function isPortReady(port = DEFAULT_PORT) {
  try {
    const t = await httpGetJson(port, '/json/list', 2000);
    return Array.isArray(t) && t.length > 0;
  } catch (e) {
    return false;
  }
}

module.exports = {
  RuntimeInjectEngine, DEFAULT_PORT, isElevated, readPolicy, writePolicy, removePolicy,
  queryTranslatorAlive, isPortReady, evaluateInPage,
};
