// 渲染进程逻辑：页面导航、主题、设置、汉化流程。
//
// 重构原则：
//   - 业务逻辑（IPC 调用顺序、参数、错误处理）与原版完全一致
//   - 只调整 DOM 选择器与渲染方式，不改变行为
//   - 新增主题控制与 Toast 反馈，但不影响既有流程

'use strict';

const $ = id => document.getElementById(id);

const state = {
  env: null,
  sys: null,
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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 在概览页展示结果提示。
 * 保留原有 #result 元素与 hidden 语义（测试依赖）。
 */
function showResult(kind, text) {
  const el = $('result');
  if (!el) return;
  el.hidden = false;
  el.className = 'alert ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'info');
  const iconName = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info';
  el.innerHTML = `<span class="alert-icon">${icon(iconName, 16)}</span><div class="alert-body">${escapeHtml(text)}</div>`;
  if (state.page !== 'home') switchPage('home');
}

function clearResult() {
  const el = $('result');
  if (el) el.hidden = true;
}

function setProgress(pct, msg) {
  const wrap = $('progress-wrap');
  if (!wrap) return;
  wrap.hidden = false;
  const fill = $('progress-fill');
  if (fill) {
    fill.classList.remove('indeterminate');
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  if (msg) $('progress-text').textContent = msg;
}

function hideProgress() {
  const w = $('progress-wrap');
  if (!w) return;
  w.hidden = true;
  const fill = $('progress-fill');
  if (fill) { fill.style.width = '0%'; fill.classList.remove('indeterminate'); }
}

function canApply() {
  return !!(state.target && state.selectedEngine && state.pack);
}

function setBusy(busy, text) {
  state.busy = busy;
  const ids = ['btn-apply', 'btn-quick-apply', 'btn-revert', 'btn-quick-revert',
               'btn-locate', 'btn-choose', 'btn-import-pack', 'btn-check-update',
               'btn-audit', 'btn-cleanall'];
  for (const id of ids) {
    const b = $(id);
    if (!b) continue;
    const isApply = (id === 'btn-apply' || id === 'btn-quick-apply');
    b.disabled = busy || (isApply && !canApply());
  }
  if (text) setStatus(text);
}

// ---------------------------------------------------------------------------
// 页面导航
// ---------------------------------------------------------------------------

function switchPage(page) {
  if (!PAGE_TITLES[page]) page = 'home';
  state.page = page;

  document.querySelectorAll('.nav-item').forEach(el => {
    const on = el.dataset.page === page;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const title = $('page-title');
  if (title) title.textContent = PAGE_TITLES[page] || '';

  const pages = $('pages');
  if (pages) pages.scrollTop = 0;

  // 切页后内容通常不满一屏，重置顶栏材质状态
  updateTopbarMaterial();

  // 主题分段控件在页面可见后才好测量位置
  if (page === 'settings') {
    requestAnimationFrame(() => Segmented.reprojectAll());
  }
}

/**
 * 顶栏材质：内容滚动后才启用背景模糊。
 * 静态时顶栏与页面同色，不额外加一层模糊，避免无谓的合成开销。
 *
 * 实现说明：
 * 1. 监听 #pages 的 scroll 事件（用户真实滚动的主要路径）
 * 2. 用 setInterval 兜底（不用 rAF —— 页面不可见时 rAF 会被浏览器暂停，
 *    导致状态不同步；setInterval 在隐藏页面仍会执行）
 * 3. 只在 class 真正变化时才操作 DOM，开销可忽略
 */
function updateTopbarMaterial() {
  const pages = $('pages');
  const topbar = document.querySelector('.topbar');
  if (!pages || !topbar) return;
  const scrolled = pages.scrollTop > 4;
  if (topbar.classList.contains('scrolled') !== scrolled) {
    topbar.classList.toggle('scrolled', scrolled);
  }
}

let _materialTimer = 0;
function initTopbarMaterial() {
  const pages = $('pages');
  if (!pages) return;

  pages.addEventListener('scroll', updateTopbarMaterial, { passive: true });

  // 兜底轮询：250ms 一次，只在状态变化时触碰 DOM
  if (!_materialTimer) {
    _materialTimer = setInterval(updateTopbarMaterial, 250);
  }

  updateTopbarMaterial();
}

/** 清理兜底轮询（页面卸载时调用，避免定时器泄漏） */
function teardownTopbarMaterial() {
  if (_materialTimer) {
    clearInterval(_materialTimer);
    _materialTimer = 0;
  }
}
window.addEventListener('beforeunload', teardownTopbarMaterial);

function initNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchPage(el.dataset.page);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 通用下拉框（初始化后返回控制句柄）
// ---------------------------------------------------------------------------

function initSelect(wrapId, onChange) {
  const wrap = $(wrapId);
  if (!wrap) return null;
  const trigger = wrap.querySelector('.select-trigger');
  const menu = wrap.querySelector('.select-menu');
  const label = wrap.querySelector('.select-label');
  if (!trigger || !menu) return null;

  // 打开下拉时提升祖先容器的层叠顺序。
  // 会裁切或成层的容器：.card / .group（backdrop-filter + overflow:hidden）、
  // .content-area（浮起面板的圆角裁切）。全部放开，菜单才能完整显示。
  const raiseAncestors = (raise) => {
    let el = wrap.parentElement;
    while (el && el !== document.body) {
      if (el.classList) {
        if (el.classList.contains('card') ||
            el.classList.contains('row') ||
            el.classList.contains('group') ||
            el.classList.contains('content-area')) {
          el.classList.toggle('stack-raised', raise);
        }
      }
      el = el.parentElement;
    }
  };

  /**
   * 根据菜单可用空间决定向上还是向下展开。
   * 页面底部附近的控件向下展开会超出可视区域，
   * 被 .pages 的 overflow 或状态栏裁切。
   */
  const positionMenu = () => {
    menu.classList.remove('drop-up');
    // 先让它可测量
    menu.hidden = false;
    const triggerRect = trigger.getBoundingClientRect();
    const menuH = menu.offsetHeight || 160;
    const viewportH = window.innerHeight;
    // 预留底部状态栏 + 安全边距
    const spaceBelow = viewportH - triggerRect.bottom - 40;
    if (spaceBelow < menuH && triggerRect.top > menuH) {
      menu.classList.add('drop-up');
    }
    menu.hidden = true;
  };

  const close = () => {
    menu.hidden = true;
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    raiseAncestors(false);
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    // 先关闭其它下拉（会连带清理它们的 stack-raised）
    document.querySelectorAll('.select-menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.select-trigger').forEach(t => {
      t.classList.remove('open');
      t.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.stack-raised').forEach(el => el.classList.remove('stack-raised'));

    if (willOpen) {
      positionMenu();              // 先判断展开方向
      menu.hidden = false;
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      raiseAncestors(true);
    }
  });

  menu.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.dataset.value;
      trigger.dataset.value = val;
      if (label) label.textContent = opt.textContent.trim();
      menu.querySelectorAll('.select-option').forEach(o => {
        o.classList.remove('active');
        o.setAttribute('aria-selected', 'false');
      });
      opt.classList.add('active');
      opt.setAttribute('aria-selected', 'true');
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
      if (label) label.textContent = opt.textContent.trim();
      menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    },
    setEnabled(on) { trigger.disabled = !on; },
    get() { return trigger.dataset.value; },
  };
}

let intervalSelect = null;
let glassSelect = null;

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

async function init() {
  initNav();

  state.env = await window.api.env();
  $('brand-version').textContent = 'v' + state.env.appVersion;
  $('status-dir').textContent = state.env.packsDir || '';
  $('status-dir').title = state.env.packsDir || '';

  await checkAdmin();
  await Promise.all([locateTarget(), loadEngines(), loadPack()]);
  await loadSettings();
  await refreshAudit();
  renderApplyState();

  // 初始化汉化页的检测格与流程状态
  refreshChecks();
  resetFlow();

  // 顶栏材质随滚动切换（玻璃设置在「增强」档才有可见差异）
  initTopbarMaterial();

  switchPage('home');

  // 主题分段控件
  await initThemeUI();
}

async function checkAdmin() {
  try {
    state.sys = await window.api.sysCheck();
  } catch (e) {
    state.sys = { elevated: false };
  }
  const hint = $('admin-hint');
  const btn = $('btn-elevate');
  const elevated = !!(state.sys && state.sys.elevated);
  if (hint) hint.hidden = elevated;
  if (btn) btn.hidden = elevated;
}

$('btn-elevate').addEventListener('click', async () => {
  await window.api.relaunchAsAdmin();
});

// ---------------------------------------------------------------------------
// 主题 UI
// ---------------------------------------------------------------------------

let themeSegmented = null;

async function initThemeUI() {
  themeSegmented = Segmented.init('seg-theme', (value) => {
    ThemeController.set({ theme: value });
    patchSettings({ theme: value });
  });

  // 动效开关
  const motionEl = $('set-motion');
  if (motionEl) {
    motionEl.addEventListener('change', (e) => {
      const v = e.target.checked ? 'on' : 'off';
      ThemeController.set({ motion: v });
      patchSettings({ motion: v });
    });
  }

  // 玻璃强度
  glassSelect = initSelect('sel-glass', (value) => {
    ThemeController.set({ glass: value });
    patchSettings({ glass: value });
  });

  // 系统主题变化时重绘（仅 system 模式内部会通知）
  ThemeController.watchSystem();
  window.addEventListener('theme:change', () => {
    requestAnimationFrame(() => Segmented.reprojectAll());
    updateThemeQuickIcon();
  });

  // 标题栏的主题快速切换：亮色 → 深色 → 跟随系统 循环
  const quickBtn = $('btn-theme-quick');
  if (quickBtn) {
    quickBtn.addEventListener('click', () => {
      const order = ['light', 'dark', 'system'];
      const cur = ThemeController.get().theme;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      ThemeController.set({ theme: next });
      patchSettings({ theme: next });
      if (themeSegmented) themeSegmented.set(next);
      Toast.info(THEME_LABELS[next] || next);
    });
  }

  updateThemeQuickIcon();
}

const THEME_LABELS = { light: '浅色模式', dark: '深色模式', system: '跟随系统' };

const THEME_ICONS = {
  light: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`,
  dark: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  system: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
};

/** 让标题栏主题按钮的图标反映当前模式 */
function updateThemeQuickIcon() {
  const btn = $('btn-theme-quick');
  if (!btn) return;
  const cur = ThemeController.get().theme || 'system';
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.innerHTML = THEME_ICONS[cur] || THEME_ICONS.system;
  }
  btn.setAttribute('data-tip', THEME_LABELS[cur] || '切换主题');
  btn.setAttribute('aria-label', THEME_LABELS[cur] || '切换主题');
}

// ---------------------------------------------------------------------------
// 常驻监控状态
// ---------------------------------------------------------------------------

function renderWatcher(st) {
  state.watcher = st;
  const dot = $('home-dot');
  const title = $('home-title');
  const sub = $('home-sub');
  const pill = $('badge-watcher');
  const pillDot = $('badge-watcher-dot');
  const btnInject = $('btn-inject-now');
  const btnLaunch = $('btn-launch-copilot');
  if (!st) return;

  if (dot) dot.className = 'status-dot lg';
  if (pillDot) pillDot.className = 'status-dot';
  if (sub) sub.textContent = '';
  if (btnInject) btnInject.hidden = true;
  if (btnLaunch) btnLaunch.hidden = true;

  const setPill = (kind, text) => {
    if (pill) pill.textContent = text;
    if (pillDot) {
      pillDot.className = 'status-dot' + (kind ? ' ' + kind : '');
    }
  };

  // 主状态卡左侧色条跟随状态
  const setHeroKind = (kind) => {
    const hero = $('hero-card');
    if (!hero) return;
    hero.classList.remove('is-ok', 'is-warn', 'is-err', 'is-busy');
    if (kind) hero.classList.add('is-' + kind);
  };


  // 运行详情区：始终按真实状态渲染（不是假数据）
  renderWatcherDetail(st);

  // 监控未开启
  if (!st.enabled) {
    if (title) title.textContent = '常驻监控已关闭';
    if (sub) sub.textContent = '可在设置中开启「常驻监控自动汉化」';
    setPill('', '已关闭');
    setHeroKind('');
    return;
  }

  // Copilot 未运行
  if (!st.copilotRunning) {
    if (dot) dot.classList.add('ok');
    if (title) title.textContent = '监控运行中';
    if (sub) sub.textContent = '等待 GitHub Copilot 启动，启动后将自动汉化';
    setPill('ok', '运行中');
    setHeroKind('ok');
    if (btnLaunch) btnLaunch.hidden = false;
    return;
  }

  // 已汉化
  if (st.injected) {
    if (dot) dot.classList.add('ok');
    const t = st.lastInjectAt
      ? new Date(st.lastInjectAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    if (title) title.textContent = '界面已汉化';
    if (sub) sub.textContent = `Copilot 运行中${t ? ' · 汉化于 ' + t : ''}`;
    setPill('ok', '已汉化');
    setHeroKind('ok');
  } else {
    // 注入中 / 失败
    if (dot) dot.classList.add(st.lastError ? 'err' : 'busy');
    if (title) title.textContent = st.lastError ? '注入未成功' : '正在注入…';
    if (sub) sub.textContent = st.lastError || '检测到 Copilot 运行中，即将完成汉化';
    setPill(st.lastError ? 'err' : 'warn', st.lastError ? '需处理' : '注入中');
    setHeroKind(st.lastError ? 'err' : 'busy');
  }
  if (btnInject) btnInject.hidden = false;

  // 状态变化后同步汉化页的检测格
  refreshChecks();
}

/**
 * 渲染概览页「运行详情」卡片。
 * 所有字段均来自 watcher 真实状态，不使用静态假数据。
 */
function renderWatcherDetail(st) {
  // 总体状态徽章
  const badge = $('home-state-badge');
  if (badge) {
    let kind = '', text = '未知';
    if (!st.enabled) { kind = ''; text = '监控关闭'; }
    else if (!st.copilotRunning) { kind = 'info'; text = '待启动'; }
    else if (st.injected) { kind = 'ok'; text = '已汉化'; }
    else if (st.lastError) { kind = 'err'; text = '异常'; }
    else { kind = 'warn'; text = '注入中'; }
    badge.className = 'badge' + (kind ? ' ' + kind : '');
    badge.textContent = text;
  }

  // Copilot 进程
  const procEl = $('home-copilot-proc');
  const procDot = $('home-proc-dot');
  if (procEl) {
    if (st.copilotRunning) {
      procEl.textContent = st.copilotPid ? `运行中 · PID ${st.copilotPid}` : '运行中';
      if (procDot) procDot.className = 'status-dot ok';
    } else {
      procEl.textContent = '未运行';
      if (procDot) procDot.className = 'status-dot';
    }
  }

  // 调试端口
  const portEl = $('home-port');
  const portBadge = $('home-port-badge');
  if (portEl) {
    if (st.injected) {
      portEl.textContent = `已连接 · 127.0.0.1:${st.port || 9222}`;
      if (portBadge) { portBadge.className = 'badge ok'; portBadge.textContent = '正常'; }
    } else if (st.copilotRunning) {
      portEl.textContent = `未连接 · 端口 ${st.port || 9222}`;
      if (portBadge) { portBadge.className = 'badge warn'; portBadge.textContent = '待连接'; }
    } else {
      portEl.textContent = '应用未启动';
      if (portBadge) { portBadge.className = 'badge'; portBadge.textContent = '—'; }
    }
  }

  // 最近注入时间
  const injEl = $('home-last-inject');
  if (injEl) {
    if (st.lastInjectAt) {
      injEl.textContent = new Date(st.lastInjectAt).toLocaleString('zh-CN', { hour12: false });
    } else if (st.lastError) {
      injEl.textContent = '上次尝试失败';
    } else {
      injEl.textContent = '尚无记录';
    }
  }
}

$('btn-inject-now').addEventListener('click', async () => {
  setStatus('正在注入…');
  const r = await window.api.injectNow();
  if (r.ok) {
    setStatus('已注入');
    Toast.ok('注入成功', '中文界面已应用');
  } else {
    showResult('err', '注入失败：' + (r.reason || '未知原因'));
  }
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
  if (box) {
    box.className = 'row-value t-muted';
    box.textContent = '正在检测…';
  }
  const r = await window.api.locateApp();
  if (!r.ok) {
    state.target = null;
    if (box) {
      box.className = 'row-value';
      box.innerHTML = '<span class="t-warn">未自动找到，请手动选择</span>';
    }
    const pathEl = $('target-path');
    if (pathEl) pathEl.textContent = '';
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
  if (!box) return;

  if (!t) {
    box.className = 'row-value t-muted';
    box.textContent = '未选择目标应用';
    if (pathEl) pathEl.textContent = '';
    return;
  }

  box.className = 'row-value';
  const sigOk = t.signature === 'Valid';
  const sigWarn = t.signature === 'HashMismatch';
  const sigSpan = sigOk ? '<span class="t-ok">签名有效</span>'
    : sigWarn ? '<span class="t-danger">签名已失效</span>'
      : '<span class="t-muted">签名未知</span>';
  const name = t.exePath.split('\\').pop();
  box.innerHTML = `${escapeHtml(name)} · ${sigSpan}`;
  if (pathEl) pathEl.textContent = t.exePath;

  // 同步到概览页的运行详情
  const homePath = $('home-target-path');
  if (homePath) homePath.textContent = t.exePath;
}

function updateStats() {
  const t = state.target;

  const verEl = $('stat-version');
  if (verEl) {
    const has = !!(t && t.version);
    verEl.textContent = has ? 'v' + t.version : '—';
    verEl.className = 'stat-value' + (has ? '' : ' dim');
  }

  const signEl = $('stat-sign');
  if (signEl) {
    if (t && t.signature === 'Valid') {
      signEl.textContent = '有效';
      signEl.className = 'stat-value ok';
    } else if (t && t.signature === 'HashMismatch') {
      signEl.textContent = '已失效';
      signEl.className = 'stat-value err';
    } else if (t) {
      signEl.textContent = '未知';
      signEl.className = 'stat-value warn';
    } else {
      signEl.textContent = '—';
      signEl.className = 'stat-value dim';
    }
  }

  const dictEl = $('stat-dict');
  if (dictEl) {
    if (state.pack) {
      const n = (state.pack.counts && state.pack.counts.texts) || 0;
      dictEl.className = 'stat-value';
      animateNumber(dictEl, n);
    } else {
      dictEl.textContent = '无';
      dictEl.className = 'stat-value warn';
    }
  }
}

// 「重新检测」按钮已并入折叠摘要，元素可能不存在，做防御式绑定
const btnLocate = $('btn-locate');
if (btnLocate) {
  btnLocate.addEventListener('click', async () => {
    setBusy(true, '正在检测…');
    await locateTarget();
    setBusy(false, '检测完成');
  });
}

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
// 汉化页：环境检测 + 流程可视化
// ---------------------------------------------------------------------------

/**
 * 刷新汉化页的四个检测格。
 * 全部来自真实状态（target / watcher / engine status），无假数据。
 */
function refreshChecks() {
  // 1. Copilot 安装
  const appItem = $('check-app');
  const appDot = $('check-app-dot');
  const appVal = $('check-app-value');
  if (appVal) {
    if (state.target) {
      appVal.textContent = 'v' + (state.target.version || '?');
      if (appItem) appItem.className = 'check-item ok';
      if (appDot) appDot.className = 'status-dot ok';
    } else {
      appVal.textContent = '未安装';
      if (appItem) appItem.className = 'check-item err';
      if (appDot) appDot.className = 'status-dot err';
    }
  }

  // 2. 进程状态（来自 watcher）
  const procItem = $('check-proc');
  const procDot = $('check-proc-dot');
  const procVal = $('check-proc-value');
  const w = state.watcher;
  if (procVal) {
    if (w && w.copilotRunning) {
      procVal.textContent = w.copilotPid ? `PID ${w.copilotPid}` : '运行中';
      if (procItem) procItem.className = 'check-item ok';
      if (procDot) procDot.className = 'status-dot ok';
    } else {
      procVal.textContent = '未运行';
      if (procItem) procItem.className = 'check-item';
      if (procDot) procDot.className = 'status-dot';
    }
  }

  // 3. 调试端口（只有已注入才能确认连通）
  const portItem = $('check-port');
  const portDot = $('check-port-dot');
  const portVal = $('check-port-value');
  if (portVal) {
    if (w && w.injected) {
      portVal.textContent = '已连接';
      if (portItem) portItem.className = 'check-item ok';
      if (portDot) portDot.className = 'status-dot ok';
    } else if (w && w.copilotRunning) {
      portVal.textContent = '待连接';
      if (portItem) portItem.className = 'check-item warn';
      if (portDot) portDot.className = 'status-dot warn';
    } else {
      portVal.textContent = '未启用';
      if (portItem) portItem.className = 'check-item';
      if (portDot) portDot.className = 'status-dot';
    }
  }

  // 4. 常驻监控
  const monItem = $('check-monitor');
  const monDot = $('check-monitor-dot');
  const monVal = $('check-monitor-value');
  if (monVal) {
    if (w && w.enabled) {
      monVal.textContent = w.running ? '运行中' : '已开启';
      if (monItem) monItem.className = 'check-item ok';
      if (monDot) monDot.className = 'status-dot ok';
    } else {
      monVal.textContent = '已关闭';
      if (monItem) monItem.className = 'check-item';
      if (monDot) monDot.className = 'status-dot';
    }
  }

  // 折叠摘要：一行概括四项检测的整体状态
  const summary = $('check-summary');
  if (summary) {
    const items = [];
    if (state.target) items.push('已安装');
    else items.push('未安装');
    if (w && w.copilotRunning) items.push('运行中');
    else items.push('未运行');
    if (w && w.injected) items.push('已连接');
    else items.push('未连接');

    const allGood = !!state.target && w && w.copilotRunning && w.injected;
    summary.className = 'badge' + (allGood ? ' ok' : '');
    summary.textContent = items.join(' · ');
  }
}

/**
 * 根据进度百分比映射到 7 个阶段。
 * 这个映射基于 applyFlow.js 的真实执行顺序：
 *   5% 检查权限 → 12% 策略 → 30% 连接端口 → 22% 重启 → 60% 等界面 → 70% 注入 → 88% 验证
 */
const FLOW_STAGES = [
  { step: 1, from: 0,   to: 12 },   // 检查 Copilot + 权限
  { step: 2, from: 12,  to: 30 },   // 写入调试策略
  { step: 3, from: 30,  to: 36 },   // 检查端口
  { step: 4, from: 36,  to: 50 },   // 必要时重启
  { step: 5, from: 50,  to: 70 },   // 等待界面就绪
  { step: 6, from: 70,  to: 88 },   // 注入翻译
  { step: 7, from: 88,  to: 101 },  // 验证结果
];

let flowState = { running: false, currentStep: 0, failed: false };

function resetFlow() {
  flowState = { running: false, currentStep: 0, failed: false };
  document.querySelectorAll('.flow-step').forEach(el => {
    el.classList.remove('active', 'done', 'failed');
  });
}

function setFlowStep(step, status) {
  const el = document.querySelector(`.flow-step[data-step="${step}"]`);
  if (!el) return;
  el.classList.remove('active', 'done', 'failed');
  if (status) el.classList.add(status);
}

/**
 * 根据进度推进流程可视化。
 * @param {number} pct 0-100
 */
function advanceFlow(pct) {
  if (!flowState.running) return;

  // 找到当前阶段
  let cur = 7;
  for (const s of FLOW_STAGES) {
    if (pct < s.to) { cur = s.step; break; }
  }

  // 之前的阶段标为完成，当前标为进行中
  for (let i = 1; i <= 7; i++) {
    if (i < cur) setFlowStep(i, 'done');
    else if (i === cur) setFlowStep(i, 'active');
    else setFlowStep(i, '');
  }
  flowState.currentStep = cur;
}

function failFlow() {
  flowState.running = false;
  flowState.failed = true;
  // 当前阶段标红，之前的保持完成
  for (let i = 1; i <= 7; i++) {
    if (i < flowState.currentStep) setFlowStep(i, 'done');
    else if (i === flowState.currentStep) setFlowStep(i, 'failed');
  }
}

function completeFlow() {
  flowState.running = false;
  for (let i = 1; i <= 7; i++) setFlowStep(i, 'done');
}

async function loadEngines() {
  state.engines = await window.api.listEngines();
  if (!state.selectedEngine && state.engines.length) {
    state.selectedEngine = state.engines[0].id;
    const hint = $('engine-hint');
    if (hint) hint.textContent = '需要管理员权限才能开启调试端口。';
  }
  renderEngines();
  renderApplyState();
}

const ENGINE_INFO = {
  'runtime-inject': {
    desc: '通过 WebView2 调试端口把翻译实时注入界面，不修改应用本体。',
    tags: () => [
      { t: '不改本体', good: true },
      { t: '签名完好', good: true },
      { t: '升级不失效', good: true },
      { t: '字典即时生效', good: true },
      { t: '需管理员', bad: true },
    ],
  },
  'binary-patch': {
    desc: '解开应用内嵌资源、替换文案后重新压缩写回。一次生效，无需常驻。',
    tags: () => [
      { t: '修改本体', bad: true },
      { t: '签名失效', bad: true },
      { t: '每次更新需重打', bad: true },
      { t: '无需常驻', good: true },
    ],
  },
};

function renderEngines() {
  const box = $('engine-list');
  if (!box) return;

  if (!state.engines.length) {
    box.innerHTML = '<div class="row-value t-muted">当前平台没有可用引擎。</div>';
    return;
  }

  box.innerHTML = state.engines.map(e => {
    const meta = ENGINE_INFO[e.id] || { desc: '', tags: () => [] };
    const tags = meta.tags(e.capabilities)
      .map(x => `<span class="tag ${x.good ? 'good' : (x.bad ? 'bad' : '')}">${escapeHtml(x.t)}</span>`)
      .join('');
    const selected = state.selectedEngine === e.id;
    return `<div class="engine-item${selected ? ' selected' : ''}" data-engine="${escapeHtml(e.id)}"
      role="radio" aria-checked="${selected}" tabindex="0">
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
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectEngine(el.dataset.engine);
      }
    });
  });
}

