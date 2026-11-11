// 平台抽象层：定义所有汉化引擎必须实现的统一接口。
// 未来新增 macOS/Linux 时，只需在此目录下新增对应实现，核心代码无需改动。

'use strict';

/**
 * 汉化引擎接口契约。
 * 任何一种汉化实现（运行时注入 / 二进制补丁）都必须满足此接口。
 */
class I18nEngine {
  /** 引擎唯一标识 */
  get id() { throw new Error('id not implemented'); }

  /** 面向用户显示的名称 */
  get displayName() { throw new Error('displayName not implemented'); }

  /**
   * 引擎能力声明，供 UI 展示与安全提示。
   * @returns {{
   *   modifiesApp: boolean,      // 是否修改应用本体
   *   breaksSignature: boolean,  // 是否破坏数字签名
   *   survivesUpgrade: boolean,  // 应用升级后是否仍然有效
   *   needsResidentProcess: boolean, // 是否需要常驻进程
   *   needsDebugPort: boolean,   // 是否需要开启调试端口
   *   dictUpdateLive: boolean,   // 字典更新是否即时生效（无需重新应用）
   *   revertible: boolean        // 是否可完整还原
   * }}
   */
  capabilities() { throw new Error('capabilities not implemented'); }

  /**
   * 探测目标应用是否可被本引擎处理。
   * @param {object} target { exePath, version }
   * @returns {Promise<{ok: boolean, reason?: string, details?: object}>}
   */
  async probe(target) { throw new Error('probe not implemented'); }

  /**
   * 应用汉化。
   * @param {object} target { exePath, version }
   * @param {object} dict   已校验的字典包内容
   * @param {object} opts   { onProgress(percent, message) }
   * @returns {Promise<{ok: boolean, stats?: object, reason?: string}>}
   */
  async apply(target, dict, opts) { throw new Error('apply not implemented'); }

  /**
   * 撤销汉化，恢复原始状态。
   * @param {object} target
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async revert(target) { throw new Error('revert not implemented'); }

  /**
   * 查询当前应用上的汉化状态。
   * @param {object} target
   * @returns {Promise<{state: 'none'|'applied'|'partial'|'unknown', info?: object}>}
   */
  async status(target) { throw new Error('status not implemented'); }
}

/** 目标应用信息 */
class TargetApp {
  constructor(exePath, version) {
    this.exePath = exePath;
    this.version = version;
  }
}

/**
 * 平台注册表：按 process.platform 选择实现。
 * 目前仅实现 win32；darwin / linux 为将来预留。
 */
const registry = new Map();

function register(platform, factory) {
  registry.set(platform, factory);
}

function createEngines(platform = process.platform) {
  const factory = registry.get(platform);
  if (!factory) return [];
  return factory();
}

function supportedPlatforms() {
  return [...registry.keys()];
}

module.exports = { I18nEngine, TargetApp, register, createEngines, supportedPlatforms };
