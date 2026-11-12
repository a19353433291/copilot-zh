"""分析源图标：找出真正的圆角区域与黑色背景范围"""
from PIL import Image

src = r"C:\Users\a1935\Desktop\logo.png"
img = Image.open(src).convert("RGB")
w, h = img.size
px = img.load()

print(f"size: {w}x{h}")

# 沿对角线扫描，找黑色背景结束的位置
def scan_diagonal():
    """从左上角沿对角线向内扫，找第一个非黑像素"""
    for i in range(min(w, h)):
        r, g, b = px[i, i]
        if r + g + b > 40:
            return i
    return -1

d = scan_diagonal()
print(f"对角线首个非黑像素位置: {d}")

# 沿水平中线扫描，找左右边界
def scan_row(y):
    left = -1
    right = -1
    for x in range(w):
        r, g, b = px[x, y]
        if r + g + b > 40:
            left = x
            break
    for x in range(w - 1, -1, -1):
        r, g, b = px[x, y]
        if r + g + b > 40:
            right = x
            break
    return left, right

mid_y = h // 2
l, r = scan_row(mid_y)
print(f"水平中线 y={mid_y}: 左边界 {l}, 右边界 {r}")

# 沿垂直中线扫描
def scan_col(x):
    top = -1
    bottom = -1
    for y in range(h):
        rr, gg, bb = px[x, y]
        if rr + gg + bb > 40:
            top = y
            break
    for y in range(h - 1, -1, -1):
        rr, gg, bb = px[x, y]
        if rr + gg + bb > 40:
            bottom = y
            break
    return top, bottom

mid_x = w // 2
t, b = scan_col(mid_x)
print(f"垂直中线 x={mid_x}: 上边界 {t}, 下边界 {b}")

# 判断圆角半径：比较角落弧线与边缘
print(f"\n推断:")
print(f"  图标本体大致范围: x [{l}, {r}], y [{t}, {b}]")
print(f"  宽度 {r-l+1}, 高度 {b-t+1}")
print(f"  对角线上 (i,i) 到 d={d} 处才有内容 → 圆角半径约 {d} px")

# 采样一些角落像素确认背景色
print("\n背景采样:")
for pt in [(5,5), (625,5), (5,625), (1248,1248), (625,1248), (1248,625)]:
    print(f"  {pt}: {px[pt[0], pt[1]]}")

# 检查是否整张图都有内容（即圆角是画在图内的）
print("\n是否所有边缘中点都是内容色：")
edges = [(w//2, 1), (w//2, h-2), (1, h//2), (w-2, h//2)]
for pt in edges:
    print(f"  {pt}: {px[pt[0], pt[1]]}")
