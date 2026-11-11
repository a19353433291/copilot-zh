// Windows 平台注册入口。
// 未来新增 macOS/Linux：新建 platforms/darwin/index.js，用同样方式注册即可。

'use strict';

const path = require('path');
const { register } = require('../engine');

const WIN32_NS = 'win32';

function registerWin32() {
  register(WIN32_NS, () => {
    const engines = [];
    // 模式 A：运行时注入（已实现）
    try {
      const { RuntimeInjectEngine } = require('./runtimeInject');
      engines.push(new RuntimeInjectEngine());
    } catch (e) {
      console.error('[platform] 加载运行时注入引擎失败:', e.message);
    }
    // 模式 B：二进制补丁（后续接入）
    // try {
    //   const { BinaryPatchEngine } = require('./binaryPatch');
    //   engines.push(new BinaryPatchEngine());
    // } catch (e) { ... }
    return engines;
  });
}

module.exports = { registerWin32, WIN32_NS };
