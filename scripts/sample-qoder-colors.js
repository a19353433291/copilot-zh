// 从 Qoder 截图中采样真实像素颜色，验证 CSS 里提取的色值
const { execFileSync } = require('child_process');

const src = process.argv[2] || 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\_qoder-02.png';

const ps = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('${src.replace(/\\/g, '\\\\')}')
Write-Output ("尺寸: " + $img.Width + "x" + $img.Height)
Write-Output ""

function Sample($name, $x, $y){
  $c = $img.GetPixel($x, $y)
  $hex = '#{0:x2}{1:x2}{2:x2}' -f $c.R, $c.G, $c.B
  # 判断色相倾向
  $bias = ''
  if($c.G -gt $c.R -and $c.G -gt $c.B){ $bias = '偏绿' }
  elseif($c.R -gt $c.B -and $c.G -gt $c.B){ $bias = '偏暖' }
  elseif($c.B -gt $c.R){ $bias = '偏蓝' }
  else { $bias = '中性' }
  Write-Output ("  {0,-22} {1}  rgb({2,3},{3,3},{4,3})  {5}" -f $name, $hex, $c.R, $c.G, $c.B, $bias)
}

Write-Output "=== 关键区域取色 ==="
Sample "窗口背景(侧栏)"     200 700
Sample "窗口背景(侧栏下)"   200 1500
Sample "内容区背景"         1400 300
Sample "内容区背景(下)"     1400 1150
Sample "侧栏与内容分界"     388 700
Sample "顶栏背景"           1000 40
Sample "导航项文字区"       180 240
Sample "编程按钮背景"       90  140
Sample "编程按钮文字"       130 140
Sample "卡片背景"           1200 700
Sample "卡片边框(上)"       1200 613
Sample "输入框背景"         1200 1030
Sample "发送按钮背景"       1730 1108
Sample "发送按钮(绿)"       1732 1100
Sample "用户头像背景"       45  1760
Sample "订阅卡片背景"       250 1600
Sample "分割线"             200 1240
Write-Output ""

Write-Output "=== 取色统计（判断整体色调倾向）==="
$rSum = 0; $gSum = 0; $bSum = 0; $n = 0
for($y = 100; $y -lt 1150; $y += 37){
  for($x = 450; $x -lt 1900; $x += 37){
    $c = $img.GetPixel($x, $y)
    # 只统计浅色背景像素
    if($c.R -gt 200){
      $rSum += $c.R; $gSum += $c.G; $bSum += $c.B; $n++
    }
  }
}
if($n -gt 0){
  $ar = [math]::Round($rSum / $n, 1)
  $ag = [math]::Round($gSum / $n, 1)
  $ab = [math]::Round($bSum / $n, 1)
  Write-Output ("  浅色背景平均: rgb({0},{1},{2})  样本 {3}" -f $ar, $ag, $ab, $n)
  if($ag -gt $ar -and $ag -gt $ab){ Write-Output "  → 整体偏绿（正是 CSS 里 #f4f5f3 的特征）" }
  elseif($ar -gt $bSum){ Write-Output "  → 整体偏暖" }
  else { Write-Output "  → 中性偏冷" }
}

$img.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: 'inherit' });
