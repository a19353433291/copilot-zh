// 渲染进程逻辑：分页导航、自定义控件、一键汉化。
'use strict';

const $ = id => document.getElementById(id);

const state = {
  env: null,
  sys: null,             // { elevated, ... }
  target: null,
  engines: [],
  selectedEngine: null,
  pack: null,
  busy: false,
  settings: null,
  watcher: null,
  page: 'home',
};

const PAGE_TITLES = {
  home: '概览',
  translate: '汉化',
  dict: '字典包',
  cleanup: '清理',
  settings: '设置',
};

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function setStatus(text) {
  const el = $('status-text');
  if (el) el.textContent = text;
}

function showResult(kind, text) {
  const el = $('result');
  el.hidden = false;
  el.className = 'alert ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'info');
  el.textContent = text;
  // 结果总是在概览页展示，自动切过去
  if (state.page !== 'home') switchPage('home');
}
function clearResult() { $('result').hidden = true; }

function setProgress(pct, msg) {
  const wrap = $('progress-wrap');
  if (!wrap) return;
  wrap.hidden = false;
  $('progress-fill').style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (msg) $('progress-text').textContent = msg;
}
function hideProgress() {
  const w = $('progress-wrap');
  if (w) { w.hidden = true; $('progress-fill').style.width = '0%'; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function canApply() {
  return !!(state.target && state.selectedEngine && state.pack);
}

function setBusy(busy, text) {
  state.busy = busy;
  for (const id of ['btn-apply', 'btn-quick-apply', 'btn-revert', 'btn-quick-revert',
                    'btn-locate', 'btn-choose', 'btn-import-pack', 'btn-check-update',
                    'btn-audit', 'btn-cleanall']) {
    const b = $(id);
    if (!b) continue;
    const isApply = (id === 'btn-apply' || id === 'btn-quick-apply');
    b.disabled = busy || (isApply && !canApply());
  }
  if (text) setStatus(text);
}

// ---------------------------------------------------------------------------
// 分页导航
// ---------------------------------------------------------------------------

function switchPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const title = $('page-title');
  if (title) title.textContent = PAGE_TITLES[page] || '';
  const pages = $('pages');
  if (pages) pages.scrollTop = 0;
}

function initNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
  });
}

// ---------------------------------------------------------------------------
// 自定义下拉框
// ---------------------------------------------------------------------------

function initSelect(wrapId, onChange) {
  const wrap = $(wrapId);
  if (!wrap) return;
  const trigger = wrap.querySelector('.select-trigger');
  const menu = wrap.querySelector('.select-menu');
  const label = wrap.querySelector('.select-label');

  const close = () => {
    menu.hidden = true;
    trigger.classList.remove('open');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    // 关闭其它下拉框
    document.querySelectorAll('.select-menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.select-trigger').forEach(t => t.classList.remove('open'));
    if (willOpen) {
      menu.hidden = false;
      trigger.classList.add('open');
    }
  });

  menu.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.dataset.value;
      const text = opt.textContent.trim();
      trigger.dataset.value = val;
      label.textContent = text;
      menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      close();
      if (onChange) onChange(val);
    });
  });

  document.addEventListener('click', close);
  return {
    set(value) {
      const opt = menu.querySelector(`.select-option[data-value="${value}"]`);
      if (!opt) return;
      trigger.dataset.value = value;
      label.textContent = opt.textContent.trim();
      menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    },
    setEnabled(on) { trigger.disabled = !on; },
  };
}

let intervalSelect = null;

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

async function init() {
  initNav();

  state.env = await window.api.env();
  $('brand-version').textContent = 'v' + state.env.appVersion;
  $('status-dir').textContent = state.env.packsDir || '';

  await checkAdmin();

  await Promise.all([locateTarget(), loadEngines(), loadPack()]);
  await loadSettings();
  await refreshAudit();
  renderApplyState();

  // 默认停在概览页
  switchPage('home');
}

