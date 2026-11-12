"""
为界面左上角生成优化的小尺寸图标。

问题：
  源图细节丰富（机器人 + A + 文 + 双箭头 + 星光），
  直接缩到 30px 时所有元素挤在一起，看起来像色块。

解决：
  UI 里的 logo 只有 30-32px，需要「符号化」版本：
  只保留最核心的识别元素——「A文」+ 短箭头，
  去掉机器人细节和星光。

实现：
  从 256px 版本裁取中心区域（A文所在位置），
  放大后重新缩到 32/64，让图形占比更大。
"""

from PIL import Image
import os

BUILD = r"C:\Users\a1935\Desktop\copilot-zh\build"

print("=" * 60)
print("生成 UI 用小尺寸图标（符号化）")
print("=" * 60)

# 从 256 开始
src = Image.open(os.path.join(BUILD, "icon-256.png")).convert("RGBA")
print(f"源: {src.size}")

# 分析：A文在图标的哪个区域？
# 256 图中，A 大约在 x[55,150] y[85,210]，文在 x[150,240] y[95,200]
# 裁取「A文」主体区域（略留边）
# 观察原图：A 和 文 占据中间偏下大部分区域
crop_box = (40, 70, 240, 230)  # (left, top, right, bottom)
region = src.crop(crop_box)
print(f"裁取 A文 区域: {crop_box} → {region.size}")

# 补成正方形
rw, rh = region.size
side = max(rw, rh)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(region, ((side - rw) // 2, (side - rh) // 2))
print(f"补正方形: {sq.size}")

# 生成 UI 用尺寸
for size in [32, 64, 96, 128]:
    resized = sq.resize((size, size), Image.LANCZOS)
    path = os.path.join(BUILD, f"logo-ui-{size}.png")
    resized.save(path, "PNG", optimize=True)
    print(f"  logo-ui-{size}.png  {os.path.getsize(path)/1024:.1f} KB")

print("\n注意：这是 UI 专用简化版，不用于 exe/托盘图标。")
