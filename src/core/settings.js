// 设置持久化：保存在用户数据目录下，与字典包分离。
//
// 设计要点：
// - 所有读写都有默认值兜底，文件损坏不会导致程序崩溃
// - 写入采用「临时文件 + 原子改名」，避免断电产生半截文件
// - 新增设置项只需在 DEFAULTS 里加一行

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 枚举型设置的白名单。
 * 这些设置只能取固定值，非法值会被 set() 拒绝，
 * 避免脏数据写进 settings.json 导致界面异常。
 */
const ENUMS = {
  theme: ['light', 'dark', 'system'],
  motion: ['on', 'off'],
  updateSource: ['github', 'gitee', 'generic'],
};

/**
 * 数值型设置的范围限制，防止非法值导致异常行为。
 */
const RANGES = {
  updateCheckHours: { min: 0, max: 168 },     // 0 = 不检查，最大一周
  watchIntervalMs: { min: 500, max: 60000 },
};

/** 校验某个键的值是否合法 */
function isValidValue(key, value) {
  const allowed = ENUMS[key];
  if (allowed) return allowed.includes(value);

  const range = RANGES[key];
  if (range) {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    return n >= range.min && n <= range.max;
  }

  return true;
}

const DEFAULTS = {
  /**
   * 汉化后是否自动启动 GitHub Copilot。
   * 默认开启：用户点「执行汉化」后直接看到中文界面，不用再手动开应用。
   */
  launchCopilotAfterApply: true,

  /**
   * 执行汉化时，若 Copilot 正在运行但调试端口未开启，是否自动重启它。
   * 默认开启：否则用户必须手动关掉 Copilot 才能汉化，体验断裂。
   */
  autoRestartCopilot: true,

  /**
   * 还原英文时是否自动关闭 GitHub Copilot。
   * 默认开启：还原只移除调试端口策略，已注入的翻译仍在页面内存里，
   * 必须重启 Copilot 才会真正显示英文。自动关闭后由用户或设置重新启动，
   * 避免出现「已还原但还是中文」的错觉。
   */
  closeCopilotOnRevert: true,

  /**
   * 常驻监控：Copilot 启动时自动注入翻译。
   * 这是「形态 2」的核心开关。
   */
  autoInjectOnStart: true,

  /**
   * 监控轮询间隔（毫秒）。过大导致注入延迟，过小浪费 CPU。
   * 1500ms 实测在延迟与开销之间比较平衡。
   */
  watchIntervalMs: 1500,

  /**
   * 开机自启（随系统启动汉化助手）。
   * 只有开启常驻监控时才有意义。
   */
  runAtLogin: false,

  /**
   * 关闭窗口时最小化到托盘而非退出。
   * 常驻模式下需要这个，否则关窗口就停了监控。
   */
  minimizeToTray: true,

  /**
   * 界面主题：light / dark / system
   * 默认 system：跟随 Windows 深浅色，重启后自动恢复。
   */
  theme: 'system',

  /**
   * 界面动效开关：on / off
   * off 时把过渡时长压到 1ms，保留状态切换但不做动画。
   */
  motion: 'on',

  /* ---------- 自动更新 ---------- */

  /**
   * 更新源：github / gitee / generic
   * 国内用户建议 gitee（速度快），海外用户建议 github。
   */
  updateSource: 'github',

  /** 启动时自动检查更新（延迟 5 秒，不阻塞首屏） */
  checkUpdateOnStart: true,

  /** 后台定时检查间隔（小时），0 表示不检查 */
  updateCheckHours: 6,

  /** 自定义更新源地址（updateSource = generic 时生效） */
  updateCustomUrl: '',

  /** GitHub 源仓库 owner/repo */
  updateGithubRepo: 'a19353433291/copilot-zh',

  /** Gitee 源仓库 owner/repo */
  updateGiteeRepo: 'a19353433291/copilot-zh',
};

class Settings {
  constructor(userDir) {
    this.file = path.join(userDir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) {
        this.save();
        return;
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      // 只接受已知键，避免脏数据污染
      for (const k of Object.keys(DEFAULTS)) {
        if (parsed[k] !== undefined) this.data[k] = parsed[k];
      }
    } catch (e) {
      // 文件损坏：备份后重置，不让用户卡死
      try {
        if (fs.existsSync(this.file)) {
          fs.copyFileSync(this.file, this.file + '.broken');
        }
      } catch (_) { /* ignore */ }
      this.data = { ...DEFAULTS };
      this.save();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);   // 原子替换
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  get(key) {
    return this.data[key];
  }

  getAll() {
    return { ...this.data };
  }

  /** 批量更新，返回实际变更的键 */
  set(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      if (this.data[k] === v) continue;
      // 类型校验：保持与默认值同类型
      const expect = typeof DEFAULTS[k];
      if (typeof v !== expect) continue;
      // 值域校验：枚举型设置只接受白名单值，避免脏数据导致主题失效
      if (!isValidValue(k, v)) continue;
      this.data[k] = v;
      changed.push(k);
    }
    if (changed.length) this.save();
    return { ok: true, changed, data: this.getAll() };
  }

  reset() {
    this.data = { ...DEFAULTS };
    this.save();
    return this.getAll();
  }

  static get defaults() {
    return { ...DEFAULTS };
  }
}

module.exports = { Settings, DEFAULTS };
