"""分析源图标的属性：尺寸、透明度、圆角、留白"""
from PIL import Image
import os

src = r"C:\Users\a1935\Desktop\logo.png"
img = Image.open(src)
print("文件:", src)
print("尺寸:", img.size)
print("模式:", img.mode)
print("文件大小: %.2f MB" % (os.path.getsize(src) / 1024 / 1024))

# 转 RGBA 分析透明度
rgba = img.convert("RGBA")
w, h = rgba.size
px = rgba.load()

# 四个角的透明度
corners = {
    "左上": px[0, 0],
    "右上": px[w - 1, 0],
    "左下": px[0, h - 1],
    "右下": px[w - 1, h - 1],
}
print("\n四角像素 (R,G,B,A):")
for k, v in corners.items():
    print(f"  {k}: {v}")

# 统计透明像素占比
transparent = 0
semi = 0
for y in range(0, h, 3):
    for x in range(0, w, 3):
        a = px[x, y][3]
        if a == 0:
            transparent += 1
        elif a < 250:
            semi += 1
total_sampled = len(range(0, h, 3)) * len(range(0, w, 3))
print(f"\n透明像素: {transparent/total_sampled*100:.1f}%")
print(f"半透明像素: {semi/total_sampled*100:.1f}%")

# 找内容边界（非透明区域）
bbox = rgba.getbbox()
print("\n内容边界 bbox:", bbox)
if bbox:
    print(f"  内容区域: {bbox[2]-bbox[0]} x {bbox[3]-bbox[1]}")
    print(f"  四周留白: 左{bbox[0]} 上{bbox[1]} 右{w-bbox[2]} 下{h-bbox[3]}")

# 如果是全不透明，检查圆角外的颜色
if transparent == 0:
    print("\n⚠ 图片无透明通道（全不透明），圆角外可能是纯色底")
    print("  左上角颜色:", px[2, 2])
