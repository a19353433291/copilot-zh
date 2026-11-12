"""
改进版图标生成：用亮度渐变生成 alpha，消除黑边。

问题：
  上一版用「RGB 总和 < 45 则全透明」的硬阈值，
  在圆角边缘会产生明显的黑边（半黑像素被保留或半透明处发黑）。

改进：
  对深色区域使用连续的 alpha 映射：
    - 纯黑 (0,0,0)        → alpha = 0
    - 亮度渐升到阈值附近   → alpha 线性升高
    - 图标本体内部深色     → alpha = 255（保留）

  关键是区分「背景黑」与「图标内的深蓝」：
    图标内深蓝有饱和的蓝色分量（B 明显大于 R），
    背景黑则是三通道都接近 0。
    因此用「最大通道值」而非「总和」判断，并对蓝色偏移做补偿。
"""

from PIL import Image
import os
import math

SRC = r"C:\Users\a1935\Desktop\logo.png"
OUT_DIR = r"C:\Users\a1935\Desktop\copilot-zh\build"
os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 64)
print("加载源图")
print("=" * 64)
img = Image.open(SRC).convert("RGBA")
w, h = img.size
print(f"尺寸: {w}x{h}")

src_px = img.load()

# ---------------------------------------------------------------------------
# 生成 alpha 通道
# ---------------------------------------------------------------------------
# 思路：
#   背景黑：max(R,G,B) 很小，且 B 也不突出
#   图标内的深蓝：B 明显高于 R 和 G（蓝色饱和），或 max 通道值较高
#
#   alpha 由「像素与纯黑的差异程度」决定，
#   但若判断为「蓝色调」则强制 alpha=255（保护图标内部深色区域）

print("\n" + "=" * 64)
print("计算 alpha 通道")
print("=" * 64)

out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
out_px = out.load()

LOW = 8      # 低于此值视为纯背景
HIGH = 40    # 高于此值视为完全内容
BLUE_BIAS = 12  # 蓝色分量显著高于红色时，视为图标内容

alpha_hist = {0: 0, 1: 0, 2: 0}  # 0=全透明 1=半透明 2=全不透明

for y in range(h):
    for x in range(w):
        r, g, b, _ = src_px[x, y]
        mx = max(r, g, b)
        mn = min(r, g, b)

        # 蓝色调判断：蓝通道明显占优 → 属于图标内容（保护深蓝）
        is_blue = (b - r > BLUE_BIAS) and (b > 18)

        if mx <= LOW:
            a = 0
        elif mx >= HIGH:
            a = 255
        else:
            # 线性过渡区间，产生平滑边缘
            a = int(255 * (mx - LOW) / (HIGH - LOW))

        # 蓝色调区域强制不透明（避免抠穿图标内部）
        if is_blue and mx > 12:
            a = 255

        out_px[x, y] = (r, g, b, a)

        if a == 0:
            alpha_hist[0] += 1
        elif a == 255:
            alpha_hist[2] += 1
        else:
            alpha_hist[1] += 1

total = w * h
print(f"全透明:   {alpha_hist[0]:>9,}  ({alpha_hist[0]/total*100:5.1f}%)")
print(f"半透明:   {alpha_hist[1]:>9,}  ({alpha_hist[1]/total*100:5.1f}%)   ← 平滑边缘")
print(f"不透明:   {alpha_hist[2]:>9,}  ({alpha_hist[2]/total*100:5.1f}%)")

# ---------------------------------------------------------------------------
# 裁剪与标准化
# ---------------------------------------------------------------------------
print("\n" + "=" * 64)
print("裁剪与标准化")
print("=" * 64)

bbox = out.getbbox()
print(f"内容边界: {bbox}")
cropped = out.crop(bbox)
cw, ch = cropped.size
print(f"裁剪后: {cw}x{ch}")

side = max(cw, ch)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(cropped, ((side - cw) // 2, (side - ch) // 2))

# 内边距 3%（Windows 图标通常在任务栏需要一点呼吸空间）
PAD_RATIO = 0.03
pad = int(side * PAD_RATIO)
final_side = side + pad * 2
final = Image.new("RGBA", (final_side, final_side), (0, 0, 0, 0))
final.paste(square, (pad, pad))
print(f"补边距 {pad}px → {final_side}x{final_side}")

# ---------------------------------------------------------------------------
# 生成各尺寸
# ---------------------------------------------------------------------------
print("\n" + "=" * 64)
print("生成各尺寸 PNG")
print("=" * 64)

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
images = {}

for size in SIZES:
    if size >= final_side:
        resized = final.resize((size, size), Image.LANCZOS)
    else:
        # 多步 Lanczos 缩放，小尺寸边缘更干净
        cur = final
        while cur.width > size * 2:
            nw = max(cur.width // 2, size * 2)
            cur = cur.resize((nw, nw), Image.LANCZOS)
        resized = cur.resize((size, size), Image.LANCZOS)

    images[size] = resized
    path = os.path.join(OUT_DIR, f"icon-{size}.png")
    resized.save(path, "PNG", optimize=True)
    print(f"  {size:4d}x{size:<4d}  {os.path.getsize(path)/1024:7.1f} KB")

images[256].save(os.path.join(OUT_DIR, "icon.png"), "PNG", optimize=True)
print(f"\n主图标: build/icon.png (256x256)")

# ---------------------------------------------------------------------------
# 生成 ICO
# ---------------------------------------------------------------------------
print("\n" + "=" * 64)
print("生成 ICO")
print("=" * 64)

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ico_path = os.path.join(OUT_DIR, "icon.ico")
images[256].save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
print(f"build/icon.ico  {os.path.getsize(ico_path)/1024:.1f} KB")
print(f"内含: {', '.join(str(s) for s in ICO_SIZES)}")

# ---------------------------------------------------------------------------
# 质量检查：边缘是否有黑边
# ---------------------------------------------------------------------------
print("\n" + "=" * 64)
print("质量检查")
print("=" * 64)

check = images[256]
cpx = check.load()
cw2, ch2 = check.size

# 检查透明像素是否 RGB 接近 0（无明显色偏）
dark_transparent = 0
for y in range(0, ch2, 2):
    for x in range(0, cw2, 2):
        r, g, b, a = cpx[x, y]
        if a == 0 and max(r, g, b) > 10:
            dark_transparent += 1
print(f"透明但带色偏的像素: {dark_transparent}  (应为 0 或极少)")

# 检查边缘过渡是否平滑：统计半透明像素在边缘的比例
semi_edge = 0
for y in range(1, ch2 - 1):
    for x in range(1, cw2 - 1):
        r, g, b, a = cpx[x, y]
        if 0 < a < 255:
            semi_edge += 1
print(f"半透明过渡像素: {semi_edge}  (边缘羽化，非 0 说明有抗锯齿)")

print("\n完成。")
