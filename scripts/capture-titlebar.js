// 可靠验证：把目标窗口置顶+固定位置，再截取屏幕对应区域
// 避免误抓其他窗口
const fs = require('fs');
const { execFileSync } = require('child_process');

const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images';

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinCap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int Left, Top, Right, Bottom; }

  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOZORDER = 0x0004;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const int HWND_TOPMOST = -1;

  public static IntPtr FindByPids(int[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int pid;
      GetWindowThreadProcessId(h, out pid);
      bool match = false;
      foreach (var p in pids) if (p == pid) { match = true; break; }
      if (!match) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      // 排除 IME / 辅助窗口，只留真正的应用主窗口
      if (t.Length > 0 && !t.Contains("IME") && !t.Contains("MSCTF") && !t.Contains("Default")) {
        // 主窗口通常有标题栏样式位
        int style = GetWindowLong(h, -16);
        if ((style & 0x00C00000) != 0) {   // WS_CAPTION
          found = h;
          return false;
        }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$pids = @()
foreach($p in (Get-Process -Name CopilotHan,electron -ErrorAction SilentlyContinue)){ $pids += $p.Id }
if($pids.Count -eq 0){ Write-Output "NO_PROCESS"; exit }

$h = [WinCap]::FindByPids($pids)
if($h -eq [IntPtr]::Zero){ Write-Output "NO_WINDOW"; exit }

# 还原并置顶，移到固定位置
[WinCap]::ShowWindow($h, 9) | Out-Null
Start-Sleep -Milliseconds 700
[WinCap]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, [WinCap]::SWP_NOSIZE -bor [WinCap]::SWP_NOZORDER) | Out-Null
Start-Sleep -Milliseconds 400
[WinCap]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, [WinCap]::SWP_NOSIZE) | Out-Null
[WinCap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1600

$r = New-Object WinCap+RECT
[WinCap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if($w -le 100 -or $ht -le 100){ Write-Output ("BAD_RECT " + $w + "x" + $ht); exit }

$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$g.Dispose()

$dir = "${OUT.replace(/\\/g, '\\\\')}"
$bmp.Save("$dir\\\\_win-full.png", [System.Drawing.Imaging.ImageFormat]::Png)

# 标题栏区域：Windows 10/11 约 32px（缩放后可能更高）
$tbH = [Math]::Min(48, $ht)
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $tbH)
$tb = $bmp.Clone($rect, $bmp.PixelFormat)
$scaled = New-Object System.Drawing.Bitmap($tb, ($tb.Width * 2), ($tb.Height * 3))
$scaled.Save("$dir\\\\_win-titlebar.png", [System.Drawing.Imaging.ImageFormat]::Png)

# 计算标题栏亮度（排除左侧图标区，取右侧 60% 避免图标干扰）
$sum = 0; $n = 0
$startX = [int]($w * 0.4)
for($y=4; $y -lt ($tbH - 6); $y+=2){
  for($x=$startX; $x -lt ($w - 120); $x+=4){
    $c = $tb.GetPixel($x, $y)
    $sum += ($c.R + $c.G + $c.B) / 3
    $n++
  }
}
$avg = if($n -gt 0){ [Math]::Round($sum / $n, 1) } else { -1 }

Write-Output ("RECT=" + $w + "x" + $ht)
Write-Output ("TITLEBAR_AVG=" + $avg + " SAMPLES=" + $n)

$bmp.Dispose(); $tb.Dispose(); $scaled.Dispose()
`;

const out = execFileSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 60000, windowsHide: true });
console.log(out.trim());
