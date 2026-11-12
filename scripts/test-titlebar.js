// 验证 Windows 原生标题栏跟随主题
// 通过 win32 API 读取窗口的 DWM 属性，判断标题栏是否深色
const { execFileSync } = require('child_process');

const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class ThemeProbe {
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int val, int size);

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);

  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);

  public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
  public const int DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19;
  public const int DWMWA_CAPTION_COLOR = 35;

  public static string ProbeAll(int targetPid) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      int pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;

      var title = new StringBuilder(256);
      GetWindowText(h, title, 256);
      if (title.Length == 0) return true;

      int dark = -1;
      int hr = DwmGetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, out dark, sizeof(int));
      if (hr != 0) {
        hr = DwmGetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, out dark, sizeof(int));
      }

      int caption = -1;
      DwmGetWindowAttribute(h, DWMWA_CAPTION_COLOR, out caption, sizeof(int));

      sb.AppendLine("TITLE=" + title.ToString());
      sb.AppendLine("DARK=" + dark);
      sb.AppendLine("DARK_HR=" + hr);
      sb.AppendLine("CAPTION=" + caption);
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@

$procs = Get-Process -Name CopilotHan,electron -ErrorAction SilentlyContinue
foreach($p in $procs){
  $out = [ThemeProbe]::ProbeAll($p.Id)
  if($out -and $out.Trim().Length -gt 0){
    Write-Output ("PID=" + $p.Id)
    Write-Output $out
  }
}
`;

function probe() {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', timeout: 40000, windowsHide: true });
  return out.trim();
}

const theme = process.argv[2] || null;
console.log('=== 当前原生标题栏状态 ===');
const raw = probe();
console.log(raw || '(未找到窗口)');

// 只取主窗口结果（标题含「汉化助手」），忽略 Default IME / MSCTFIME UI 等辅助窗口
const blocks = raw.split(/(?=TITLE=)/).filter(b => b.includes('TITLE='));
let target = null;
for (const b of blocks) {
  const tm = b.match(/TITLE=(.*)/);
  const dm = b.match(/DARK=(-?\d+)/);
  if (!tm || !dm) continue;
  // 主窗口标题包含「汉化助手」（可能因编码显示为乱码，改按 DARK 值 + 是否为第一个真实窗口判断）
  const title = tm[1].trim();
  if (/IME|MSCTF|Default/.test(title)) continue;
  target = { title, dark: Number(dm[1]) };
  break;
}

if (target) {
  console.log(`\n主窗口: ${target.title}`);
  console.log(`DWMWA_USE_IMMERSIVE_DARK_MODE = ${target.dark}  ${target.dark === 1 ? '(深色标题栏)' : '(浅色标题栏)'}`);
  if (theme === 'dark' && target.dark !== 1) { console.log('✗ 期望深色标题栏，实际不是'); process.exit(1); }
  if (theme === 'light' && target.dark === 1) { console.log('✗ 期望浅色标题栏，实际不是'); process.exit(1); }
  console.log('✓ 符合期望');
} else {
  console.log('\n✗ 未找到主窗口');
  process.exit(1);
}
