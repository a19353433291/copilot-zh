"""把各尺寸图标拼成一张预览图，便于一次性检查所有尺寸的清晰度"""
from PIL import Image, ImageDraw
import os

BUILD = r"C:\Users\a1935\Desktop\copilot-zh\build"
SIZES = [16, 24, 32, 48, 64, 128, 256]

# 每格宽度：图标居中，下方标注尺寸
CELL_W = 290
CELL_H = 300
COLS = 4
ROWS = (len(SIZES) + COLS - 1) // COLS

canvas = Image.new("RGB", (CELL_W * COLS, CELL_H * ROWS), (245, 245, 247))
draw = ImageDraw.Draw(canvas)

for i, size in enumerate(SIZES):
    path = os.path.join(BUILD, f"icon-{size}.png")
    if not os.path.exists(path):
        continue
    icon = Image.open(path).convert("RGBA")

    col = i % COLS
    row = i // COLS
    cx = col * CELL_W + CELL_W // 2
    cy = row * CELL_H + 60

    # 放大 2 倍显示（小尺寸否则看不清），保持最近邻以免失真判断
    display_size = min(size * 2, 200) if size <= 64 else size
    shown = icon.resize((display_size, display_size), Image.NEAREST) if size <= 64 else icon

    # 画棋盘格背景，便于看透明区域
    x0 = cx - display_size // 2
    y0 = cy
    for by in range(0, display_size, 12):
        for bx in range(0, display_size, 12):
            c = (230, 230, 232) if ((bx // 12) + (by // 12)) % 2 == 0 else (255, 255, 255)
            draw.rectangle([x0 + bx, y0 + by, x0 + bx + 11, y0 + by + 11], fill=c)

    canvas.paste(shown, (x0, y0), shown)
    draw.text((cx - 20, cy + display_size + 8), f"{size}x{size}", fill=(60, 60, 65))

out = os.path.join(BUILD, "_icon-preview.png")
canvas.save(out, "PNG")
print("预览图已保存:", out)
print(f"  画布: {canvas.size[0]}x{canvas.size[1]}")
