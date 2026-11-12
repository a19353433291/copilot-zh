// 截取窗口：多种方式回退（PrintWindow -> BitBlt from window DC -> 屏幕抓取）
const { execFileSync } = require('child_process');

const procName = process.argv[2] || 'Qoder CN';
const outName = process.argv[3] || '_shot.png';
const OUT = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\' + outName;
const outEscaped = OUT.replace(/\\/g, '\\\\');

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Cap2 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);

  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr Find(int[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int pid; GetWindowThreadProcessId(h, out pid);
      bool match = false;
      foreach (var p in pids) if (p == pid) { match = true; break; }
      if (!match) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      int style = GetWindowLong(h, -16);
      if ((style & 0x00C00000) != 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // DwmGetWindowAttribute DWMWA_EXTENDED_FRAME_BOUNDS = 9
  public static RECT GetBounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) {
      GetWindowRect(h, out r);
    }
    return r;
  }
}
"@

$pids = @()
foreach($p in (Get-Process -Name '${procName}' -ErrorAction SilentlyContinue)){ $pids += $p.Id }
if($pids.Count -eq 0){ Write-Output "NO_PROCESS"; exit }

$h = [Cap2]::Find($pids)
if($h -eq [IntPtr]::Zero){ Write-Output "NO_WINDOW"; exit }

# 移到 (0,0) 并置顶，最大化可见性
[Cap2]::ShowWindow($h, 9) | Out-Null
Start-Sleep -Milliseconds 800
[Cap2]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0040) | Out-Null
Start-Sleep -Milliseconds 500
[Cap2]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 2000

$r = [Cap2]::GetBounds($h)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if($w -le 100 -or $ht -le 100){ Write-Output ("BAD_RECT " + $w + "x" + $ht); exit }

# ---- 方式 1：PrintWindow with PW_RENDERFULLCONTENT (flag 2) ----
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok1 = [Cap2]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
Write-Output ("method1 PrintWindow(2)=" + $ok1)

# 检查是否全黑
function Is-Black($b) {
  $sum = 0; $n = 0
  for($y = 0; $y -lt $b.Height; $y += 20){
    for($x = 0; $x -lt $b.Width; $x += 20){
      $c = $b.GetPixel($x, $y)
      $sum += ($c.R + $c.G + $c.B)
      $n++
    }
  }
  if($n -eq 0){ return $true }
  return (($sum / $n) -lt 12)
}

$isBlack = Is-Black $bmp
Write-Output ("method1 black=" + $isBlack)

if($isBlack){
  # ---- 方式 2：PrintWindow flag 0 ----
  $bmp.Dispose()
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok2 = [Cap2]::PrintWindow($h, $hdc, 0)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  $isBlack2 = Is-Black $bmp
  Write-Output ("method2 PrintWindow(0)=" + $ok2 + " black=" + $isBlack2)

  if($isBlack2){
    # ---- 方式 3：屏幕抓取（窗口已在 0,0 且置顶）----
    $bmp.Dispose()
    $bmp = New-Object System.Drawing.Bitmap($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
    $g.Dispose()
    $isBlack3 = Is-Black $bmp
    Write-Output ("method3 screen-copy black=" + $isBlack3)
  }
}

$bmp.Save('${outEscaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved " + $w + "x" + $ht)
`;

try {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', timeout: 90000, windowsHide: true });
  console.log(out.trim());
} catch (e) {
  console.error('失败:', e.message);
  process.exit(1);
}
