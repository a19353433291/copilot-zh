// 主题控制器：管理 light / dark / system 三种模式 + 动效与玻璃强度偏好。
//
// 设计原则：
//   - 主题状态通过 <html data-theme> 驱动，CSS 负责实际渲染
//   - system 模式完全交给 CSS 的 prefers-color-scheme，无需 JS 监听
//   - 用户选择持久化到现有 settings.json（走 preload 白名单 IPC）
//   - 首屏渲染前应用主题，避免「闪白」
//
// 注意：本文件不直接访问 Node.js，只调用 window.api。

'use strict';

const ThemeController = (() => {
  const VALID_THEMES = ['light', 'dark', 'system'];
  const VALID_MOTION = ['on', 'off'];
  const VALID_GLASS = ['off', 'normal', 'strong'];

  let current = { theme: 'system', motion: 'on', glass: 'normal' };

  /** 把偏好写入 DOM（CSS 据此渲染） */
  function applyToDom(pref) {
    const root = document.documentElement;
    root.dataset.theme = VALID_THEMES.includes(pref.theme) ? pref.theme : 'system';
    root.dataset.motion = VALID_MOTION.includes(pref.motion) ? pref.motion : 'on';
    root.dataset.glass = VALID_GLASS.includes(pref.glass) ? pref.glass : 'normal';
  }

  /** 解析当前实际生效的主题（system 时读系统设置） */
  function effectiveTheme() {
    if (current.theme !== 'system') return current.theme;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  /**
   * 渲染前尽早应用（避免首屏闪烁）。
   * 此时 settings 还没从主进程读回来，先用 localStorage 里的缓存值。
   * localStorage 只作为「首屏提示」，真实值随后由主进程覆盖。
   */
  function applyEarlyHint() {
    try {
      const raw = localStorage.getItem('cz-theme-hint');
      if (!raw) {
        applyToDom({ theme: 'system', motion: 'on', glass: 'normal' });
        return;
      }
      const parsed = JSON.parse(raw);
      applyToDom(parsed);
      current = { ...current, ...parsed };
    } catch (e) {
      applyToDom({ theme: 'system', motion: 'on', glass: 'normal' });
    }
  }

  /** 设置完整偏好（同时更新 DOM 与缓存） */
  function set(pref) {
    current = { ...current, ...pref };
    applyToDom(current);
    try {
      localStorage.setItem('cz-theme-hint', JSON.stringify(current));
    } catch (e) { /* 隐私模式下可能失败，忽略 */ }
    emitChange();
  }

  /** 从设置对象同步 */
  function syncFromSettings(data) {
    set({
      theme: data.theme || 'system',
      motion: data.motion || 'on',
      glass: data.glass || 'normal',
    });
  }

  function get() { return { ...current }; }

  function emitChange() {
    try {
      window.dispatchEvent(new CustomEvent('theme:change', {
        detail: { ...current, effective: effectiveTheme() },
      }));
    } catch (e) { /* ignore */ }
  }

  /** 系统主题变化时通知（仅 system 模式需要） */
  function watchSystem() {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        if (current.theme === 'system') emitChange();
      };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    } catch (e) { /* ignore */ }
  }

  return {
    applyEarlyHint,
    syncFromSettings,
    set,
    get,
    effectiveTheme,
    watchSystem,
  };
})();

// 立即执行：在 CSS 加载后、正文渲染前设定主题
ThemeController.applyEarlyHint();
