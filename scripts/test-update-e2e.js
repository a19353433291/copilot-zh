// 端到端更新流程测试：本地起 HTTP 服务模拟更新源
// 验证：检查 → 下载 → sha512 校验 → 篡改检测 → 安装包准备

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { UpdateManager } = require('../src/core/update/updater');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const TMP = path.join(os.tmpdir(), 'cz-update-test-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

// 造一个假安装包
const fakeExe = Buffer.from('MZ fake installer content for testing '.repeat(1000));
const fakeSha = crypto.createHash('sha512').update(fakeExe).digest('base64');
const fakeExePath = path.join(TMP, 'CopilotHan-Setup-9.9.9.exe');
fs.writeFileSync(fakeExePath, fakeExe);

// 造 latest.yml
const yml = `version: 9.9.9
files:
  - url: CopilotHan-Setup-9.9.9.exe
    sha512: ${fakeSha}
    size: ${fakeExe.length}
path: CopilotHan-Setup-9.9.9.exe
sha512: ${fakeSha}
releaseDate: '2026-11-12T00:00:00.000Z'
`;

let serveTampered = false;

const server = http.createServer((req, res) => {
  if (req.url === '/latest.yml') {
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end(yml);
  } else if (req.url.startsWith('/CopilotHan-Setup')) {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fakeExe.length,
    });
    if (serveTampered) {
      // 返回被篡改的内容（长度相同但字节不同）
      const bad = Buffer.from(fakeExe);
      bad[0] = 0xFF;
      res.end(bad);
    } else {
      res.end(fakeExe);
    }
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`测试服务已启动: ${base}\n`);

  console.log('=== 1. 发现新版本 ===');
  {
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl1'),
    });
    const r = await um.check();
    check('检查成功', r.ok);
    check('检测到新版本', r.hasUpdate === true);
    check('版本号正确', r.latestVersion === '9.9.9', r.latestVersion);
    check('当前版本正确', r.currentVersion === '0.10.0');
    check('状态为 available', um.getStatus().state === 'available');
  }

  console.log('\n=== 2. 已是新版不提示更新 ===');
  {
    const um = new UpdateManager({
      currentVersion: '10.0.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl2'),
    });
    const r = await um.check();
    check('检查成功', r.ok);
    check('无更新', r.hasUpdate === false);
    check('状态回到 idle', um.getStatus().state === 'idle');
  }

  console.log('\n=== 3. 正常下载并校验 ===');
  let downloadedPath = null;
  {
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl3'),
    });
    await um.check();
    const r = await um.download();
    check('下载成功', r.ok, r.reason);
    check('文件存在', r.ok && fs.existsSync(r.path));
    check('大小正确', r.ok && r.size === fakeExe.length, r.ok ? `${r.size} vs ${fakeExe.length}` : '');
    check('状态为 ready', um.getStatus().state === 'ready');
    downloadedPath = r.path;
  }

  console.log('\n=== 4. 篡改内容被拒绝 ===');
  {
    serveTampered = true;
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl4'),
    });
    await um.check();
    const r = await um.download();
    check('下载被拒绝', r.ok === false);
    check('原因是校验失败', String(r.reason).includes('校验') || String(r.reason).includes('SHA'), r.reason);
    check('状态为 error', um.getStatus().state === 'error');
    // 确认坏文件已被删除
    const dlDir = path.join(TMP, 'dl4');
    const left = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter(f => f.endsWith('.exe')) : [];
    check('坏文件已删除', left.length === 0, '残留: ' + left.join(','));
    serveTampered = false;
  }

  console.log('\n=== 5. 源不可达 ===');
  {
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: 'http://127.0.0.1:1' } },
      downloadDir: path.join(TMP, 'dl5'),
    });
    const r = await um.check();
    check('检查失败', r.ok === false);
    check('状态为 error', um.getStatus().state === 'error');
  }

  console.log('\n=== 6. 进度回调 ===');
  {
    const progresses = [];
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl6'),
      onStatus: (s) => { if (s.progress !== undefined) progresses.push(s.progress); },
    });
    await um.check();
    await um.download();
    check('收到进度回调', progresses.length > 0, `${progresses.length} 次`);
    check('进度递增到 100', progresses[progresses.length - 1] === 100, String(progresses[progresses.length - 1]));
  }

  console.log('\n=== 7. 安装包就绪后 install 不报错 ===');
  {
    // 注意：这里不真正执行安装器，只验证前置检查
    const um = new UpdateManager({
      currentVersion: '0.10.0',
      config: { source: 'generic', generic: { baseUrl: base } },
      downloadDir: path.join(TMP, 'dl7'),
    });
    await um.check();
    const dl = await um.download();
    if (dl.ok) {
      // 用一个不存在的文件路径测试防护
      um.downloadedPath = path.join(TMP, 'nonexistent.exe');
      const r1 = um.install();
      check('文件不存在时安装被拒绝', r1.ok === false);
    } else {
      check('下载成功（前置）', false, dl.reason);
    }
  }

  console.log('\n==================================');
  console.log(`  通过 ${passed} / ${passed + failed}`);
  console.log('==================================');

  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('测试异常:', e.message);
  server.close();
  process.exit(1);
});
