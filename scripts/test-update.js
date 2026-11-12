// 更新模块单元测试（无需网络）
// 覆盖：版本比较、latest.yml 解析、URL 安全校验、下载器哈希计算

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { compareVersions, isSafeUrl, fileSha512, UpdateManager } = require('../src/core/update/updater');
const { parseYml, createSource, listSources } = require('../src/core/update/sources');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('      ' + e.message);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('      ' + e.message);
  }
}

(async () => {

console.log('=== 1. 版本比较 ===');
test('1.0.0 = 1.0.0', () => assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0));
test('1.0.1 > 1.0.0', () => assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1));
test('0.9.9 < 1.0.0', () => assert.strictEqual(compareVersions('0.9.9', '1.0.0'), -1));
test('0.10.0 > 0.9.0（两位数段）', () => assert.strictEqual(compareVersions('0.10.0', '0.9.0'), 1));
test('v1.2.3 前缀被忽略', () => assert.strictEqual(compareVersions('v1.2.3', '1.2.3'), 0));
test('1.2 等价于 1.2.0', () => assert.strictEqual(compareVersions('1.2', '1.2.0'), 0));
test('预发布标记被忽略', () => assert.strictEqual(compareVersions('1.0.0-beta.1', '1.0.0'), 0));
test('2.0.0 > 1.99.99', () => assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1));
test('空值视为 0', () => assert.strictEqual(compareVersions('', '0.0.1'), -1));

console.log('\n=== 2. latest.yml 解析 ===');
const sampleYml = `version: 0.11.0
files:
  - url: CopilotHan-Setup-0.11.0.exe
    sha512: abc123def456==
    size: 102747371
path: CopilotHan-Setup-0.11.0.exe
sha512: abc123def456==
releaseDate: '2026-11-12T09:32:54.904Z'
`;
const parsed = parseYml(sampleYml);
test('解析 version', () => assert.strictEqual(parsed.version, '0.11.0'));
test('解析 path', () => assert.strictEqual(parsed.path, 'CopilotHan-Setup-0.11.0.exe'));
test('解析 sha512', () => assert.strictEqual(parsed.sha512, 'abc123def456=='));
test('解析 size', () => assert.strictEqual(parsed.size, 102747371));
test('解析 files 列表', () => assert.strictEqual(parsed.files.length, 1));
test('files 含 url', () => assert.ok(parsed.files[0].url.includes('0.11.0')));
test('files 含 sha512', () => assert.strictEqual(parsed.files[0].sha512, 'abc123def456=='));

console.log('\n=== 3. YAML 边界情况 ===');
test('空字符串不崩溃', () => {
  const r = parseYml('');
  assert.strictEqual(r.version, null);
  assert.strictEqual(r.path, null);
});
test('缺少 files 段不崩溃', () => {
  const r = parseYml('version: 1.0.0\npath: a.exe\n');
  assert.strictEqual(r.version, '1.0.0');
  assert.strictEqual(r.files.length, 0);
});
test('带引号的值被去引号', () => {
  const r = parseYml('version: "1.2.3"\n');
  assert.strictEqual(r.version, '1.2.3');
});

console.log('\n=== 4. URL 安全校验 ===');
test('https 允许', () => assert.strictEqual(isSafeUrl('https://github.com/a/b.exe'), true));
test('http 公网拒绝', () => assert.strictEqual(isSafeUrl('http://evil.com/a.exe'), false));
test('http localhost 允许', () => assert.strictEqual(isSafeUrl('http://localhost:8080/a.exe'), true));
test('http 127.0.0.1 允许', () => assert.strictEqual(isSafeUrl('http://127.0.0.1/a.exe'), true));
test('file:// 拒绝', () => assert.strictEqual(isSafeUrl('file:///C:/a.exe'), false));
test('ftp:// 拒绝', () => assert.strictEqual(isSafeUrl('ftp://a.com/x'), false));
test('非法 URL 拒绝', () => assert.strictEqual(isSafeUrl('not-a-url'), false));
test('javascript: 拒绝', () => assert.strictEqual(isSafeUrl('javascript:alert(1)'), false));

console.log('\n=== 5. 文件哈希 ===');
await testAsync('sha512 计算正确', async () => {
  const tmp = path.join(os.tmpdir(), 'cz-test-' + Date.now() + '.bin');
  const content = Buffer.from('hello copilot-zh');
  fs.writeFileSync(tmp, content);
  const expected = crypto.createHash('sha512').update(content).digest('base64');
  const actual = await fileSha512(tmp);
  fs.unlinkSync(tmp);
  assert.strictEqual(actual, expected);
});

console.log('\n=== 6. 更新源工厂 ===');
const cfg = {
  source: 'github',
  github: { owner: 'a19353433291', repo: 'copilot-zh' },
  gitee: { owner: 'a19353433291', repo: 'copilot-zh' },
};
test('创建 GitHub 源', () => {
  const s = createSource('github', cfg);
  assert.ok(s);
  assert.strictEqual(s.id, 'github');
  assert.strictEqual(s.displayName, 'GitHub');
});
test('创建 Gitee 源', () => {
  const s = createSource('gitee', cfg);
  assert.ok(s);
  assert.strictEqual(s.id, 'gitee');
});
test('未知源返回 null', () => assert.strictEqual(createSource('unknown', cfg), null));
test('listSources 列出已配置源', () => {
  const list = listSources(cfg);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list.map(x => x.id).sort(), ['gitee', 'github']);
});
test('未配置的源不出现在列表', () => {
  const list = listSources({ github: null, gitee: { owner: 'x', repo: 'y' } });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'gitee');
});

console.log('\n=== 7. UpdateManager 状态机 ===');
await testAsync('初始状态为 idle', async () => {
  const um = new UpdateManager({ currentVersion: '0.10.0', config: cfg });
  assert.strictEqual(um.getStatus().state, 'idle');
  assert.strictEqual(um.getStatus().currentVersion, '0.10.0');
});
await testAsync('未检查就下载会失败', async () => {
  const um = new UpdateManager({ currentVersion: '0.10.0', config: cfg });
  const r = await um.download();
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('检查'));
});
await testAsync('未下载就安装会失败', async () => {
  const um = new UpdateManager({ currentVersion: '0.10.0', config: cfg });
  const r = um.install();
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('不存在'));
});
await testAsync('未配置源时检查失败', async () => {
  const um = new UpdateManager({ currentVersion: '0.10.0', config: { source: 'nope' } });
  const r = await um.check();
  assert.strictEqual(r.ok, false);
});
await testAsync('状态回调被触发', async () => {
  const states = [];
  const um = new UpdateManager({
    currentVersion: '0.10.0',
    config: { source: 'nope' },
    onStatus: (s) => states.push(s.state),
  });
  await um.check();
  assert.ok(states.length > 0);
  assert.ok(states.includes('error'));
});

console.log('\n==================================');
console.log(`  通过 ${passed} / ${passed + failed}`);
console.log('==================================');

process.exit(failed > 0 ? 1 : 0);

})();