async function checkAdmin() {
  try {
    state.sys = await window.api.sysCheck();
  } catch (e) {
    state.sys = { elevated: false };
  }
  const hint = $('admin-hint');
  const btn = $('btn-elevate');
  if (state.sys && state.sys.elevated) {
    hint.hidden = true;
    btn.hidden = true;
  } else {
    hint.hidden = false;
    btn.hidden = false;
  }
}

$('btn-elevate').addEventListener('click', async () => {
  await window.api.relaunchAsAdmin();
});

// ---------------------------------------------------------------------------
// 常驻监控状态
// ---------------------------------------------------------------------------

function renderWatcher(st) {
  state.watcher = st;
  const dot = $('home-dot');
  const title = $('home-title');
  const sub = $('home-sub');
  const pill = $('badge-watcher');
  const btnInject = $('btn-inject-now');
  const btnLaunch = $('btn-launch-copilot');
  if (!st) return;

  dot.className = 'status-dot';
  sub.textContent = '';
  btnInject.hidden = true;
  btnLaunch.hidden = true;

  if (!st.enabled) {
    title.textContent = '常驻监控已关闭';
    sub.textContent = '可在设置中开启「常驻监控自动汉化」';
    pill.className = 'pill';
    pill.textContent = '已关闭';
    return;
  }
  if (!st.copilotRunning) {
    dot.classList.add('ok');
    title.textContent = '监控运行中';
    sub.textContent = '等待 GitHub Copilot 启动，启动后将自动汉化';
    pill.className = 'pill ok';
    pill.textContent = '运行中';
    btnLaunch.hidden = false;
    return;
  }
  if (st.injected) {
    dot.classList.add('ok');
    const t = st.lastInjectAt
      ? new Date(st.lastInjectAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    title.textContent = '界面已汉化';
    sub.textContent = `Copilot 运行中${t ? ' · 汉化于 ' + t : ''}`;
    pill.className = 'pill ok';
    pill.textContent = '已汉化';
  } else {
    dot.classList.add(st.lastError ? 'err' : 'wait');
    title.textContent = st.lastError ? '注入未成功' : '正在注入…';
    sub.textContent = st.lastError || '检测到 Copilot 运行中，即将完成汉化';
    pill.className = 'pill ' + (st.lastError ? 'err' : 'warn');
    pill.textContent = st.lastError ? '需处理' : '注入中';
  }
  btnInject.hidden = false;
}

$('btn-inject-now').addEventListener('click', async () => {
  setStatus('正在注入…');
  const r = await window.api.injectNow();
  if (r.ok) setStatus('已注入');
  else showResult('err', '注入失败：' + (r.reason || '未知原因'));
});

$('btn-launch-copilot').addEventListener('click', async () => {
  const r = await window.api.launchCopilot();
  if (!r.ok) showResult('err', '启动 Copilot 失败：' + (r.reason || '未知原因'));
  else setStatus('已启动 GitHub Copilot，稍候将自动汉化');
});

// ---------------------------------------------------------------------------
// 目标应用
// ---------------------------------------------------------------------------

async function locateTarget() {
  const box = $('target-info');
  box.className = 'row-value dim';
  box.textContent = '正在检测…';
  const r = await window.api.locateApp();
  if (!r.ok) {
    state.target = null;
    box.className = 'row-value';
    box.innerHTML = '<span class="warn-text">未自动找到，请手动选择</span>';
    $('target-path').textContent = '';
    updateStats();
    renderApplyState();
    return;
  }
  state.target = { exePath: r.exePath, version: r.version, signature: r.signature };
  renderTarget();
  updateStats();
  renderApplyState();
}

function renderTarget() {
  const t = state.target;
  const box = $('target-info');
  const pathEl = $('target-path');
  if (!t) {
    box.className = 'row-value dim';
    box.textContent = '未选择目标应用';
    pathEl.textContent = '';
    return;
  }
  box.className = 'row-value';
  const sigOk = t.signature === 'Valid';
  const sigWarn = t.signature === 'HashMismatch';
  const sigSpan = sigOk ? '<span class="inline-ok">签名有效</span>'
    : sigWarn ? '<span class="inline-danger">签名已失效</span>'
      : '<span class="inline-muted">签名未知</span>';
  const name = t.exePath.split('\\').pop();
  box.innerHTML = `${escapeHtml(name)} ${sigSpan}`;
  pathEl.textContent = t.exePath;
}

function updateStats() {
  const t = state.target;
  $('stat-version').textContent = t && t.version ? 'v' + t.version : '—';
  const s = $('stat-sign');
  if (t && t.signature === 'Valid') { s.textContent = '有效'; s.className = 'stat-value ok'; }
  else if (t && t.signature === 'HashMismatch') { s.textContent = '已失效'; s.className = 'stat-value err'; }
  else { s.textContent = '—'; s.className = 'stat-value'; }

  const d = $('stat-dict');
  if (state.pack) {
    d.textContent = (state.pack.counts.texts || 0) + ' 条';
    d.className = 'stat-value';
  } else {
    d.textContent = '无';
    d.className = 'stat-value warn';
  }
}

$('btn-locate').addEventListener('click', async () => {
  setBusy(true, '正在检测…');
  await locateTarget();
  setBusy(false);
});

$('btn-choose').addEventListener('click', async () => {
  const r = await window.api.chooseApp();
  if (!r.ok) return;
  state.target = { exePath: r.exePath, version: r.version, signature: r.signature };
  renderTarget();
  updateStats();
  renderApplyState();
  setStatus('已手动指定应用路径');
});

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

async function loadEngines() {
  state.engines = await window.api.listEngines();
  if (!state.selectedEngine && state.engines.length) {
    state.selectedEngine = state.engines[0].id;
    $('engine-hint').textContent = '需要管理员权限才能开启调试端口。';
  }
  renderEngines();
  renderApplyState();
}

const ENGINE_INFO = {
  'runtime-inject': {
    desc: '通过 WebView2 调试端口把翻译实时注入界面。不修改应用本体。',
    tags: (c) => [
      { t: '不改本体', good: true },
      { t: '签名保持完好', good: true },
      { t: '升级不失效', good: true },
      { t: '字典即时生效', good: true },
      { t: '需管理员权限', bad: true },
    ],
  },
  'binary-patch': {
    desc: '解开应用内嵌资源、替换文案后重新压缩写回。一次生效，无需常驻。',
    tags: () => [
      { t: '修改本体', bad: true },
      { t: '签名会失效', bad: true },
      { t: '每次更新需重打', bad: true },
      { t: '无需常驻进程', good: true },
    ],
  },
};

function renderEngines() {
  const box = $('engine-list');
  if (!state.engines.length) {
    box.innerHTML = '<div class="row-value dim">当前平台没有可用引擎。</div>';
    return;
  }
  box.innerHTML = state.engines.map(e => {
    const meta = ENGINE_INFO[e.id] || { desc: '', tags: () => [] };
    const tags = meta.tags(e.capabilities)
      .map(x => `<span class="tag ${x.good ? 'good' : (x.bad ? 'bad' : '')}">${escapeHtml(x.t)}</span>`)
      .join('');
    const sel = state.selectedEngine === e.id ? ' selected' : '';
    return `<div class="engine-item${sel}" data-engine="${escapeHtml(e.id)}" role="radio" tabindex="0">
      <div class="radio-mark"></div>
      <div class="engine-body">
        <div class="engine-title">${escapeHtml(e.displayName)}</div>
        <div class="engine-desc">${escapeHtml(meta.desc)}</div>
        <div class="engine-tags">${tags}</div>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.engine-item').forEach(el => {
    el.addEventListener('click', () => selectEngine(el.dataset.engine));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectEngine(el.dataset.engine); }
    });
  });
}

function selectEngine(id) {
  state.selectedEngine = id;
  $('engine-hint').textContent = id === 'runtime-inject'
    ? '需要管理员权限才能开启调试端口。' : '';
  renderEngines();
  renderApplyState();
}

// ---------------------------------------------------------------------------
// 字典包
// ---------------------------------------------------------------------------

async function loadPack() {
  const r = await window.api.currentPack();
  const box = $('pack-info');
  const hint = $('pack-hint');
  if (!r.ok) {
    state.pack = null;
    box.className = 'row-value dim';
    box.textContent = '尚未安装字典包';
    hint.textContent = '';
    updateStats();
    renderApplyState();
    return;
  }
  state.pack = r;
  renderPack();
  updateStats();
  renderApplyState();
}

function renderPack() {
  const p = state.pack;
  const box = $('pack-info');
  const hint = $('pack-hint');
  const m = p.meta || {};
  const c = p.counts || {};
  box.className = 'row-value';
  box.innerHTML = `v${escapeHtml(m.packVersion || '?')} ` +
    `<span class="inline-ok">已校验</span>`;
  hint.textContent = `${c.texts || 0} 条文本 · ${c.patterns || 0} 条正则 · ${c.attrs || 0} 条属性`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function loadSettings() {
  const r = await window.api.getSettings();
  state.settings = r.data;

  $('set-launch-after-apply').checked = !!r.data.launchCopilotAfterApply;
  $('set-auto-restart').checked = r.data.autoRestartCopilot !== false;
  $('set-close-on-revert').checked = r.data.closeCopilotOnRevert !== false;
  $('set-auto-inject').checked = !!r.data.autoInjectOnStart;
  $('set-run-at-login').checked = !!r.data.runAtLogin;
  $('set-minimize-tray').checked = !!r.data.minimizeToTray;
  $('settings-datadir').textContent = state.env.userDir || '';

  if (!intervalSelect) {
    intervalSelect = initSelect('sel-interval', (val) => {
      patchSettings({ watchIntervalMs: Number(val) });
    });
  }
  intervalSelect.set(String(r.data.watchIntervalMs));
  intervalSelect.setEnabled(!!r.data.autoInjectOnStart);

  if (!r.autostartSupported) {
    $('set-run-at-login').disabled = true;
    $('autostart-hint').textContent = '当前平台不支持';
  }
  if (r.watcher) renderWatcher(r.watcher);
}

async function patchSettings(patch) {
  const r = await window.api.setSettings(patch);
  if (!r.ok) {
    showResult('err', r.reason || '保存设置失败');
    await loadSettings();
    return;
  }
  state.settings = r.data;
  setStatus('设置已保存');
}

$('set-launch-after-apply').addEventListener('change', (e) =>
  patchSettings({ launchCopilotAfterApply: e.target.checked }));

$('set-auto-restart').addEventListener('change', (e) =>
  patchSettings({ autoRestartCopilot: e.target.checked }));

$('set-close-on-revert').addEventListener('change', (e) =>
  patchSettings({ closeCopilotOnRevert: e.target.checked }));

$('set-auto-inject').addEventListener('change', (e) => {
  if (intervalSelect) intervalSelect.setEnabled(e.target.checked);
  patchSettings({ autoInjectOnStart: e.target.checked });
});

$('set-run-at-login').addEventListener('change', (e) =>
  patchSettings({ runAtLogin: e.target.checked }));

$('set-minimize-tray').addEventListener('change', (e) =>
  patchSettings({ minimizeToTray: e.target.checked }));

$('btn-open-data-2').addEventListener('click', () => window.api.openDataFolder());

$('btn-reset-settings').addEventListener('click', async () => {
  const r = await window.api.resetSettings();
  if (r.ok) { setStatus('已恢复默认设置'); await loadSettings(); }
});

// ---------------------------------------------------------------------------
// 执行汉化
// ---------------------------------------------------------------------------

function renderApplyState() {
  const ok = canApply() && !state.busy;
  for (const id of ['btn-apply', 'btn-quick-apply']) {
    const b = $(id);
    if (b) b.disabled = !ok;
  }
}

async function doApply(btnId) {
  if (!canApply() || state.busy) return;

  // 未提权时直接提示，避免走完流程才在最后失败
  if (state.sys && state.sys.elevated === false) {
    showResult('err',
      '需要管理员权限才能汉化。\n\n请点击右上角「以管理员身份重启」，或关闭程序后右键选择「以管理员身份运行」。');
    return;
  }

  clearResult();
  setBusy(true, '正在汉化…');
  const btn = $(btnId);
  if (btn) btn.classList.add('loading');
  setProgress(0, '准备中…');

  const target = { exePath: state.target.exePath, version: state.target.version };

  const r = await window.api.apply(state.selectedEngine, target, state.pack.dict);

  if (btn) btn.classList.remove('loading');
  setBusy(false, r.ok ? '汉化完成' : '汉化未完成');

  if (r.ok) {
    setProgress(100, '完成');
    const stats = r.stats || {};
    const acts = (r.actions || []).length ? '\n' + r.actions.join('\n') : '';
    showResult('ok',
      `汉化已生效：替换 ${stats.replaced || 0} 处文案${acts}\n\n已切换验证通过，可以正常使用 GitHub Copilot。`);
  } else {
    hideProgress();
    let msg = r.reason || '未知原因';
    if (r.code === 'NO_ADMIN') {
      msg += '\n\n请点击右上角「以管理员身份重启」。';
    }
    showResult('err', msg);
  }
}

$('btn-apply').addEventListener('click', () => doApply('btn-apply'));
$('btn-quick-apply').addEventListener('click', () => doApply('btn-quick-apply'));

async function doRevert() {
  if (!state.target || !state.selectedEngine) {
    showResult('err', '请先选择目标应用与模式。');
    return;
  }
  clearResult();
  setBusy(true, '正在还原…');
  const target = { exePath: state.target.exePath, version: state.target.version };
  const r = await window.api.revert(state.selectedEngine, target);
  setBusy(false, r.ok ? '已还原' : '还原失败');

  if (!r.ok) {
    showResult('err', '还原失败：' + (r.reason || '未知原因'));
    return;
  }

  let msg = '已还原英文界面。' + (r.reason || '');
  if (r.closedCopilot) {
    if (r.closedCopilot.closed) {
      msg += '\n\n已按设置自动关闭 GitHub Copilot，重新打开后即为英文界面。';
    } else if (r.closedCopilot.ok === false) {
      msg += '\n\n自动关闭 Copilot 失败：' + r.closedCopilot.reason +
        '\n请手动关闭并重新打开 GitHub Copilot。';
    } else {
      msg += '\n\nGitHub Copilot 未在运行，下次启动即为英文界面。';
    }
  } else {
    msg += '\n\n提示：若 Copilot 正在运行，需重启它才会显示英文。';
  }
  showResult('info', msg);
}

$('btn-revert').addEventListener('click', doRevert);
$('btn-quick-revert').addEventListener('click', doRevert);

// ---------------------------------------------------------------------------
// 字典包操作
// ---------------------------------------------------------------------------

$('btn-import-pack').addEventListener('click', async () => {
  setBusy(true, '正在导入字典包…');
  const r = await window.api.importPackDir();
  setBusy(false);
  if (r.ok) {
    await loadPack();
    showResult('ok', `字典包已安装：${r.meta.packVersion}（文本 ${r.counts.texts} 条）`);
  } else if (r.reason !== 'cancelled') {
    showResult('err', '导入失败：' + r.reason);
  }
});

$('btn-check-update').addEventListener('click', async () => {
  const r = await window.api.checkPackUpdate();
  if (r.notConfigured) {
    showResult('info', '在线更新尚未配置源地址。当前版本请手动导入字典包；在线更新将在后续版本启用。');
  }
});

$('btn-open-packs').addEventListener('click', () => window.api.openPacksFolder());

// ---------------------------------------------------------------------------
// 残留清理
// ---------------------------------------------------------------------------

async function refreshAudit() {
  const box = $('audit-info');
  box.className = 'audit-box';
  box.textContent = '正在检查…';
  const r = await window.api.cleanupAudit();
  if (!r.total) {
    box.className = 'audit-box clean';
    box.textContent = '未发现残留，系统干净。';
    $('btn-cleanall').disabled = true;
    return;
  }
  $('btn-cleanall').disabled = false;
  box.className = 'audit-box';
  const rows = r.traces.map(t => {
    const details = t.items.map(i => {
      if (i.path) return `${escapeHtml(i.path)}${i.files !== undefined ? ` (${i.files} 个文件)` : ''}`;
      if (i.hive) return `${escapeHtml(i.hive)} · ${escapeHtml(i.value)}`;
      return escapeHtml(JSON.stringify(i));
    }).join('<br>');
    return `<div class="audit-item">
      <div class="audit-label">${escapeHtml(t.label)}</div>
      <div class="audit-detail">${details}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="audit-head">发现 ${r.total} 项残留</div>${rows}`;
}

$('btn-audit').addEventListener('click', refreshAudit);
$('btn-open-data').addEventListener('click', () => window.api.openDataFolder());

$('btn-cleanall').addEventListener('click', async () => {
  const ok = confirm('确定要彻底清理所有残留吗？\n\n将删除：\n· WebView2 调试端口策略\n· 所有字典包与用户数据\n· 缓存与日志\n\n清理后程序会自动退出以完成最后一步删除，需要重新导入字典包才能汉化。');
  if (!ok) return;
  setBusy(true, '正在清理…');
  const r = await window.api.cleanupAll();
  setBusy(false, r.ok ? '清理完成' : '部分清理失败');

  const lines = [];
  if (r.cleaned && r.cleaned.length) {
    lines.push('已立即清理 ' + r.cleaned.length + ' 项');
    r.cleaned.slice(0, 8).forEach(c => lines.push('  · ' + c));
  }
  if (r.deferred && r.deferred.length) {
    lines.push('');
    lines.push('以下 ' + r.deferred.length + ' 项正被本程序占用，将在退出后自动删除：');
    r.deferred.forEach(d => lines.push('  · ' + d));
  }
  if (r.errors && r.errors.length) {
    lines.push('');
    lines.push('失败 ' + r.errors.length + ' 项：');
    r.errors.forEach(e => lines.push('  · ' + e));
  }

  showResult(r.errors && r.errors.length ? 'err' : 'ok', lines.join('\n') || '未发现需要清理的内容。');

  if (r.needRestart) {
    // 用户数据目录被占用，必须退出本程序才能删除
    const quit = confirm('需要退出本程序才能完成最后的数据目录删除。\n\n现在退出吗？退出后剩余文件会自动清除。');
    if (quit) { window.api.quitApp(); return; }
    lines.push('');
    lines.push('提示：关闭本程序后，剩余文件会自动删除。');
  }

  await refreshAudit();
  await loadPack();
});

// ---------------------------------------------------------------------------
// 事件监听
// ---------------------------------------------------------------------------

window.api.onProgress(({ pct, msg }) => setProgress(pct, msg));
window.api.onWatcherStatus((st) => renderWatcher(st));
window.api.onWatcherInjected((info) => {
  setStatus(`已自动汉化 Copilot（${info.replaced} 处）`);
});
window.api.onWatcherError((e) => {
  setStatus('监控提示：' + e.message);
});
window.api.onWatcherPolicyWritten((info) => {
  showResult('info',
    info.reason + '\n\n请关闭 GitHub Copilot 后重新打开，之后会自动汉化。');
});

init().catch(e => {
  showResult('err', '初始化失败：' + e.message);
});
