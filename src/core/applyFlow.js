// 一键汉化编排：把「写策略 → 启动/重启 Copilot → 等端口 → 注入 → 验证」串成一次操作。
//
// 为什么需要这个模块：
//   早期版本把「执行汉化」简单实现成「写策略 + 连端口」。
//   如果 Copilot 已经在运行，它启动时策略还不存在，WebView2 就不会开调试端口，
//   于是必然连接失败——但后台常驻监控稍后可能又注入成功，
//   结果就是「提示失败、界面却是中文」这种自相矛盾的状态。
//
//   现在改为完整闭环：必要时重启 Copilot 让策略生效，最后以「翻译器是否真的存活」
//   作为唯一的成功判据，不再靠异常猜测。

'use strict';

const path = require('path');
const { execFile } = require('child_process');

const cdp = require('./platform/win32/runtimeInject');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 异步执行 taskkill */
function taskkill(imageName) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/IM', imageName, '/T', '/F'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
}

/** 等待调试端口就绪 */
async function waitForPort(timeoutMs, onTick) {
  const step = 400;
  const rounds = Math.ceil(timeoutMs / step);
  for (let i = 0; i < rounds; i++) {
    if (await cdp.isPortReady(cdp.DEFAULT_PORT)) return true;
    if (onTick) onTick(i, rounds);
    await sleep(step);
  }
  return await cdp.isPortReady(cdp.DEFAULT_PORT);
}

/** 等待 Copilot 进程退出 */
async function waitForExit(findPids, timeoutMs = 12000) {
  const step = 300;
  const rounds = Math.ceil(timeoutMs / step);
  for (let i = 0; i < rounds; i++) {
    const pids = await findPids();
    if (!pids.length) return true;
    await sleep(step);
  }
  return false;
}

/**
 * 执行一键汉化。
 *
 * @param {object} ctx
 *   - engine:        注入引擎
 *   - target:        { exePath, version }
 *   - dict:          字典
 *   - launchCopilot: () => Promise<{ok, exePath?, reason?}>   启动 Copilot
 *   - findPids:      () => Promise<number[]>                  查 Copilot 进程
 *   - onProgress:    (pct, msg) => void
 *   - allowRestart:  是否允许自动重启已运行的 Copilot（默认 true）
 *
 * @returns {Promise<{ok, reason?, stats?, actions?: string[], verified?: boolean}>}
 */
