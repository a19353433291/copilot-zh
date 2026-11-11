// 目标应用定位。
//
// 性能约束：全部异步执行。
// 早期用 execFileSync + PowerShell，单次约 1-2 秒，每次检测都会卡住界面。
// 现在改为 execFile 回调 + tasklist 快速判定，PowerShell 只在必要时用。

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/** 异步执行命令 */
function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

/**
 * 读取 exe 的文件版本号（异步）。
 * @param {string} exePath
 * @returns {Promise<string|null>}
 */
async function readFileVersion(exePath) {
  if (process.platform !== 'win32') return null;
  const ps = `(Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 10000);
  const v = (out || '').trim();
  return v || null;
}

/**
 * 常见安装路径候选（快速路径，直接查文件系统，无子进程开销）。
 * @returns {string[]}
 */
function candidatePaths() {
  const list = [];
  for (const drive of ['C', 'D', 'E', 'F']) {
    list.push(`${drive}:\\Program Files\\GitHub Copilot\\github.exe`);
    list.push(`${drive}:\\Program Files (x86)\\GitHub Copilot\\github.exe`);
  }
  const local = process.env.LOCALAPPDATA || '';
  if (local) {
    list.push(path.join(local, 'Programs', 'GitHub Copilot', 'github.exe'));
    list.push(path.join(local, 'GitHub Copilot', 'github.exe'));
  }
  return [...new Set(list)];
}

/**
 * 从注册表卸载信息中读取安装目录（异步）。
 * 只在常见路径都失败时才调用，因为它需要启动 PowerShell。
 * @returns {Promise<string[]>}
 */
async function fromRegistry() {
  if (process.platform !== 'win32') return [];
  const script = `
    $found = @()
    $roots = @(
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
    foreach ($r in $roots) {
      if (Test-Path $r) {
        Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
          $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
          if ($p.DisplayName -like '*GitHub Copilot*' -and $p.InstallLocation) {
            $found += $p.InstallLocation
          }
        }
      }
    }
    $found -join "\`n"
  `;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15000);
  return (out || '').split(/\r?\n/)
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map(dir => path.join(dir, 'github.exe'));
}

// 缓存：避免每次调用都重新探测
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30 * 1000;

/**
 * 定位 GitHub Copilot 主程序（异步）。
 * @param {object} opts { force: 忽略缓存 }
 * @returns {Promise<{ok, exePath?, version?, source?, reason?, tried?}>}
 */
async function locateApp(opts = {}) {
  if (!opts.force && _cache && Date.now() - _cacheAt < CACHE_TTL) {
    return _cache;
  }

  // 1. 常见路径（最快，纯文件系统检查）
  for (const p of candidatePaths()) {
    if (fs.existsSync(p)) {
      const r = { ok: true, exePath: p, version: await readFileVersion(p), source: 'common-path' };
      _cache = r; _cacheAt = Date.now();
      return r;
    }
  }

  // 2. 注册表（较慢，但能应对自定义安装路径）
  for (const p of await fromRegistry()) {
    if (fs.existsSync(p)) {
      const r = { ok: true, exePath: p, version: await readFileVersion(p), source: 'registry' };
      _cache = r; _cacheAt = Date.now();
      return r;
    }
  }

  const r = { ok: false, reason: '未找到 GitHub Copilot 安装位置' };
  _cache = r; _cacheAt = Date.now();
  return r;
}

module.exports = { locateApp, readFileVersion, candidatePaths, fromRegistry };
