// 目标应用定位：跨平台无关逻辑，通过平台适配器取得候选路径。

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * 读取 exe 的文件版本号（Windows）。
 * @param {string} exePath
 * @returns {string|null}
 */
function readFileVersion(exePath) {
  if (process.platform !== 'win32') return null;
  try {
    const ps = `(Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const v = (out || '').trim();
    return v || null;
  } catch (e) {
    return null;
  }
}

/**
 * 生成候选安装路径列表（按优先级）。
 * @returns {string[]}
 */
function candidatePaths() {
  const list = [];
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';

  // 常见位置：优先 Program Files，其次 x86，再用户级
  for (const drive of ['C', 'D', 'E', 'F']) {
    list.push(`${drive}:\\Program Files\\GitHub Copilot\\github.exe`);
    list.push(`${drive}:\\Program Files (x86)\\GitHub Copilot\\github.exe`);
  }
  list.push(path.join(pf, 'GitHub Copilot', 'github.exe'));
  list.push(path.join(pf86, 'GitHub Copilot', 'github.exe'));
  if (local) {
    list.push(path.join(local, 'Programs', 'GitHub Copilot', 'github.exe'));
    list.push(path.join(local, 'GitHub Copilot', 'github.exe'));
  }
  return [...new Set(list)];
}

/**
 * 从注册表读取卸载信息中的安装目录（最可靠，能应对自定义安装路径）。
 * @returns {string[]}
 */
function fromRegistry() {
  if (process.platform !== 'win32') return [];
  const roots = [
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
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
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 20000, windowsHide: true });
    return (out || '').split(/\r?\n/)
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
      .map(dir => path.join(dir, 'github.exe'));
  } catch (e) {
    return [];
  }
}

/**
 * 定位 GitHub Copilot 主程序。
 * @returns {{ok: boolean, exePath?: string, version?: string, source?: string, reason?: string}}
 */
function locateApp() {
  const tried = [];

  // 1. 注册表（最可靠）
  for (const p of fromRegistry()) {
    tried.push(p);
    if (fs.existsSync(p)) {
      return { ok: true, exePath: p, version: readFileVersion(p), source: 'registry' };
    }
  }

  // 2. 常见路径
  for (const p of candidatePaths()) {
    tried.push(p);
    if (fs.existsSync(p)) {
      return { ok: true, exePath: p, version: readFileVersion(p), source: 'common-path' };
    }
  }

  return { ok: false, reason: '未找到 GitHub Copilot 安装位置', tried };
}

module.exports = { locateApp, readFileVersion, candidatePaths };