async function applyOneClick(ctx) {
  const {
    engine, target, dict,
    launchCopilot, findPids,
    onProgress = () => {},
    allowRestart = true,
  } = ctx;

  const actions = [];

  // ---- 1. 权限检查 ----
  // 必须用异步版本：isElevated 内部同步执行 net session（约 1-2 秒），
  // 会阻塞主进程事件循环，导致界面卡死、CDP 无响应。
  onProgress(5, '检查权限…');
  if (!(await cdp.isElevatedAsync())) {
    return {
      ok: false,
      reason: '需要管理员权限才能开启调试端口。请关闭本程序，右键选择「以管理员身份运行」后重试。',
      code: 'NO_ADMIN',
    };
  }

  // ---- 2. 写入调试端口策略 ----
  onProgress(12, '配置调试端口…');
  const exeName = 'github.exe';
  const expected = `--remote-debugging-port=${cdp.DEFAULT_PORT}`;
  const cur = await cdp.readPolicyAsync(exeName);
  if (!cur || !String(cur).includes(expected)) {
    const w = await cdp.writePolicyAsync(exeName, expected);
    if (!w.ok) {
      return { ok: false, reason: '写入调试端口策略失败：' + (w.reason || '未知原因'), code: 'POLICY_WRITE' };
    }
    actions.push('已开启 WebView2 调试端口');
  }

  // ---- 3. 端口是否已经可用 ----
  let portReady = await cdp.isPortReady(cdp.DEFAULT_PORT);

  if (!portReady) {
    const pids = await findPids();

    // 3a. Copilot 已在运行但没开端口 → 它启动时策略还不存在，必须重启才能让策略生效
    if (pids.length) {
      if (!allowRestart) {
        return {
          ok: false,
          reason: 'GitHub Copilot 正在运行，但启动调试端口需要重启一次。请关闭 Copilot 后重试，或在设置中允许自动重启。',
          code: 'NEED_RESTART',
          actions,
        };
      }
      onProgress(22, '重启 GitHub Copilot 以加载调试端口…');
      await taskkill('github.exe');
      const exited = await waitForExit(findPids);
      actions.push('已重启 GitHub Copilot');
      if (!exited) {
        return {
          ok: false,
          reason: '无法关闭正在运行的 GitHub Copilot。请手动退出后重试。',
          code: 'KILL_FAILED',
          actions,
        };
      }
    }

    // 3b. 启动 Copilot
    onProgress(35, '启动 GitHub Copilot…');
    const l = await launchCopilot();
    if (!l.ok) {
      return { ok: false, reason: '启动 GitHub Copilot 失败：' + (l.reason || '未知原因'), code: 'LAUNCH_FAILED', actions };
    }
    actions.push('已启动 GitHub Copilot');

    // 3c. 等端口
    onProgress(45, '等待应用界面就绪…');
    portReady = await waitForPort(30000);
    if (!portReady) {
      return {
        ok: false,
        reason: 'GitHub Copilot 已启动，但调试端口未在 30 秒内就绪。可能是系统策略未生效，请重启电脑后重试。',
        code: 'PORT_TIMEOUT',
        actions,
      };
    }
  }

  // ---- 4. 等待页面真正就绪 ----
  // 关键：应用刚启动时 WebView 会先渲染一个骨架/加载页，
  // 之后 React 才挂载真实界面。若在骨架阶段注入，翻译会随骨架被整体替换而丢失。
  // 因此必须等到页面出现「真实界面特征」再注入。
  onProgress(60, '等待界面加载完成…');
  const ready = await waitForRealUI(cdp.DEFAULT_PORT, 25000);
  if (!ready) {
    // 即使未确认就绪也继续尝试注入，但会在最后如实报告验证结果
    actions.push('界面加载较慢，已尝试提前注入');
  }

  // ---- 5. 注入 ----
  onProgress(70, '注入中文界面…');
  let applied;
  try {
    applied = await engine.apply(
      target,
      dict,
      { onProgress: (p, m) => onProgress(70 + Math.round(p * 0.15), m), requirePolicy: false, maxWaitMs: 8000 }
    );
  } catch (e) {
    return { ok: false, reason: '注入失败：' + e.message, code: 'APPLY_ERROR', actions };
  }
  if (!applied.ok) {
    return { ok: false, reason: applied.reason || '注入失败', code: 'APPLY_FAILED', actions };
  }

  // ---- 6. 验证 + 必要时补注入 ----
  // 页面若在注入后继续渲染，翻译会丢。这里做多次校验，丢失则重注入。
  onProgress(88, '验证汉化结果…');
  let verified = false;
  let totalReplaced = (applied.stats && applied.stats.replaced) || 0;

  for (let attempt = 0; attempt < 6; attempt++) {
    verified = (await cdp.queryTranslatorAlive(cdp.DEFAULT_PORT)) === true;
    if (verified) {
      // 再确认页面上确实出现了中文，而不只是脚本存在
      const cjk = await countCjkInPage(cdp.DEFAULT_PORT);
      if (cjk > 0) { verified = true; break; }
      verified = false;
    }
    // 还没生效：等待后重试注入
    await sleep(1200);
    try {
      const again = await engine.apply(
        target, dict,
        { onProgress: () => {}, requirePolicy: false, maxWaitMs: 5000 }
      );
      if (again.ok && again.stats) totalReplaced = Math.max(totalReplaced, again.stats.replaced || 0);
    } catch (e) { /* 忽略，继续重试 */ }
  }

  onProgress(100, verified ? '完成' : '注入未确认');
  if (!verified) {
    return {
      ok: false,
      code: 'NOT_VERIFIED',
      reason: '脚本已注入，但页面尚未显示中文（可能仍在加载）。\n请稍等几秒后点击「立即汉化」；由于已开启常驻监控，通常会自动完成。',
      actions,
    };
  }

  actions.push('已注入中文界面');
  return {
    ok: true,
    verified: true,
    actions,
    stats: { replaced: totalReplaced, port: cdp.DEFAULT_PORT },
  };
}

/**
 * 判断页面是否已渲染出真实界面（而非启动骨架）。
 *
 * 依据：真实界面里会出现侧边栏 + 多个导航项，骨架页只有一两个文本节点。
 * 这是避免「注入被骨架替换掉」的关键判断。
 *
 * @param {number} port
 * @returns {Promise<{ready: boolean, texts: number, hasSidebar: boolean}>}
 */
async function probeRealUI(port) {
  const r = await cdp.evaluateInPage(port, `(() => {
    const body = document.body;
    if (!body) return JSON.stringify({ texts: 0, hasSidebar: false });
    const s = new Set();
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const t = (n.nodeValue || '').trim(); if (t) s.add(t); }
    // 真实界面特征：出现侧边栏导航项
    const hasSidebar = !!document.querySelector('nav, [role="navigation"], aside, [class*="sidebar"]');
    return JSON.stringify({ texts: s.size, hasSidebar });
  })()`);
  if (!r) return { ready: false, texts: 0, hasSidebar: false };
  try {
    const d = JSON.parse(r);
    return { ready: d.texts >= 8 || d.hasSidebar, texts: d.texts, hasSidebar: d.hasSidebar };
  } catch (e) {
    return { ready: false, texts: 0, hasSidebar: false };
  }
}

/**
 * 等待界面真正就绪。
 * @param {number} port
 * @param {number} timeoutMs
 */
async function waitForRealUI(port, timeoutMs) {
  const step = 500;
  const rounds = Math.ceil(timeoutMs / step);
  let stable = 0;
  for (let i = 0; i < rounds; i++) {
    const p = await probeRealUI(port);
    if (p.ready) {
      // 连续两次就绪才算稳定，避免刚好卡在渲染中间态
      stable++;
      if (stable >= 2) return true;
    } else {
      stable = 0;
    }
    await sleep(step);
  }
  return false;
}

/** 统计页面中已出现的中文文本条数 */
async function countCjkInPage(port) {
  const r = await cdp.evaluateInPage(port, `(() => {
    const s = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (t && /[\\u4e00-\\u9fff]/.test(t)) s.add(t);
    }
    return String(s.size);
  })()`);
  const n = parseInt(r, 10);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { applyOneClick, waitForPort, waitForRealUI, probeRealUI, countCjkInPage, taskkill, sleep };
