// 更新 UI 逻辑（渲染进程）
//
// 职责：
//   - 绑定设置页的更新控件
//   - 订阅主进程推送的状态
//   - 驱动「检查 → 下载 → 安装」按钮状态机
//
// 该模块由 renderer.js 在初始化时调用 initUpdateUI()。

'use strict';

const UpdateUI = (() => {
  let sourceSelect = null;
  let hoursSelect = null;
  let currentStatus = null;
  let busy = false;
  // 用户是否主动点过「检查更新」。
  // 决定错误是否展示：主动检查失败要告知用户，后台静默检查失败不必打扰。
  let userInitiated = false;

  const $ = (id) => document.getElementById(id);

  /* ---------- 状态渲染 ---------- */

  function renderStatus(st) {
    currentStatus = st;
    if (!st) return;

    const badge = $('update-badge');
    const currentEl = $('update-current');
    const row = $('row-update-progress');
    const title = $('update-progress-title');
    const desc = $('update-progress-desc');
    const wrap = $('update-progress-wrap');
    const fill = $('update-progress-fill');
    const actionBtn = $('btn-update-action');
    const cancelBtn = $('btn-update-cancel');
    const checkBtn = $('btn-update-check');

    // 当前版本
    if (currentEl) {
      currentEl.textContent = 'v' + (st.currentVersion || '—') + ' · 更新源：' + sourceName(st.sourceId);
    }

    // 徽章：没有实质状态时整体隐藏，不显示「—」这种空占位
    // （用户反馈过那个短横线看起来像一条莫名其妙的线）
    if (badge) {
      const map = {
        idle: ['', '已是最新'],
        checking: ['info', '检查中'],
        available: ['info', '有新版本'],
        downloading: ['info', '下载中'],
        ready: ['ok', '可安装'],
        error: ['err', '检查失败'],
      };
      const [kind, text] = map[st.state] || ['', ''];
      const hasMeaning = st.state !== 'idle' || Boolean(st.latestVersion);
      if (hasMeaning && text) {
        badge.className = 'badge' + (kind ? ' ' + kind : '');
        badge.textContent = text;
        badge.hidden = false;
      } else {
        badge.className = 'badge';
        badge.textContent = '';
        badge.hidden = true;
      }
    }

    // 进度行可见性
    // 注意：启动时的后台自动检查失败不应打扰用户，
    // 只在用户主动点「检查更新」后才把错误展示出来。
    const isBackgroundError = st.state === 'error' && !userInitiated;
    const showRow = ['checking', 'available', 'downloading', 'ready', 'error'].includes(st.state)
                    && !isBackgroundError;
    if (row) row.hidden = !showRow;

    if (!showRow) {
      // 后台检查失败：徽章也不报错，保持中性
      if (badge && isBackgroundError) {
        badge.className = 'badge';
        badge.textContent = '';
        badge.hidden = true;
      }
      return;
    }

    // 主按钮
    if (actionBtn) {
      actionBtn.hidden = false;
      actionBtn.disabled = busy;
      if (st.state === 'available') {
        actionBtn.textContent = '下载并安装';
        actionBtn.className = 'btn btn-sm btn-primary';
      } else if (st.state === 'ready') {
        actionBtn.textContent = '立即安装';
        actionBtn.className = 'btn btn-sm btn-primary';
      } else if (st.state === 'error') {
        actionBtn.textContent = '重试';
        actionBtn.className = 'btn btn-sm';
      } else {
        actionBtn.hidden = true;
      }
    }

    // 取消按钮：仅下载中/就绪时显示
    if (cancelBtn) {
      cancelBtn.hidden = !(st.state === 'downloading' || st.state === 'ready');
      cancelBtn.disabled = busy && st.state !== 'downloading';
    }

    // 检查按钮
    if (checkBtn) {
      checkBtn.disabled = busy || st.state === 'checking' || st.state === 'downloading';
      checkBtn.textContent = st.state === 'checking' ? '检查中…' : '检查更新';
    }

    // 标题与描述
    if (title && desc) {
      switch (st.state) {
        case 'checking':
          title.textContent = '正在检查更新…';
          desc.textContent = '通过 ' + sourceName(st.sourceId) + ' 查询最新版本';
          break;
        case 'available':
          title.textContent = '发现新版本 v' + st.latestVersion;
          desc.textContent = '当前 v' + st.currentVersion
            + (st.publishedAt ? ' · 发布于 ' + formatDate(st.publishedAt) : '');
          break;
        case 'downloading':
          title.textContent = '正在下载更新…';
          desc.textContent = '请保持网络连接，下载完成后会自动校验完整性';
          break;
        case 'ready':
          title.textContent = '安装包已就绪';
          desc.textContent = '点击「立即安装」后应用会退出并启动安装程序';
          break;
        case 'error':
          title.textContent = '更新检查失败';
          desc.textContent = st.lastError || '未知错误';
          break;
        default:
          title.textContent = '';
          desc.textContent = '';
      }
    }

    // 进度条
    if (wrap && fill) {
      const showProgress = st.state === 'downloading' && typeof st.progress === 'number';
      wrap.hidden = !showProgress;
      if (showProgress) {
        fill.style.width = st.progress + '%';
      }
    }
  }

  function sourceName(id) {
    const map = { github: 'GitHub', gitee: 'Gitee', generic: '自定义源' };
    return map[id] || id || 'GitHub';
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('zh-CN');
    } catch (e) { return ''; }
  }

  /* ---------- 动作 ---------- */

  async function doCheck() {
    if (busy) return;
    userInitiated = true;
    busy = true;
    renderStatus({ ...(currentStatus || {}), state: 'checking' });
    try {
      const r = await window.api.updateCheck();
      if (!r.ok) {
        Toast.err('检查更新失败', r.reason || '未知原因');
      } else if (r.hasUpdate) {
        Toast.info('发现新版本 v' + r.latestVersion, '可在设置中下载');
      } else {
        Toast.ok('已是最新版本', 'v' + r.currentVersion);
      }
    } catch (e) {
      Toast.err('检查更新失败', e.message);
    } finally {
      busy = false;
      const st = await window.api.updateStatus();
      renderStatus(st);
    }
  }

  async function doDownload() {
    if (busy) return;
    busy = true;
    renderStatus({ ...(currentStatus || {}), state: 'downloading', progress: 0 });
    try {
      const r = await window.api.updateDownload();
      if (!r.ok) {
        Toast.err('下载失败', r.reason || '未知原因');
      } else {
        Toast.ok('下载完成', '安装包已校验通过');
      }
    } catch (e) {
      Toast.err('下载失败', e.message);
    } finally {
      busy = false;
      const st = await window.api.updateStatus();
      renderStatus(st);
    }
  }

  async function doInstall() {
    const ok = await Dialog.confirm({
      title: '即将安装新版本',
      message: '应用会自动退出并启动安装程序。',
      note: '安装完成后可重新打开使用。',
      confirmText: '立即安装',
      cancelText: '取消',
    });
    if (!ok) return;

    busy = true;
    const r = await window.api.updateInstall();
    if (!r.ok) {
      busy = false;
      Toast.err('启动安装失败', r.reason || '未知原因');
      return;
    }
    // 主进程会退出应用，这里不需要做什么
  }

  async function doCancel() {
    const ok = await Dialog.confirm({
      title: '取消下载？',
      message: '已下载的安装包会被删除，需要重新下载。',
      confirmText: '取消下载',
      cancelText: '继续下载',
      danger: true,
    });
    if (!ok) return;
    await window.api.updateCancel();
    const st = await window.api.updateStatus();
    renderStatus(st);
    Toast.info('已取消');
  }

  /* ---------- 初始化 ---------- */

  function init() {
    const checkBtn = $('btn-update-check');
    const actionBtn = $('btn-update-action');
    const cancelBtn = $('btn-update-cancel');
    const customRow = $('row-update-custom');
    const customInput = $('input-update-url');

    if (checkBtn) checkBtn.addEventListener('click', doCheck);

    if (actionBtn) {
      actionBtn.addEventListener('click', async () => {
        const st = currentStatus;
        if (!st) return;
        if (st.state === 'available') await doDownload();
        else if (st.state === 'ready') await doInstall();
        else if (st.state === 'error') await doCheck();
      });
    }

    if (cancelBtn) cancelBtn.addEventListener('click', doCancel);

    // 更新渠道切换（正式版 / 测试版）
    initChannelSegmented();

    // 更新源下拉
    indexSelectSource(customRow, customInput);

    // 定时检查间隔
    indexSelectHours();

    // 启动检查开关
    const startToggle = $('set-check-on-start');
    if (startToggle) {
      startToggle.addEventListener('change', async (e) => {
        await window.api.setSettings({ checkUpdateOnStart: e.target.checked });
      });
    }

    // 自定义地址输入
    if (customInput) {
      let t = null;
      customInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const v = customInput.value.trim();
          await window.api.setSettings({ updateCustomUrl: v });
        }, 600);
      });
    }

    // 订阅主进程推送
    window.api.onUpdateStatus((st) => renderStatus(st));
    window.api.onUpdateLog(() => { /* 日志暂不展示，保留接口 */ });
    window.api.onUpdateAvailable((info) => {
      Toast.info('发现新版本 v' + info.latestVersion, '设置页可下载更新');
    });
    window.api.onUpdateReady(() => {
      Toast.ok('更新已下载', '可在设置页安装');
    });

    // 首次拉取状态
    window.api.updateStatus().then(renderStatus).catch(() => {});
  }

  /**
   * 更新渠道分段控件。
   * 正式版只取非 prerelease 的发布；测试版优先取 prerelease。
   * 切换后立即重新检查一次，让用户马上看到结果差异。
   *
   * 滑块定位交给通用的 Segmented 模块（ui.js），
   * 不要在这里自己算 --seg-x/--seg-w ——
   * 两边 padding 基准不一致会导致滑块宽度为 0。
   */
  function initChannelSegmented() {
    const el = $('seg-channel');
    if (!el) return;

    const items = [...el.querySelectorAll('.segmented-item')];

    const applyValue = (val) => {
      items.forEach(it => {
        const on = it.dataset.value === val;
        it.classList.toggle('active', on);
        it.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      // 让 Segmented 重新定位滑块。
      // 注意接口只有 init / reprojectAll（没有 refresh）。
      // 重排可能受页面滚动影响，用 setTimeout 而非 rAF：
      // 窗口隐藏时 rAF 会被冻结（CDP 截图场景尤其明显）。
      setTimeout(() => {
        if (window.Segmented && typeof window.Segmented.reprojectAll === 'function') {
          window.Segmented.reprojectAll();
        }
      }, 30);
    };

    items.forEach(it => {
      it.addEventListener('click', () => {
        applyValue(it.dataset.value);
        window.api.setSettings({ updateChannel: it.dataset.value }).then(() => {
          Toast.info(it.dataset.value === 'beta' ? '已切换到测试版渠道' : '已切换到正式版渠道');
          doCheck();
        }).catch(() => {});
      });
    });

    // 读取当前设置
    window.api.getSettings().then((r) => {
      const v = (r.data && r.data.updateChannel) || 'stable';
      applyValue(v);
    }).catch(() => {});
  }

  /**
   * 更新源下拉：自己做，因为切换时还要控制自定义地址行的显隐。
   */
  function indexSelectSource(customRow, customInput) {
    const wrap = $('sel-update-source');
    if (!wrap) return;
    const trigger = wrap.querySelector('.select-trigger');
    const menu = wrap.querySelector('.select-menu');
    const label = wrap.querySelector('.select-label');

    const syncCustomRow = (val) => {
      const isCustom = val === 'generic';
      if (customRow) customRow.hidden = !isCustom;
    };

    const close = () => {
      menu.hidden = true;
      trigger.classList.remove('open');
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll('.select-menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.select-trigger').forEach(tm => tm.classList.remove('open'));
      document.querySelectorAll('.stack-raised').forEach(el => el.classList.remove('stack-raised'));
      if (willOpen) {
        menu.hidden = false;
        trigger.classList.add('open');
        // 提升祖先卡片层级，避免被遮挡
        let el = wrap.parentElement;
        while (el && el !== document.body) {
          if (el.classList && (el.classList.contains('group') || el.classList.contains('card'))) {
            el.classList.add('stack-raised');
          }
          el = el.parentElement;
        }
      }
    });

    menu.querySelectorAll('.select-option').forEach(opt => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        trigger.dataset.value = val;
        if (label) label.textContent = opt.textContent.trim();
        menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        close();
        syncCustomRow(val);
        await window.api.setSettings({ updateSource: val });
        Toast.info('更新源已切换为 ' + sourceName(val));
        // 切换源后重新检查一次
        doCheck();
      });
    });

    document.addEventListener('click', close);

    // 初始同步一次
    window.api.getSettings().then((r) => {
      const val = (r.data && r.data.updateSource) || 'github';
      trigger.dataset.value = val;
      const opt = menu.querySelector(`.select-option[data-value="${val}"]`);
      if (opt) {
        menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        if (label) label.textContent = opt.textContent.trim();
      }
      syncCustomRow(val);
      if (customInput && r.data && r.data.updateCustomUrl) {
        customInput.value = r.data.updateCustomUrl;
      }
    }).catch(() => {});
  }

  /** 定时检查间隔下拉 */
  function indexSelectHours() {
    const wrap = $('sel-update-hours');
    if (!wrap) return;
    const trigger = wrap.querySelector('.select-trigger');
    const menu = wrap.querySelector('.select-menu');
    const label = wrap.querySelector('.select-label');

    const close = () => { menu.hidden = true; trigger.classList.remove('open'); };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll('.select-menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.select-trigger').forEach(tm => tm.classList.remove('open'));
      document.querySelectorAll('.stack-raised').forEach(el => el.classList.remove('stack-raised'));
      if (willOpen) {
        menu.hidden = false;
        trigger.classList.add('open');
        let el = wrap.parentElement;
        while (el && el !== document.body) {
          if (el.classList && (el.classList.contains('group') || el.classList.contains('card'))) {
            el.classList.add('stack-raised');
          }
          el = el.parentElement;
        }
      }
    });

    menu.querySelectorAll('.select-option').forEach(opt => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        trigger.dataset.value = val;
        if (label) label.textContent = opt.textContent.trim();
        menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        close();
        await window.api.setSettings({ updateCheckHours: Number(val) });
        Toast.info('后台检查间隔：' + opt.textContent.trim());
      });
    });

    document.addEventListener('click', close);

    window.api.getSettings().then((r) => {
      const v = String((r.data && r.data.updateCheckHours) ?? 6);
      trigger.dataset.value = v;
      const opt = menu.querySelector(`.select-option[data-value="${v}"]`);
      if (opt) {
        menu.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        if (label) label.textContent = opt.textContent.trim();
      }
    }).catch(() => {});
  }

  return {
    init,
    renderStatus,
    /**
     * 仅供测试使用：把内部状态复位。
     * 正常运行时不需要调用。
     */
    _resetForTest() {
      userInitiated = false;
      busy = false;
      window.api.updateStatus().then(renderStatus).catch(() => {});
    },
  };
})();

// 暴露给 renderer.js 调用
window.UpdateUI = UpdateUI;
