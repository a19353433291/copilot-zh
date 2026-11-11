// 设置持久化：保存在用户数据目录下，与字典包分离。
//
// 设计要点：
// - 所有读写都有默认值兜底，文件损坏不会导致程序崩溃
// - 写入采用「临时文件 + 原子改名」，避免断电产生半截文件
// - 新增设置项只需在 DEFAULTS 里加一行

'use strict';

const fs = require('fs');
const path = require('path');

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
