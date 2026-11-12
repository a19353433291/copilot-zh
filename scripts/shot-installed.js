// 截取安装版界面（通过窗口句柄）
const { execFileSync } = require('child_process');

const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WS {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$target = $null
foreach($proc in (Get-Process -Name CopilotHan -ErrorAction SilentlyContinue)){
  $h = $proc.MainWindowHandle
  if($h -eq 0){ continue }
  $sb = New-Object System.Text.StringBuilder 512
  [WS]::GetWindowText($h, $sb, 512) | Out-Null
  if($sb.ToString() -match '汉化助手'){ $target = $h; break }
}
if($target){
  [WS]::ShowWindow($target, 3) | Out-Null
  Start-Sleep -Milliseconds 900
  [WS]::SetForegroundWindow($target) | Out-Null
  Start-Sleep -Milliseconds 1100
  $r = New-Object WS+RECT
  [WS]::GetWindowRect($target, [ref]$r) | Out-Null
  $w = [Math]::Min($r.Right - $r.Left, 1700)
  $ht = [Math]::Min($r.Bottom - $r.Top, 950)
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([Math]::Max(0,$r.Left), [Math]::Max(0,$r.Top), 0, 0, $bmp.Size)
  $bmp.Save("C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\ui-installed.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ("saved " + $w + "x" + $ht)
} else {
  Write-Output "no window"
}
`;

const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 40000, windowsHide: true });
console.log(out.trim());
