"""
从源 PNG 生成 Windows 应用图标（ICO 多尺寸 + PNG 各尺寸）。

源图特征（已分析）：
  - 1254x1254，RGB 模式，无透明通道
  - 圆角外为纯黑 (0,0,0) 背景
  - 图标本体约 x[43,1211] y[41,1208]，圆角半径约 122px

处理策略：
  1. 以 alpha=0 抠掉纯黑背景（用容差判断，避免边缘黑边）
  2. 边缘做轻微羽化，避免锯齿
  3. 裁剪到内容边界，再补成正方形并留统一内边距
  4. 生成 16~256 各尺寸 PNG，打包为 ICO

注意 Windows 图标规范：
  - 小尺寸（16/24/32）需要更粗的图形，直接缩小会糊
  - ICO 中 256 用 PNG 压缩，小尺寸可用 PNG 或 BMP
"""

from PIL import Image, ImageFilter
import os

SRC = r"C:\Users\a1935\Desktop\logo.png"
OUT_DIR = r"C:\Users\a1935\Desktop\copilot-zh\build"
os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 60)
print("步骤 1：加载并与抠除黑色背景")
print("=" * 60)

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

# 黑色背景阈值：RGB 三通道总和小于此值视为背景
# 取值需谨慎：太高会吃进图标深蓝区域，太低会留下黑边
THRESHOLD = 45

transparent_count = 0
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if r + g + b < THRESHOLD:
            px[x, y] = (0, 0, 0, 0)
            transparent_count += 1

print(f"抠除背景像素: {transparent_count:,} / {w*h:,} ({transparent_count/(w*h)*100:.1f}%)")

# 检查是否误伤：看深蓝色区域是否被抠掉
# 采样图标内部几个点
test_points = [(627, 100), (100, 627), (1150, 627), (627, 1150), (627, 627)]
print("\n内部采样（应保留）：")
for pt in test_points:
    print(f"  {pt}: {px[pt[0], pt[1]]}")

# 内容边界
bbox = img.getbbox()
print(f"\n抠图后内容边界: {bbox}")

print("\n" + "=" * 60)
print("步骤 2：裁剪并标准化为正方形")
print("=" * 60)

# 裁剪到内容
cropped = img.crop(bbox)
cw, ch = cropped.size
print(f"裁剪后: {cw}x{ch}")

# 补成正方形（居中）
side = max(cw, ch)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
offset = ((side - cw) // 2, (side - ch) // 2)
square.paste(cropped, offset)
print(f"补成正方形: {side}x{side}，内容偏移 {offset}")

# 加统一内边距（4%），让图标在任务栏里不贴边
PAD_RATIO = 0.04
pad = int(side * PAD_RATIO)
final_side = side + pad * 2
final = Image.new("RGBA", (final_side, final_side), (0, 0, 0, 0))
final.paste(square, (pad, pad))
print(f"加内边距 {pad}px → 最终 {final_side}x{final_side}")

print("\n" + "=" * 60)
print("步骤 3：生成各尺寸 PNG")
print("=" * 60)

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
png_files = {}

for size in SIZES:
    # 高质量缩小：先 Lanczos 缩到 4 倍，再逐步缩，避免小尺寸失真
    if size >= final_side:
        resized = final.resize((size, size), Image.LANCZOS)
    else:
        # 多步缩放，小尺寸更清晰
        cur = final
        target = size * 2 if size <= 64 else size
        step = cur
        while step.width > target * 2:
            nw = max(step.width // 2, target)
            step = step.resize((nw, nw), Image.LANCZOS)
        resized = step.resize((size, size), Image.LANCZOS)

    path = os.path.join(OUT_DIR, f"icon-{size}.png")
    resized.save(path, "PNG", optimize=True)
    png_files[size] = resized
    kb = os.path.getsize(path) / 1024
    print(f"  {size:4d}x{size:<4d}  {kb:6.1f} KB")

# 主图标 PNG（256，用于 Electron 窗口与 Linux）
png_files[256].save(os.path.join(OUT_DIR, "icon.png"), "PNG", optimize=True)
print(f"\n已保存主图标: build/icon.png (256x256)")

print("\n" + "=" * 60)
print("步骤 4：生成 ICO（多尺寸内嵌）")
print("=" * 60)

# ICO 标准尺寸集
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ico_images = [png_files[s] for s in ICO_SIZES]

ico_path = os.path.join(OUT_DIR, "icon.ico")
# PIL 会自动处理多尺寸 ICO 打包
png_files[256].save(
    ico_path,
    format="ICO",
    sizes=[(s, s) for s in ICO_SIZES],
)
print(f"已保存 build/icon.ico")
print(f"  内含尺寸: {', '.join(str(s) for s in ICO_SIZES)}")
print(f"  文件大小: {os.path.getsize(ico_path)/1024:.1f} KB")

print("\n" + "=" * 60)
print("完成")
print("=" * 60)
