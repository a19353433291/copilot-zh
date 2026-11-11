// 通过 CDP 驱动应用窗口（Electron 自身也开了 CDP 吗？）——改为发送快捷键关闭弹窗
// 这里用 Electron 的调试端口不可用，改用点击坐标不可靠，因此直接用 JS 操作界面
const { execFileSync } = require('child_process');

// 用 PowerShell 向窗口发送 Esc 和点击「完成」按钮
// 更稳妥：直接调用 renderer 里的 closeSettings（通过模拟点击）
console.log('使用 UI 自动化关闭弹窗');

// 方案：给 Electron 主进程加 --remote-debugging-port 重启太麻烦。
// 改用简单可靠的方式：向窗口发送 Esc 键
const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WK {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$target = $null
foreach($p in (Get-Process -Name electron -ErrorAction SilentlyContinue)){
  $h = $p.MainWindowHandle
  if($h -eq 0){ continue }
  $sb = New-Object System.Text.StringBuilder 512
  [WK]::GetWindowText($h, $sb, 512) | Out-Null
  if($sb.ToString() -match '汉化助手'){ $target = $h; break }
}
if($target){
  [WK]::ShowWindow($target, 3) | Out-Null
  Start-Sleep -Milliseconds 600
  [WK]::SetForegroundWindow($target) | Out-Null
  Start-Sleep -Milliseconds 700
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 900
  Write-Output 'ESC sent'
} else {
  Write-Output 'window not found'
}
`;
const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 30000, windowsHide: true });
console.log(out.trim());
