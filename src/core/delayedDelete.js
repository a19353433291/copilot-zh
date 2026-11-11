// 延迟删除器：解决「程序运行中无法删除自己的数据目录」问题。
//
// 问题背景（EBUSY）：
//   Electron 的数据目录（%APPDATA%\copilot-zh）里有 DIPS、Cache、Local Storage 等文件，
//   这些文件被主进程、GPU 进程、网络进程共同持有句柄。
//   在程序内部直接 fs.rmSync 会失败：EBUSY: resource busy or locked。
//
// 解决方案：
//   不能在进程内删 → 生成一个独立的延迟删除脚本，由系统在进程退出后执行。
//   脚本用 taskkill 确保相关进程全部退出，再轮询等待文件解锁，最后删除。
//
// 可靠性保障：
//   - 脚本写成 .bat 且用 start /b 分离启动，不依赖父进程存活
//   - 内部最多等待 30 秒，失败时写入日志而不是静默失败
//   - 支持删除多个目录（用户数据 + 更新缓存）

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 生成延迟删除脚本。
 *
 * @param {object} opts
 *   - dirs:        要删除的目录列表
 *   - waitMs:      进程退出后的初始等待时间（默认 1500ms）
 *   - maxWaitSec:  等待文件解锁的最长秒数（默认 30）
 *   - logFile:     失败日志路径（可选）
 * @returns {{ok: boolean, scriptPath?: string, reason?: string}}
 */
function scheduleDeleteAfterExit(opts) {
  const dirs = (opts.dirs || []).filter(Boolean);
  if (!dirs.length) return { ok: false, reason: '没有需要删除的目录' };

  const waitMs = opts.waitMs || 1500;
  const maxWaitSec = opts.maxWaitSec || 30;
  const logFile = opts.logFile || path.join(os.tmpdir(), 'copilot-zh-cleanup.log');

  // 生成唯一脚本路径，避免并发冲突
  const stamp = Date.now();
  const scriptPath = path.join(os.tmpdir(), `copilot-zh-cleanup-${stamp}.bat`);

  const lines = [];
  lines.push('@echo off');
  lines.push('chcp 65001 >nul 2>&1');
  lines.push('setlocal enabledelayedexpansion');
  lines.push(`set "LOG=${logFile}"`);
  lines.push(`echo [%date% %time%] 开始清理 >> "%LOG%" 2>nul`);

  // 1) 确保所有相关进程退出
  lines.push('rem 等待并强制结束相关进程');
  lines.push('for /l %%i in (1,1,10) do (');
  lines.push('  tasklist /FI "IMAGENAME eq CopilotHan.exe" 2>nul | find /i "CopilotHan.exe" >nul');
  lines.push('  if errorlevel 1 goto :procsgone');
  lines.push('  taskkill /IM CopilotHan.exe /T /F >nul 2>&1');
  lines.push('  ping -n 2 127.0.0.1 >nul');
  lines.push(')');
  lines.push(':procsgone');
  lines.push(`ping -n ${Math.max(2, Math.round(waitMs / 1000) + 1)} 127.0.0.1 >nul`);

  // 2) 逐个目录删除，带重试
  for (const dir of dirs) {
    const q = dir.replace(/"/g, '');
    lines.push(`rem 删除: ${q}`);
    lines.push('set "TARGET=' + q + '"');
    lines.push(`for /l %%r in (1,1,${maxWaitSec}) do (`);
    lines.push('  if not exist "!TARGET!" goto :next_' + Math.abs(hashCode(q)));
    lines.push('  rmdir /s /q "!TARGET!" >nul 2>&1');
    lines.push('  if not exist "!TARGET!" goto :next_' + Math.abs(hashCode(q)));
    lines.push('  ping -n 2 127.0.0.1 >nul');
    lines.push(')');
    lines.push(':next_' + Math.abs(hashCode(q)));
    lines.push('if exist "!TARGET!" (');
    lines.push(`  echo [%date% %time%] 失败: !TARGET! >> "%LOG%" 2>nul`);
    lines.push(') else (');
    lines.push(`  echo [%date% %time%] 已删除: !TARGET! >> "%LOG%" 2>nul`);
    lines.push(')');
  }

  // 3) 删除自身
  lines.push('rem 清理脚本自身');
  lines.push('(goto) 2>nul & del "%~f0" >nul 2>&1');
  lines.push('endlocal');

  try {
    fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
  } catch (e) {
    return { ok: false, reason: '写入清理脚本失败: ' + e.message };
  }

  // 用 detached 方式启动，确保父进程退出后仍运行
  const { spawn } = require('child_process');
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '/b', '', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true, scriptPath, logFile, dirs };
  } catch (e) {
    return { ok: false, reason: '启动清理脚本失败: ' + e.message };
  }
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

module.exports = { scheduleDeleteAfterExit };
