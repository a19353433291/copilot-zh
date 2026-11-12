// 从已截取的大图中裁切局部放大，便于分析细节
const { execFileSync } = require('child_process');
const src = process.argv[2];
const regions = process.argv[3] || 'sidebar,titlebar,input,content';

const ps = `
Add-Type -AssemblyName System.Drawing
$src = '${src.replace(/\\/g, '\\\\')}'
$img = [System.Drawing.Image]::FromFile($src)
Write-Output ("源图: " + $img.Width + "x" + $img.Height)
$regions = '${regions}'.Split(',')

foreach($r in $regions){
  switch($r){
    'sidebar' {
      # 左侧栏：0..390
      $rect = New-Object System.Drawing.Rectangle(0, 0, 400, 1207)
    }
    'titlebar' {
      $rect = New-Object System.Drawing.Rectangle(0, 0, 1984, 90)
    }
    'input' {
      # 输入框区域
      $rect = New-Object System.Drawing.Rectangle(600, 970, 1180, 200)
    }
    'content' {
      $rect = New-Object System.Drawing.Rectangle(390, 600, 1600, 500)
    }
    'card' {
      $rect = New-Object System.Drawing.Rectangle(600, 600, 1180, 320)
    }
    default { $rect = New-Object System.Drawing.Rectangle(0,0,$img.Width,$img.Height) }
  }
  if($rect.Right -gt $img.Width){ $rect.Width = $img.Width - $rect.X }
  if($rect.Bottom -gt $img.Height){ $rect.Height = $img.Height - $rect.Y }
  if($rect.Width -le 0 -or $rect.Height -le 0){ continue }

  $crop = $img.Clone($rect, $img.PixelFormat)
  # 放大 1.5 倍看清楚
  $nw = [int]($crop.Width * 1.5)
  $nh = [int]($crop.Height * 1.5)
  if($nw -gt 1800){ $nw = 1800; $nh = [int]($crop.Height * (1800 / $crop.Width)) }
  $big = New-Object System.Drawing.Bitmap($crop, $nw, $nh)
  $out = 'C:\\Users\\a1935\\Desktop\\copilot-zh\\docs\\images\\_qoder-' + $r + '.png'
  $big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("  已保存 _qoder-" + $r + ".png  " + $nw + "x" + $nh)
  $crop.Dispose(); $big.Dispose()
}
$img.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: 'inherit' });
