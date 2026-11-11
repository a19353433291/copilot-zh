// 渲染进程逻辑：驱动界面，全部通过 window.api（preload 白名单）与主进程通信。
'use strict';

const $ = id => document.getElementById(id);

const state = {
  env: null,
  target: null,          // { exePath, version, signature }
  engines: [],           // [{ id, displayName, capabilities }]
  selectedEngine: null,
  pack: null,            // { meta, counts, dict }
  busy: false,
  settings: null,        // 当前设置
  watcher: null,         // 监控状态
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function setStatus(text) { $('status-text').textContent = text; }

function showResult(kind, text) {
  const el = $('result');
  el.hidden = false;
  el.className = 'result ' + kind;
  el.textContent = text;
}
function clearResult() { $('result').hidden = true; }

function setProgress(pct, msg) {
  const wrap = $('progress-wrap');
  wrap.hidden = false;
  $('progress-fill').style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (msg) $('progress-text').textContent = msg;
}
function hideProgress() { $('progress-wrap').hidden = true; $('progress-fill').style.width = '0%'; }

function setBusy(busy, text) {
  state.busy = busy;
  for (const id of ['btn-apply', 'btn-revert', 'btn-locate', 'btn-choose', 'btn-import-pack', 'btn-check-update']) {
    const b = $(id);
    if (b) b.disabled = busy || (id === 'btn-apply' && !canApply());
  }
  if (text) setStatus(text);
}

function canApply() {
  return !!(state.target && state.selectedEngine && state.pack);
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

async function init() {
  state.env = await window.api.env();
  $('badge-version').textContent = 'v' + state.env.appVersion;
  $('status-dir').textContent = state.env.packsDir || '';

  const engineHint = $('engine-hint');
  if (!state.env.supportedPlatforms.includes(state.env.platform)) {
    engineHint.textContent = `当前平台（${state.env.platform}）暂不支持。本工具目前支持：${state.env.supportedPlatforms.join(', ')}。`;
  }

  await Promise.all([locateTarget(), loadEngines(), loadPack()]);
  await loadSettings();
  renderApplyState();
}

// ---------------------------------------------------------------------------
// 常驻监控状态
// ---------------------------------------------------------------------------

function renderWatcher(st) {
  state.watcher = st;
  const dot = $('watch-dot');
  const text = $('watch-text');
  const badge = $('badge-watcher');
  const btnInject = $('btn-inject-now');
  const btnLaunch = $('btn-launch-copilot');
  if (!st) return;

  dot.className = 'dot';

  if (!st.enabled) {
    text.textContent = '常驻监控已关闭（可在设置中开启）';
    badge.className = 'badge';
    badge.textContent = '监控关闭';
    btnInject.hidden = true;
    btnLaunch.hidden = !st.copilotRunning ? false : true;
    return;
  }

  if (!st.copilotRunning) {
    dot.classList.add('on');
    text.textContent = '常驻监控运行中 · 等待 GitHub Copilot 启动';
    badge.className = 'badge ok';
    badge.textContent = '监控中';
    btnInject.hidden = true;
    btnLaunch.hidden = false;
    return;
  }

  if (st.injected) {
    dot.classList.add('on');
    const t = st.lastInjectAt ? new Date(st.lastInjectAt).toLocaleTimeString() : '';
    text.textContent = `已汉化（PID ${st.copilotPid}）${t ? ' · ' + t : ''}`;
    badge.className = 'badge ok';
    badge.textContent = '汉化生效';
  } else {
    dot.classList.add('wait');
    text.textContent = st.lastError
      ? '等待注入：' + st.lastError
      : '检测到 Copilot 运行中，正在注入…';
    badge.className = 'badge warn';
    badge.textContent = '注入中';
  }
  btnInject.hidden = false;
  btnLaunch.hidden = true;
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
// 设置
// ---------------------------------------------------------------------------

async function loadSettings() {
  const r = await window.api.getSettings();
  state.settings = r.data;

  $('set-launch-after-apply').checked = !!r.data.launchCopilotAfterApply;
  $('set-auto-inject').checked = !!r.data.autoInjectOnStart;
  $('set-interval').value = String(r.data.watchIntervalMs);
  $('set-run-at-login').checked = !!r.data.runAtLogin;
  $('set-minimize-tray').checked = !!r.data.minimizeToTray;
  $('settings-datadir').textContent = state.env.userDir || '';

  // 开机自启在非 Windows 下不可用
  if (!r.autostartSupported) {
    $('set-run-at-login').disabled = true;
    $('autostart-hint').textContent = '当前平台不支持';
  }

  const intervalSel = $('set-interval');
  intervalSel.disabled = !r.data.autoInjectOnStart;

  if (r.watcher) renderWatcher(r.watcher);
}

function flashSaved(text) {
  const el = $('settings-saved-hint');
  el.textContent = text || '已保存';
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => { el.textContent = ''; }, 1800);
}

async function patchSettings(patch) {
  const r = await window.api.setSettings(patch);
  if (!r.ok) {
    showResult('err', r.reason || '保存设置失败');
    await loadSettings();
    return;
  }
  state.settings = r.data;
  flashSaved();
  // 间隔变化后需要刷新监控显示
  const st = await window.api.watcherStatus();
  renderWatcher(st);
}

function openSettings() {
  $('settings-modal').hidden = false;
  loadSettings();
}
function closeSettings() {
  $('settings-modal').hidden = true;
}

$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', closeSettings);
$('btn-settings-done').addEventListener('click', closeSettings);
$('settings-modal').addEventListener('click', (e) => {
  if (e.target === $('settings-modal')) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings-modal').hidden) closeSettings();
});

$('set-launch-after-apply').addEventListener('change', (e) => {
  patchSettings({ launchCopilotAfterApply: e.target.checked });
});
$('set-auto-inject').addEventListener('change', (e) => {
  $('set-interval').disabled = !e.target.checked;
  patchSettings({ autoInjectOnStart: e.target.checked });
});
$('set-interval').addEventListener('change', (e) => {
  patchSettings({ watchIntervalMs: Number(e.target.value) });
});
$('set-run-at-login').addEventListener('change', async (e) => {
  const want = e.target.checked;
  await patchSettings({ runAtLogin: want });
});
$('set-minimize-tray').addEventListener('change', (e) => {
  patchSettings({ minimizeToTray: e.target.checked });
});
$('btn-open-data-2').addEventListener('click', () => window.api.openDataFolder());
$('btn-reset-settings').addEventListener('click', async () => {
  const r = await window.api.resetSettings();
  if (r.ok) { flashSaved('已恢复默认'); await loadSettings(); }
});

// 监控状态实时推送
window.api.onWatcherStatus((st) => renderWatcher(st));
window.api.onWatcherInjected((info) => {
  setStatus(`已自动汉化 Copilot（${info.replaced} 处）`);
});
window.api.onWatcherError((e) => {
  setStatus('监控提示：' + e.message);
});

// 首次使用：策略刚写入，需要重启 Copilot 才生效
window.api.onWatcherPolicyWritten((info) => {
  showResult('info',
    info.reason +
    '\n\n请关闭 GitHub Copilot 后重新打开，之后就会自动汉化，无需再手动操作。');
  setStatus('需要重启 GitHub Copilot 一次');
});
const btnRestart = null;

// ---------------------------------------------------------------------------
// 目标应用
// ---------------------------------------------------------------------------

async function locateTarget() {
  const box = $('target-info');
  box.textContent = '正在检测…';
  const r = await window.api.locateApp();
  if (!r.ok) {
    state.target = null;
    box.innerHTML = '<span style="color:var(--warning)">未自动找到 GitHub Copilot。请点击下方「手动选择路径」。</span>';
    setStatus('未找到目标应用');
    renderApplyState();
    return;
  }
  state.target = { exePath: r.exePath, version: r.version, signature: r.signature };
  renderTarget();
  setStatus('已找到 GitHub Copilot');
  renderApplyState();
}

function renderTarget() {
  const t = state.target;
  const box = $('target-info');
  if (!t) {
    box.className = 'target-empty';
    box.textContent = '未选择目标应用';
    return;
  }
  box.className = '';
  const sigClass = t.signature === 'Valid' ? 'ok' : (t.signature === 'HashMismatch' ? 'err' : 'warn');
  const sigLabel = t.signature === 'Valid' ? '✓ 签名有效'
    : t.signature === 'HashMismatch' ? '✗ 签名已失效（文件被修改过）'
    : t.signature || '未知';
  box.innerHTML = `
    <dl class="target-grid">
      <dt>程序</dt><dd class="path">${escapeHtml(t.exePath)}</dd>
      <dt>版本</dt><dd class="mono">${escapeHtml(t.version || '未知')}</dd>
      <dt>签名</dt><dd><span class="badge ${sigClass}">${escapeHtml(sigLabel)}</span></dd>
    </dl>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

async function loadEngines() {
  state.engines = await window.api.listEngines();
  renderEngines();
}

const ENGINE_DESC = {
  'runtime-inject': {
    desc: '通过 WebView2 调试端口，把翻译实时注入界面。不修改应用本体。',
    tags: (c) => [
      c.modifiesApp ? { t: '修改本体', bad: true } : { t: '不改本体', good: true },
      { t: '签名保持完好', good: true },
      { t: '升级不失效', good: true },
      { t: '字典即时生效', good: true },
      { t: '需管理员权限', bad: true },
      { t: '需常驻进程', bad: true },
    ],
  },
  'binary-patch': {
    desc: '解开应用内嵌资源、替换文案后重新压缩写回。一次生效，无需常驻。',
    tags: (c) => [
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
    box.innerHTML = '<div class="pack-empty">当前平台没有可用引擎。</div>';
    return;
  }
  box.innerHTML = state.engines.map(e => {
    const meta = ENGINE_DESC[e.id] || { desc: '', tags: () => [] };
    const tags = meta.tags(e.capabilities)
      .map(x => `<span class="tag ${x.good ? 'good' : (x.bad ? 'bad' : '')}">${escapeHtml(x.t)}</span>`)
      .join('');
    const sel = state.selectedEngine === e.id ? ' selected' : '';
    return `<div class="engine-item${sel}" data-engine="${escapeHtml(e.id)}">
      <div class="radio"></div>
      <div class="engine-body">
        <div class="engine-title">${escapeHtml(e.displayName)}</div>
        <div class="engine-desc">${escapeHtml(meta.desc)}</div>
        <div class="engine-tags">${tags}</div>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.engine-item').forEach(el => {
    el.addEventListener('click', () => selectEngine(el.dataset.engine));
  });
}

