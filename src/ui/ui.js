// 轻量 UI 组件工具集（原生 DOM，无框架）。
//
// 这里只放真正复用的能力：
//   - Toast 通知（含队列、自动消失、动画退出）
//   - 图标（Lucide 风格内联 SVG）
//   - 数字滚动过渡
//
// 不引入组件框架：项目只有 5 个页面，手写 DOM 更可控、更小。

'use strict';

/* ==========================================================================
   Icons — Lucide 风格线性图标（stroke 1.75，24 视口）
   ========================================================================== */

const Icons = {
  check: `<path d="M20 6 9 17l-5-5"/>`,
  alert: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
  info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
  x: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  spinner: `<path d="M21 12a9 9 0 1 1-6.219-8.56"/>`,

  // 导航
  home: `<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>`,
  translate: `<path d="M4 5h10M9 3v2c0 4-2 7-5 9"/><path d="M6 12c2 3 5 5 8 6"/><path d="M13 20l4-10 4 10"/><path d="M14.5 17h5"/>`,
  book: `<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/><path d="M8 7h8M8 11h6"/>`,
  trash: `<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.42.5.75.94.91H21a2 2 0 1 1 0 4h-.09c-.44.16-.8.49-.94.91z"/>`,

  // 状态与操作
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  shieldCheck: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>`,
  play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
  rotate: `<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`,
  zap: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  refresh: `<path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16"/><path d="M3 21v-5h5"/>`,
  folder: `<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  search: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  monitor: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`,
  moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  contrast: `<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>`,
  keyboard: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>`,
  rocket: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`,
  layers: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  fileText: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
  cpu: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>`,
  plug: `<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v3a6 6 0 0 1-12 0V8z"/>`,
  terminal: `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
  scan: `<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>`,
  chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
  chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
  externalLink: `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
};

/** 生成内联 SVG 字符串 */
function icon(name, size = 16, extraClass = '') {
  const path = Icons[name];
  if (!path) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ` +
    `width="${size}" height="${size}"${extraClass ? ` class="${extraClass}"` : ''}>` +
    path + `</svg>`;
}

/* ==========================================================================
   Toast
   ========================================================================== */

const Toast = (() => {
  let host = null;
  let maxVisible = 3;
  const active = [];

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * 显示一条通知。
   * @param {object} opts { kind: 'ok'|'err'|'info'|'warn', title, message, duration }
   */
  function show(opts) {
    const kind = opts.kind || 'info';
    const duration = opts.duration === undefined ? 3600 : opts.duration;
    const h = ensureHost();

    // 超出上限时先移除最旧的
    while (active.length >= maxVisible) {
      dismiss(active[0], true);
    }

    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const iconName = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : kind === 'warn' ? 'alert' : 'info';
    el.innerHTML = `
      <span class="toast-icon">${icon(iconName, 16)}</span>
      <div class="toast-body">
        ${opts.title ? `<div class="toast-title">${escapeHtml(opts.title)}</div>` : ''}
        ${opts.message ? `<div class="toast-msg">${escapeHtml(opts.message)}</div>` : ''}
      </div>
    `;

    h.appendChild(el);
    active.push(el);

    let timer = null;
    const start = () => {
      if (duration > 0) timer = setTimeout(() => dismiss(el), duration);
    };
    el.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
    el.addEventListener('mouseleave', start);
    start();

    return el;
  }

  function dismiss(el, immediate) {
    const i = active.indexOf(el);
    if (i >= 0) active.splice(i, 1);
    if (!el || !el.parentNode) return;
    if (immediate) { el.remove(); return; }
    el.classList.add('leaving');
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 160);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    show,
    ok: (title, message, d) => show({ kind: 'ok', title, message, duration: d }),
    err: (title, message, d) => show({ kind: 'err', title, message, duration: d === undefined ? 5200 : d }),
    info: (title, message, d) => show({ kind: 'info', title, message, duration: d }),
    warn: (title, message, d) => show({ kind: 'warn', title, message, duration: d }),
    clear: () => { active.slice().forEach(e => dismiss(e, true)); },
  };
})();

/* ==========================================================================
   数字过渡（轻量）
   ========================================================================== */

/**
 * 让数字从当前值平滑过渡到目标值。
 * 只用于概览页的统计数字，避免频繁调用。
 */
function animateNumber(el, to, duration = 420) {
  if (!el) return;
  const from = Number(el.dataset.value || 0);
  const target = Number(to);
  if (!Number.isFinite(target)) { el.textContent = to; return; }
  if (from === target) { el.textContent = String(target); return; }

  el.dataset.value = String(target);

  // 尊重减少动效
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOff = document.documentElement.dataset.motion === 'off';
  if (reduce || motionOff || duration <= 0) {
    el.textContent = String(target);
    return;
  }

  const start = performance.now();
  const diff = target - from;
  let raf = 0;

  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + diff * eased));
    if (p < 1) raf = requestAnimationFrame(tick);
    else el.textContent = String(target);
  };
  cancelAnimationFrame(el._raf || 0);
  raf = requestAnimationFrame(tick);
  el._raf = raf;
}

/* ==========================================================================
   Segmented Control（分段控制器）
   ========================================================================== */

const Segmented = (() => {
  const instances = new WeakMap();

  /** 把滑块移动到当前 active 项 */
  function position(container) {
    const activeEl = container.querySelector('.segmented-item.active');
    if (!activeEl) return;
    const cRect = container.getBoundingClientRect();
    const aRect = activeEl.getBoundingClientRect();
    const x = aRect.left - cRect.left - 3;   // 减 padding
    container.style.setProperty('--seg-x', x + 'px');
    container.style.setProperty('--seg-w', aRect.width + 'px');
  }

  /**
   * 初始化分段控件。
   * @param {string} id 容器 id
   * @param {(value:string)=>void} onChange
   */
  function init(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return null;

    const items = [...el.querySelectorAll('.segmented-item')];

    const activate = (value, silent) => {
      items.forEach(it => it.classList.toggle('active', it.dataset.value === value));
      requestAnimationFrame(() => position(el));
      if (!silent && onChange) onChange(value);
    };

    items.forEach(it => {
      it.addEventListener('click', () => activate(it.dataset.value, false));
      // 键盘导航
      it.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const i = items.indexOf(it);
          const next = e.key === 'ArrowRight'
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length;
          items[next].focus();
          activate(items[next].dataset.value, false);
        }
      });
    });

    const api = {
      set(value, silent = true) { activate(value, silent); },
      get() {
        const a = el.querySelector('.segmented-item.active');
        return a ? a.dataset.value : null;
      },
      reproject: () => position(el),
    };
    instances.set(el, api);

    // 首次定位（等布局稳定）
    requestAnimationFrame(() => position(el));
    // 字体加载或窗口缩放后重新定位
    window.addEventListener('resize', () => position(el), { passive: true });

    return api;
  }

  /** 主题切换等场景下重新定位所有实例 */
  function reprojectAll() {
    document.querySelectorAll('.segmented').forEach(position);
  }

  return { init, reprojectAll };
})();
