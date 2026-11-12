"""
生成托盘专用图标。

Windows 托盘图标的最佳实践：
  - 实际显示尺寸约 16x16（100% 缩放）到 24x24（150% 缩放）
  - 系统会缩放到 16px 左右，细节会丢失
  - 因此托盘图标应该比应用图标**更简洁、留白更少、图形更大**

策略：
  1. 从 256 版本出发，裁掉多余留白（只保留 1% 边距）
  2. 生成 16/20/24/32 多尺寸，Windows 会自动选最合适的
  3. 保存为单个 PNG（Electron Tray 支持单文件，内部有 DPI 缩放）

同时也生成一个 "icon-tray.png"（32x32，留白最小）
供 Electron Tray 使用——PNG 比 ICO 在托盘里表现更稳定。
"""

from PIL import Image
import os

BUILD = r"C:\Users\a1935\Desktop\copilot-zh\build"

print("=" * 60)
print("生成托盘图标")
print("=" * 60)

# 从 1024 大图开始，保证缩小时质量
src = Image.open(os.path.join(BUILD, "icon-1024.png")).convert("RGBA")
print(f"源图: {src.size}")

# 裁到内容边界（去掉内边距，托盘需要图形尽量大）
bbox = src.getbbox()
print(f"内容边界: {bbox}")
content = src.crop(bbox)
print(f"裁剪后: {content.size}")

# 补极小边距（1.5%），避免完全贴边
cw, ch = content.size
side = max(cw, ch)
padded_side = int(side * 1.03)
canvas = Image.new("RGBA", (padded_side, padded_side), (0, 0, 0, 0))
canvas.paste(content, ((padded_side - cw) // 2, (padded_side - ch) // 2))
print(f"加 1.5% 边距 → {padded_side}x{padded_side}")

# 生成各托盘尺寸
TRAY_SIZES = [16, 20, 24, 32, 40, 48]
for size in TRAY_SIZES:
    cur = canvas
    while cur.width > size * 3:
        nw = max(cur.width // 2, size * 2)
        cur = cur.resize((nw, nw), Image.LANCZOS)
    resized = cur.resize((size, size), Image.LANCZOS)
    path = os.path.join(BUILD, f"tray-{size}.png")
    resized.save(path, "PNG", optimize=True)
    print(f"  tray-{size}.png  {os.path.getsize(path)/1024:.1f} KB")

# 托盘主图标：32x32（Windows 托盘在 150% DPI 下用 24，200% 用 32）
tray_main = canvas.resize((32, 32), Image.LANCZOS)
tray_main.save(os.path.join(BUILD, "icon-tray.png"), "PNG", optimize=True)
print(f"\n已生成 build/icon-tray.png (32x32)")

# 额外生成 16x16 供高对比需求
small = canvas.resize((16, 16), Image.LANCZOS)
small.save(os.path.join(BUILD, "icon-tray-16.png"), "PNG", optimize=True)
print(f"已生成 build/icon-tray-16.png (16x16)")

print("\n完成")