function selectEngine(id) {
  state.selectedEngine = id;
  const meta = ENGINE_DESC[id];
  $('engine-hint').textContent = meta
    ? meta.desc + (id === 'runtime-inject'
        ? ' 注意：需要以管理员身份运行本工具。'
        : '')
    : '';
  renderEngines();
  renderApplyState();
}

// ---------------------------------------------------------------------------
// 字典包
// ---------------------------------------------------------------------------

async function loadPack() {
  const r = await window.api.currentPack();
  if (!r.ok) {
    state.pack = null;
    $('pack-info').className = 'pack-empty';
    $('pack-info').textContent = r.reason || '尚未安装字典包';
    renderApplyState();
    return;
  }
  state.pack = r;
  renderPack();
  renderApplyState();
}

function renderPack() {
  const p = state.pack;
  const box = $('pack-info');
  box.className = '';
  const m = p.meta || {};
  const c = p.counts || {};
  const compat = m.appCompat || {};
  const compatText = (compat.min || compat.max)
    ? `>= ${compat.min || '不限'} 且 <= ${compat.max || '不限'}`
    : '不限制';
  box.innerHTML = `
    <dl class="pack-grid">
      <dt>版本</dt><dd class="mono">${escapeHtml(m.packVersion || '未知')}</dd>
      <dt>语言</dt><dd>${escapeHtml(m.locale || 'zh-CN')}</dd>
      <dt>条目</dt><dd>文本 ${c.texts || 0} · 正则 ${c.patterns || 0} · 属性 ${c.attrs || 0}</dd>
      <dt>兼容版本</dt><dd>${escapeHtml(compatText)}</dd>
      <dt>校验</dt><dd><span class="badge ok">✓ 签名与哈希校验通过</span></dd>
    </dl>`;
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

function renderApplyState() {
  const btn = $('btn-apply');
  if (!btn) return;
  btn.disabled = state.busy || !canApply();
}

async function doApply() {
  if (!canApply()) return;
  clearResult();
  setBusy(true, '正在执行汉化…');
  $('btn-apply').classList.add('loading');
  setProgress(0, '准备中…');

  const target = { exePath: state.target.exePath, version: state.target.version };

  // 先探测
  const probe = await window.api.probe(state.selectedEngine, target);
  if (!probe.ok) {
    $('btn-apply').classList.remove('loading');
    setBusy(false, '探测失败');
    hideProgress();
    showResult('err', '无法执行：' + (probe.reason || '未知原因'));
    return;
  }

  const r = await window.api.apply(state.selectedEngine, target, state.pack.dict);
  $('btn-apply').classList.remove('loading');
  setBusy(false, r.ok ? '汉化完成' : '汉化失败');

  if (r.ok) {
    setProgress(100, '完成');
    const stats = r.stats || {};
    let msg =
      `汉化已应用。替换 ${stats.replaced || 0} 处文案` +
      (stats.port ? `（调试端口 ${stats.port}）` : '') + '。';

    if (r.launched) {
      if (r.launched.ok && r.launched.skipped) {
        msg += '\nGitHub Copilot 已在运行，请切换到它的窗口查看效果。';
      } else if (r.launched.ok) {
        msg += '\n已同步启动 GitHub Copilot，请稍候查看中文界面。';
      } else {
        msg += '\n自动启动 Copilot 失败：' + (r.launched.reason || '未知原因');
      }
    } else {
      msg += '\n请切换到 GitHub Copilot 窗口查看效果；若界面无变化，请重启 Copilot 后再次执行。';
    }
    showResult('ok', msg);
    await refreshStatus();
  } else {
    hideProgress();
    showResult('err', '汉化失败：' + (r.reason || '未知原因'));
  }
}

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
  if (r.ok) showResult('info', '已还原。' + (r.reason || ''));
  else showResult('err', '还原失败：' + (r.reason || '未知原因'));
  await refreshStatus();
}

