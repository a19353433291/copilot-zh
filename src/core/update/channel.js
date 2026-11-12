/**
 * 渠道选择：给定 Release 列表，按渠道挑出该用哪个。
 *
 * 渠道语义：
 *   stable  正式版 —— 只要非 prerelease 的 Release 中版本最高的那个。
 *            若仓库里全是预览版，则退回预览版里最高的（否则用户永远
 *            检查不到更新；这一点对「只发预览版」的仓库是必要的）。
 *   beta    测试版 —— 优先取版本最高的 prerelease；
 *            没有预览版时才取正式版。
 *
 * 这样两个渠道的区别是「优先看哪一类」而不是「只看哪一类」，
 * 避免某个渠道因为仓库里没对应类型而永久失效。
 */

'use strict';

/** 轻量版本比较（避免与 updater.js 循环依赖） */
function compareTag(a, b) {
  const norm = (v) => String(v || '0')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map(x => parseInt(x, 10) || 0);
  const pa = norm(a), pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** 从列表里取版本号最大的 */
function pickHighest(list) {
  if (!list.length) return null;
  return list.reduce((best, cur) => {
    const curV = String(cur.tag_name || '').replace(/^v/i, '');
    const bestV = String(best.tag_name || '').replace(/^v/i, '');
    return compareTag(curV, bestV) > 0 ? cur : best;
  });
}

/**
 * 按渠道挑选 Release。
 * @param {Array} releases  原始 Release 列表（可能含 draft）
 * @param {'stable'|'beta'} channel
 * @returns {{release: object|null, isBeta: boolean, note: string}}
 */
function pickByChannel(releases, channel) {
  const usable = (releases || []).filter(x => !x.draft);
  if (!usable.length) {
    return { release: null, isBeta: false, note: '没有可用的 Release' };
  }

  const stableList = usable.filter(x => !x.prerelease);
  const betaList = usable.filter(x => x.prerelease);

  if (channel === 'beta') {
    // 测试版：优先预览版，没有则退正式版
    if (betaList.length) {
      const r = pickHighest(betaList);
      return { release: r, isBeta: true, note: '' };
    }
    if (stableList.length) {
      const r = pickHighest(stableList);
      return { release: r, isBeta: false, note: '该仓库没有测试版，已取正式版' };
    }
    return { release: null, isBeta: false, note: '没有可用的 Release' };
  }

  // 正式版（默认）：优先正式版，没有则退预览版
  if (stableList.length) {
    const r = pickHighest(stableList);
    return { release: r, isBeta: !!r.prerelease, note: '' };
  }
  if (betaList.length) {
    const r = pickHighest(betaList);
    return {
      release: r,
      isBeta: true,
      note: '该仓库目前只有预览版，已取最新的预览版',
    };
  }
  return { release: null, isBeta: false, note: '没有可用的 Release' };
}

module.exports = { compareTag, pickHighest, pickByChannel };
