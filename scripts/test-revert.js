// 测试还原：验证自动关闭 Copilot + 状态同步
const path = require('path');
const { execFile } = require('child_process');

const root = path.resolve(__dirname, '..');
const { registerWin32 } = require('../src/core/platform/win32');
const { createEngines } = require('../src/core/platform/engine');
const { findCopilotPids } = require('../src/core/watcher');
const cdp = require('../src/core/platform/win32/runtimeInject');

registerWin32();
const engine = createEngines('win32').find(e => e.id === 'runtime-inject');

function taskkill() {
  return new Promise((resolve) => {
    execFile('taskkill', ['/IM', 'github.exe', '/T', '/F'],
      { timeout: 10000, windowsHide: true }, (err) => resolve(!err));
  });
}

(async () => {
  console.log('=== 还原前状态 ===');
  const pidsBefore = await findCopilotPids();
  console.log('  Copilot PID:', pidsBefore.length ? pidsBefore.join(',') : '未运行');
  const policyBefore = cdp.readPolicy('github.exe');
  console.log('  调试策略:', policyBefore || '无');
  const alive = await cdp.queryTranslatorAlive(9222);
  console.log('  翻译器存活:', alive);

  console.log('\n=== 执行还原（模拟界面点「还原英文」）===');
  const r = await engine.revert({ exePath: 'github.exe', version: null });
  console.log('  还原结果:', JSON.stringify(r, null, 1));

  console.log('\n=== 按设置自动关闭 Copilot ===');
  // 模拟主进程逻辑：closeCopilotOnRevert 默认开启
  const pids2 = await findCopilotPids();
  if (pids2.length) {
    const killed = await taskkill();
    console.log('  已关闭 Copilot:', killed);
    await new Promise(r2 => setTimeout(r2, 3000));
  } else {
    console.log('  Copilot 未运行，无需关闭');
  }

  console.log('\n=== 还原后验证 ===');
  const policyAfter = cdp.readPolicy('github.exe');
  console.log('  调试策略:', policyAfter || '无（已清除）✓');
  const pidsAfter = await findCopilotPids();
  console.log('  Copilot 进程:', pidsAfter.length ? '仍在运行 ✗' : '已关闭 ✓');
  const portReady = await cdp.isPortReady(9222);
  console.log('  调试端口:', portReady ? '仍开放 ✗' : '已关闭 ✓');

  const allOk = !policyAfter && !pidsAfter.length && !portReady;
  console.log('\n结论:', allOk ? '★★★ 还原彻底且自动关闭 Copilot ★★★' : '✗ 有未清理项');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
