// 统一风格的确认对话框，替代原生 confirm。
//
// 用法：
//   const ok = await Dialog.confirm({
//     title: '确定要彻底清理所有残留吗？',
//     message: '将删除...',
//     items: ['WebView2 调试端口策略', '所有字典包与用户数据', '缓存与日志'],
//     note: '清理后程序会自动退出...',
//     confirmText: '确定清理',
//     cancelText: '取消',
//     danger: true,
//   });
//
//   const ok = await Dialog.alert({ title: '提示', message: '...' });
//
// 实现要点：
//   - 类名为 .dialog-*，与现有 .card / .group 的设计语言一致
//   - 支持 ESC 关闭、点击遮罩关闭
//   - 焦点自动落在取消按钮（危险操作的安全默认）

'use strict';

const Dialog = (() => {
  let host = null;
  let activeResolve = null;
  let lastFocused = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.getElementById('dialog-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dialog-host';
      host.className = 'dialog-host';
      host.setAttribute('role', 'presentation');
      document.body.appendChild(host);
    }
    return host;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 显示对话框。
   * @returns {Promise<boolean>} 用户点确认返回 true，取消/关闭返回 false
   */
  function open(opts) {
    const {
      title = '提示',
      message = '',
      items = [],
      note = '',
      confirmText = '确定',
      cancelText = '取消',
      danger = false,
      onlyConfirm = false,
    } = opts || {};

    const h = ensureHost();
    lastFocused = document.activeElement;

    return new Promise((resolve) => {
      activeResolve = resolve;

      const itemsHtml = items.length
        ? `<ul class="dialog-list">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : '';

      const mask = document.createElement('div');
      mask.className = 'dialog-mask';
      mask.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div class="dialog-body">
            <h2 class="dialog-title" id="dialog-title">${escapeHtml(title)}</h2>
            ${message ? `<p class="dialog-message">${escapeHtml(message)}</p>` : ''}
            ${itemsHtml}
            ${note ? `<p class="dialog-note">${escapeHtml(note)}</p>` : ''}
          </div>
          <div class="dialog-actions">
            ${onlyConfirm ? '' : `<button class="btn dialog-cancel" data-act="cancel">${escapeHtml(cancelText)}</button>`}
            <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'} dialog-confirm" data-act="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      h.appendChild(mask);

      const close = (result) => {
        mask.classList.add('closing');
        const finish = () => {
          mask.remove();
          activeResolve = null;
          // 焦点回到触发前的元素
          if (lastFocused && document.body.contains(lastFocused)) {
            try { lastFocused.focus(); } catch (e) {}
          }
          resolve(result);
        };
        // 动画结束后移除；若动画被禁用则立即移除
        const dur = document.documentElement.dataset.motion === 'off' ? 0
          : (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140);
        setTimeout(finish, dur);
      };

      // 按钮事件
      mask.querySelector('[data-act="confirm"]').addEventListener('click', (e) => {
        e.stopPropagation();
        close(true);
      });
      const cancelBtn = mask.querySelector('[data-act="cancel"]');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          close(false);
        });
      }

      // 点遮罩关闭
      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(false);
      });

      // ESC 关闭 / Enter 确认
      // 注意：不能用 {once:true}，否则第一次按键（哪怕是 Tab/方向键）
      // 会消费掉监听器，导致之后 ESC 失效。
      const onKey = (e) => {
        if (!document.body.contains(mask)) {
          document.removeEventListener('keydown', onKey);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener('keydown', onKey);
          close(false);
        } else if (e.key === 'Enter') {
          // 焦点在取消按钮上时，Enter 应触发取消（危险操作的安全默认）
          const focused = document.activeElement;
          if (focused && focused.dataset && focused.dataset.act === 'cancel') {
            e.preventDefault();
            document.removeEventListener('keydown', onKey);
            close(false);
            return;
          }
          e.preventDefault();
          document.removeEventListener('keydown', onKey);
          close(true);
        }
      };
      document.addEventListener('keydown', onKey);

      // 焦点：危险操作默认落在取消上，安全操作落在确认上
      requestAnimationFrame(() => {
        const target = danger ? (cancelBtn || mask.querySelector('[data-act="confirm"]'))
                              : mask.querySelector('[data-act="confirm"]');
        if (target) target.focus();
      });
    });
  }

  return {
    /** 确认对话框（取消 + 确认） */
    confirm(opts) {
      return open({ ...opts, onlyConfirm: false });
    },
    /** 提示对话框（只有一个按钮） */
    alert(opts) {
      return open({ ...opts, onlyConfirm: true, confirmText: (opts && opts.confirmText) || '知道了' });
    },
    /** 关闭当前对话框（返回 false） */
    close() {
      if (activeResolve) activeResolve(false);
    },
  };
})();

window.Dialog = Dialog;