async function refreshStatus() {
  if (!state.target || !state.selectedEngine) return;
  const target = { exePath: state.target.exePath, version: state.target.version };
  try {
    const st = await window.api.status(state.selectedEngine, target);
    if (st && st.info) {
      const el = $('badge-elev');
      if (st.state === 'applied') {
        el.className = 'badge ok';
        el.textContent = st.info.debugPortLive ? '汉化生效中' : '已配置（待重启生效）';
      } else {
        el.className = 'badge';
        el.textContent = '未汉化';
      }
    }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------

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
  renderApplyState();
  setStatus('已手动指定应用路径');
});

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

$('btn-apply').addEventListener('click', doApply);
$('btn-revert').addEventListener('click', doRevert);

// ---------------------------------------------------------------------------
// 残留审计与彻底清理
// ---------------------------------------------------------------------------

async function refreshAudit() {
  const box = $('audit-info');
  box.className = 'audit-empty';
  box.textContent = '正在检查…';
  const r = await window.api.cleanupAudit();
  if (!r.total) {
    box.className = 'audit-clean';
    box.innerHTML = '✓ 未发现任何残留，系统是干净的。';
    $('btn-cleanall').disabled = true;
    return;
  }
  $('btn-cleanall').disabled = false;
  box.className = '';
  const rows = r.traces.map(t => {
    const details = t.items.map(i => {
      if (i.path) return `<span class="path">${escapeHtml(i.path)}</span>${i.files !== undefined ? ` <span class="muted">(${i.files} 个文件)</span>` : ''}`;
      if (i.hive) return `<span class="mono">${escapeHtml(i.hive)}</span> · <span class="mono">${escapeHtml(i.value)}</span>`;
      return escapeHtml(JSON.stringify(i));
    }).join('<br>');
    return `<div class="audit-item">
      <div class="audit-label">⚠ ${escapeHtml(t.label)}</div>
      <div class="audit-detail">${details}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="audit-head">发现 ${r.total} 项残留：</div>${rows}`;
}

$('btn-audit').addEventListener('click', refreshAudit);

$('btn-open-data').addEventListener('click', () => window.api.openDataFolder());

$('btn-cleanall').addEventListener('click', async () => {
  const ok = confirm('确定要彻底清理所有残留吗？\n\n将删除：\n· WebView2 调试端口策略\n· 所有字典包与用户数据\n· 缓存与日志\n\n清理后需要重新导入字典包才能继续汉化。');
  if (!ok) return;
  setBusy(true, '正在清理…');
  const r = await window.api.cleanupAll();
  setBusy(false, r.ok ? '清理完成' : '部分清理失败');
  clearResult();
  const lines = [];
  if (r.cleaned && r.cleaned.length) {
    lines.push('已清理 ' + r.cleaned.length + ' 项：');
    r.cleaned.slice(0, 12).forEach(c => lines.push('  · ' + c));
    if (r.cleaned.length > 12) lines.push(`  … 共 ${r.cleaned.length} 项`);
  }
  if (r.errors && r.errors.length) {
    lines.push('失败 ' + r.errors.length + ' 项：');
    r.errors.forEach(e => lines.push('  · ' + e));
  }
  showResult(r.ok ? 'ok' : 'err', lines.join('\n') || '未发现需要清理的内容。');
  await refreshAudit();
  await loadPack();
});

window.api.onProgress(({ pct, msg }) => setProgress(pct, msg));

init().then(refreshAudit).catch(e => {
  showResult('err', '初始化失败：' + e.message);
});
