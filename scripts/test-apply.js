// 一键汉化端到端测试
// 场景：Copilot 未运行 / 已运行但无端口
const path = require('path');
const { spawn } = require('child_process');

const { registerWin32 } = require('../src/core/platform/win32');
const { createEngines } = require('../src/core/platform/engine');
const { applyOneClick } = require('../src/core/applyFlow');
const loc = require('../src/core/locator');
const pack = require('../src/core/dict/pack');
const { findCopilotPids } = require('../src/core/watcher');

registerWin32();
const engine = createEngines('win32').find(e => e.id === 'runtime-inject');

async function launchCopilot() {
  const t = await loc.locateApp();
  if (!t.ok) return { ok: false, reason: t.reason };
  const c = spawn(t.exePath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(t.exePath) });
  c.unref();
  return { ok: true, exePath: t.exePath };
}

(async () => {
  const t = await loc.locateApp();
  console.log('目标:', t.exePath, t.version);

  const p = pack.loadPack(path.join(process.env.APPDATA, 'copilot-zh', 'packs', 'current'));
  console.log('字典:', p.ok ? JSON.stringify(pack.countEntries(p.dict)) : p.reason);
  if (!p.ok) process.exit(1);

  const pids = await findCopilotPids();
  console.log('当前 Copilot 进程:', pids.length ? pids.join(',') : '未运行');

  console.log('\n=== 开始一键汉化 ===');
  const started = Date.now();
  const r = await applyOneClick({
    engine,
    target: { exePath: t.exePath, version: t.version },
    dict: p.dict,
    launchCopilot,
    findPids: findCopilotPids,
    onProgress: (pct, msg) => console.log(`  [${String(pct).padStart(3)}%] ${msg}`),
  });

  console.log(`\n耗时: ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  console.log('结果:', JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