function selectEngine(id) {
  state.selectedEngine = id;
  const hint = $('engine-hint');
  if (hint) hint.textContent = id === 'runtime-inject' ? '需要管理员权限才能开启调试端口。' : '';
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
    renderPackEmpty(r.reason);
    updateStats();
    renderApplyState();
    return;
  }

  state.pack = r;
  renderPack();
  updateStats();
  renderApplyState();
}

/** 字典包缺失时的占位渲染 */
function renderPackEmpty(reason) {
  const dot = $('dict-dot');
  if (dot) dot.className = 'status-dot lg err';

  const title = $('dict-title');
  if (title) title.textContent = '未安装字典包';

  const sub = $('dict-sub');
  if (sub) sub.textContent = reason || '请导入字典包后才能执行汉化';

  for (const id of ['dict-count-texts', 'dict-count-patterns',
                    'dict-count-attrs', 'dict-count-attr-patterns']) {
    const el = $(id);
    if (el) { el.textContent = '0'; el.className = 'stat-value dim'; }
  }

  const verifyBadge = $('dict-verify-badge');
  if (verifyBadge) { verifyBadge.className = 'badge err'; verifyBadge.textContent = '未安装'; }

  for (const [id, val] of [
    ['dict-version', '—'], ['dict-locale', '—'], ['dict-compat', '—'], ['dict-payload-size', '—'],
  ]) {
    const el = $(id);
    if (el) el.textContent = val;
  }

  const signBadge = $('dict-sign-badge');
  if (signBadge) { signBadge.className = 'badge'; signBadge.textContent = '—'; }
}

