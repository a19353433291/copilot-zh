// 截取应用窗口（含标题栏），优先使用 PrintWindow
const fs = require('fs');
const path = require('path');

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Cap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr FindMain(int[] pids) {
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
      if (t.Length > 0 && !t.Contains("IME") && !t.Contains("MSCTF") && !t.Contains("Default")) {
        found = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$pids = @()
foreach($p in (Get-Process -Name CopilotHan,electron -ErrorAction SilentlyContinue)){ $pids += $p.Id }
if($pids.Count -eq 0){ Write-Output "no-process"; exit }

$h = [Cap]::FindMain($pids)
if($h -eq [IntPtr]::Zero){ Write-Output "no-window"; exit }

[Cap]::ShowWindow($h, 3) | Out-Null
Start-Sleep -Milliseconds 800
[Cap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1200

$r = New-Object Cap+RECT
[Cap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if($w -le 0 -or $ht -le 0){ Write-Output "bad-rect"; exit }

$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PrintWindow flag 2 = PW_RENDERFULLCONTENT，能捕获 DWM 合成的窗口
$ok = [Cap]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()

if(-not $ok){
  # 回退到屏幕复制
  $g2 = [System.Drawing.Graphics]::FromImage($bmp)
  $g2.CopyFromScreen([Math]::Max(0,$r.Left), [Math]::Max(0,$r.Top), 0, 0, $bmp.Size)
  $g2.Dispose()
}

$outPath = "C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\_titlebar-probe.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved " + $w + "x" + $ht + " printwindow=" + $ok)
`;

const out = require('child_process').execFileSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 60000, windowsHide: true });
console.log(out.trim());