function renderPack() {
  const p = state.pack;
  const m = p.meta || {};
  const c = p.counts || {};

  // 顶部概览条
  const dot = $('dict-dot');
  if (dot) dot.className = 'status-dot lg ok';

  const title = $('dict-title');
  if (title) title.textContent = `字典包 v${m.packVersion || '?'} 已就绪`;

  const sub = $('dict-sub');
  if (sub) {
    const total = (c.texts || 0) + (c.patterns || 0) + (c.attrs || 0) + (c.attrPatterns || 0);
    sub.textContent = `共 ${total} 条翻译规则 · 签名与哈希校验通过`;
  }

  // 四类条目统计（带数字过渡）
  const counts = [
    ['dict-count-texts', c.texts],
    ['dict-count-patterns', c.patterns],
    ['dict-count-attrs', c.attrs],
    ['dict-count-attr-patterns', c.attrPatterns],
  ];
  for (const [id, n] of counts) {
    const el = $(id);
    if (!el) continue;
    el.className = 'stat-value';
    animateNumber(el, n || 0);
  }

  // 校验徽章
  const verifyBadge = $('dict-verify-badge');
  if (verifyBadge) {
    verifyBadge.className = 'badge ok';
    verifyBadge.textContent = '校验通过';
  }
  const signBadge = $('dict-sign-badge');
  if (signBadge) {
    signBadge.className = 'badge ok';
    signBadge.innerHTML = 'Ed25519 通过';
  }

  // 包信息
  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  setText('dict-version', 'v' + (m.packVersion || '?'));
  setText('dict-locale', m.locale || 'zh-CN');

  const compat = m.appCompat || {};
  const compatText = (compat.min || compat.max)
    ? `${compat.min || '不限'} ~ ${compat.max || '不限'}`
    : '不限版本';
  setText('dict-compat', compatText);

  if (m.payload && m.payload.size) {
    const kb = m.payload.size / 1024;
    setText('dict-payload-size', kb >= 1024
      ? (kb / 1024).toFixed(1) + ' MB'
      : kb.toFixed(1) + ' KB');
  } else {
    setText('dict-payload-size', '—');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

async function loadSettings() {
  const r = await window.api.getSettings();
  state.settings = r.data;

  const setCheck = (id, v) => {
    const el = $(id);
    if (el) el.checked = !!v;
  };

  setCheck('set-launch-after-apply', r.data.launchCopilotAfterApply);
  setCheck('set-auto-restart', r.data.autoRestartCopilot !== false);
  setCheck('set-close-on-revert', r.data.closeCopilotOnRevert !== false);
  setCheck('set-auto-inject', r.data.autoInjectOnStart);
  setCheck('set-run-at-login', r.data.runAtLogin);
  setCheck('set-minimize-tray', r.data.minimizeToTray);
  setCheck('set-motion', (r.data.motion || 'on') !== 'off');

  const dirEl = $('settings-datadir');
  if (dirEl) dirEl.textContent = state.env.userDir || '';

  // 同步主题到 DOM（主进程保存的值是唯一真相）
  ThemeController.syncFromSettings(r.data);
  if (themeSegmented) themeSegmented.set(r.data.theme || 'system');
  if (glassSelect) glassSelect.set(r.data.glass || 'normal');

  // 间隔下拉
  if (!intervalSelect) {
    intervalSelect = initSelect('sel-interval', (val) => {
      patchSettings({ watchIntervalMs: Number(val) });
    });
  }
  if (intervalSelect) {
    intervalSelect.set(String(r.data.watchIntervalMs));
    intervalSelect.setEnabled(!!r.data.autoInjectOnStart);
  }

  if (!r.autostartSupported) {
    const el = $('set-run-at-login');
    if (el) el.disabled = true;
    const hint = $('autostart-hint');
    if (hint) hint.textContent = '当前平台不支持';
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
  if (r.ok) {
    setStatus('已恢复默认设置');
    Toast.ok('已恢复默认设置');
    await loadSettings();
  }
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

  if (state.sys && state.sys.elevated === false) {
    showResult('err',
      '需要管理员权限才能汉化。\n\n请点击右上角「以管理员身份重启」，或关闭程序后右键选择「以管理员身份运行」。');
    return;
  }

  clearResult();
  setBusy(true, '正在汉化…');
  const btn = $(btnId);
  if (btn) btn.classList.add('is-loading');

  // 启动流程可视化：概览页与汉化页各有一套进度显示
  resetFlow();
  flowState.running = true;
  flowState.currentStep = 1;
  advanceFlow(0);

  // 如果在汉化页，自动滚动到流程区，让用户能看到阶段推进
  if (state.page === 'translate') {
    const flowEl = $('flow-steps');
    if (flowEl) {
      requestAnimationFrame(() => {
        flowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  setProgress(0, '准备中…');
  showTranslateProgress(0, '准备中…');

  const target = { exePath: state.target.exePath, version: state.target.version };
  const r = await window.api.apply(state.selectedEngine, target, state.pack.dict);

  if (btn) btn.classList.remove('is-loading');
  setBusy(false, r.ok ? '汉化完成' : '汉化未完成');

  if (r.ok) {
    setProgress(100, '完成');
    showTranslateProgress(100, '完成');
    completeFlow();
    const stats = r.stats || {};
    const acts = (r.actions || []).length ? '\n' + r.actions.join('\n') : '';
    showResult('ok',
      `汉化已生效：替换 ${stats.replaced || 0} 处文案${acts}\n\n已验证通过，可以正常使用 GitHub Copilot。`);
    Toast.ok('汉化完成', `替换 ${stats.replaced || 0} 处文案`);
    // 注入成功后刷新检测状态
    setTimeout(refreshChecks, 400);
  } else {
    hideProgress();
    hideTranslateProgress();
    failFlow();
    let msg = r.reason || '未知原因';
    if (r.code === 'NO_ADMIN') msg += '\n\n请点击右上角「以管理员身份重启」。';
    showResult('err', msg);
  }
}

/** 汉化页专用进度条（与概览页独立） */
function showTranslateProgress(pct, msg) {
  const wrap = $('translate-progress');
  if (!wrap) return;
  wrap.hidden = false;
  const fill = $('translate-progress-fill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const text = $('translate-progress-text');
  if (text && msg) text.textContent = msg;
}

function hideTranslateProgress() {
  const wrap = $('translate-progress');
  if (wrap) wrap.hidden = true;
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
  Toast.info('已还原英文');
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
    Toast.ok('字典包已更新', `版本 ${r.meta.packVersion}`);
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
  if (!box) return;

  // 扫描中状态
  const dot = $('cleanup-dot');
  const title = $('cleanup-title');
  const sub = $('cleanup-sub');
  const badge = $('cleanup-badge');
  if (dot) dot.className = 'status-dot lg busy';
  if (title) title.textContent = '正在扫描…';
  if (sub) sub.textContent = '检查注册表策略、用户数据、缓存与自启项';
  if (badge) { badge.className = 'badge'; badge.textContent = '扫描中'; }

  box.className = 'audit-box';
  box.textContent = '正在检查…';

  const r = await window.api.cleanupAudit();

  // ---- 无残留 ----
  if (!r.total) {
    if (dot) dot.className = 'status-dot lg ok';
    if (title) title.textContent = '系统干净';
    if (sub) sub.textContent = '未发现任何由本工具产生的残留';
    if (badge) { badge.className = 'badge ok'; badge.textContent = '无残留'; }

    box.className = 'audit-box clean';
    box.innerHTML = `${icon('check', 16)}<span>未发现残留，系统干净</span>`;

    const btn = $('btn-cleanall');
    if (btn) btn.disabled = true;

    setCleanupCounts({ registry: 0, file: 0, total: 0, locked: 0 });
    return;
  }

  // ---- 有残留 ----
  if (dot) dot.className = 'status-dot lg warn';
  if (title) title.textContent = `发现 ${r.total} 项残留`;
  if (sub) sub.textContent = '可一键清理，被占用的项目会在退出后自动删除';
  if (badge) { badge.className = 'badge warn'; badge.textContent = '待清理'; }

  const btn = $('btn-cleanall');
  if (btn) btn.disabled = false;

  // 按类别归并：注册表类 vs 文件类
  let registryCount = 0;
  let fileCount = 0;
  let lockedCount = 0;

  const rows = r.traces.map(t => {
    const isRegistry = t.items.some(i => i.hive || i.value);
    if (isRegistry) registryCount++;
    else fileCount++;

    if (t.items.some(i => i.locked)) lockedCount++;

    const details = t.items.map(i => {
      if (i.path) {
        const lockedMark = i.locked ? ' <span class="badge warn">占用中</span>' : '';
        return `${escapeHtml(i.path)}${i.files !== undefined ? ` (${i.files} 个文件)` : ''}${lockedMark}`;
      }
      if (i.hive) return `${escapeHtml(i.hive)} · ${escapeHtml(i.value)}`;
      return escapeHtml(JSON.stringify(i));
    }).join('<br>');

    return `<div class="audit-item">
      <div class="audit-label">${escapeHtml(t.label)}</div>
      <div class="audit-detail">${details}</div>
    </div>`;
  }).join('');

  box.innerHTML = `<div class="audit-head">发现 ${r.total} 项残留</div>${rows}`;

  setCleanupCounts({
    registry: registryCount,
    file: fileCount,
    total: r.total,
    locked: lockedCount,
  });
}

/** 更新清理页的四个统计数字 */
function setCleanupCounts({ registry, file, total, locked }) {
  const set = (id, n, warn) => {
    const el = $(id);
    if (!el) return;
    el.className = 'stat-value' + (n > 0 ? (warn ? ' warn' : '') : '');
    animateNumber(el, n);
  };
  set('cleanup-count-registry', registry || 0, true);
  set('cleanup-count-file', file || 0, true);
  set('cleanup-count-total', total || 0, true);
  set('cleanup-count-locked', locked || 0, true);
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
    const quit = confirm('需要退出本程序才能完成最后的数据目录删除。\n\n现在退出吗？退出后剩余文件会自动清除。');
    if (quit) { window.api.quitApp(); return; }
    lines.push('');
    lines.push('提示：关闭本程序后，剩余文件会自动删除。');
  }

  await refreshAudit();
  await loadPack();
});

// ---------------------------------------------------------------------------
// 主进程事件
// ---------------------------------------------------------------------------

window.api.onProgress(({ pct, msg }) => {
  setProgress(pct, msg);
  showTranslateProgress(pct, msg);
  advanceFlow(pct);
});

window.api.onWatcherStatus((st) => {
  renderWatcher(st);
  refreshChecks();
});

window.api.onWatcherInjected((info) => {
  setStatus(`已自动汉化 Copilot（${info.replaced} 处）`);
});

window.api.onWatcherError((e) => {
  setStatus('监控提示：' + e.message);
});

window.api.onWatcherPolicyWritten((info) => {
  showResult('info',
    info.reason + '\n\n请关闭 GitHub Copilot 后重新打开，之后会自动汉化。');
  Toast.warn('需要重启 Copilot 一次', '调试端口已开启');
});

// 启动
init().catch(e => {
  showResult('err', '初始化失败：' + e.message);
});
