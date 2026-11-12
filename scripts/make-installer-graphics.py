"""
生成 NSIS 安装器/卸载器图形 v2。

设计概念：「A → 文」的转译意象
  本产品的本质是把英文界面转成中文。这个「转译」动作就是最好的记忆点。
  图形上用「英文词条 → 中文词条」的对照来传达，而不是抽象的装饰。

规格（NSIS 硬性要求）：
  installerSidebar.bmp     164 × 314
  uninstallerSidebar.bmp   164 × 314
  installerHeader.bmp      150 × 57

设计语言对齐主程序：
  - 背景 #F6F6F6 纯中性灰
  - 强调色 #0071E3
  - 圆角 10px
  - 无装饰光效，靠留白与排版建立层级
"""

from PIL import Image, ImageDraw, ImageFont
import os

BUILD = r"C:\Users\a1935\Desktop\copilot-zh\build"

# ---- token（与 themes.css 一致）----
BG       = (246, 246, 246)
SURFACE  = (255, 255, 255)
BORDER   = (222, 222, 224)
TEXT     = (53, 53, 58)
TEXT_SEC = (110, 110, 115)
TEXT_TER = (150, 150, 155)
PRIMARY  = (0, 113, 227)
SUCCESS  = (36, 138, 61)

SIDEBAR_W, SIDEBAR_H = 164, 314
HEADER_W, HEADER_H = 150, 57


def load_font(size, bold=False):
    names = []
    if bold:
        names += [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\segoeuib.ttf"]
    names += [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\segoeui.ttf",
              r"C:\Windows\Fonts\arial.ttf"]
    for p in names:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def rrect(d, box, r, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = box
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=fill, outline=outline, width=width)


def text_w(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def center(d, s, f, fill, cx, y):
    d.text((cx - text_w(d, s, f) // 2, y), s, font=f, fill=fill)


def paste_logo(im, cx, cy, size):
    p = os.path.join(BUILD, "icon-256.png")
    if not os.path.exists(p):
        return False
    logo = Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS)
    im.paste(logo, (cx - size // 2, cy - size // 2), logo)
    return True


def make_sidebar(variant):
    im = Image.new("RGB", (SIDEBAR_W, SIDEBAR_H), BG)
    d = ImageDraw.Draw(im)
    cx = SIDEBAR_W // 2

    # ---- 顶部：图标 ----
    logo_size = 52
    logo_cy = 58
    if not paste_logo(im, cx, logo_cy, logo_size):
        rrect(d, [cx - 26, logo_cy - 26, cx + 26, logo_cy + 26], 13, fill=PRIMARY)

    # ---- 产品名 ----
    f_name = load_font(14, bold=True)
    center(d, "Copilot 汉化助手", f_name, TEXT, cx, 96)

    f_slogan = load_font(9)
    center(d, "让 Copilot 说中文" if variant == "install" else "准备移除本程序",
           f_slogan, TEXT_SEC, cx, 118)

    # ---- 核心记忆点：转译对照卡 ----
    # 上面英文，下面中文，中间一个小箭头 —— 直观表达「汉化」这件事
    card_y = 148
    card_h = 76
    rrect(d, [16, card_y, SIDEBAR_W - 16, card_y + card_h], 8,
          fill=SURFACE, outline=BORDER, width=1)

    f_en = load_font(9)
    f_zh = load_font(10, bold=True)

    if variant == "install":
        pairs = [("Settings", "设置"), ("New chat", "新建对话")]
    else:
        pairs = [("设置", "Settings"), ("新建对话", "New chat")]

    # 只展示一组对照，保持简洁
    en, zh = pairs[0]
    y1 = card_y + 14
    y2 = card_y + 42

    if variant == "install":
        # 英文在上（灰），中文在下（深色）
        center(d, en, f_en, TEXT_TER, cx, y1)
        # 向下箭头
        ax, ay = cx, y1 + 16
        d.line([ax, ay - 4, ax, ay + 3], fill=BORDER, width=1)
        d.line([ax - 3, ay, ax, ay + 3], fill=BORDER, width=1)
        d.line([ax + 3, ay, ax, ay + 3], fill=BORDER, width=1)
        center(d, zh, f_zh, PRIMARY, cx, y2)
    else:
        # 卸载时反过来：中文在上，英文在下
        center(d, en, f_zh, PRIMARY, cx, y1)
        ax, ay = cx, y1 + 17
        d.line([ax, ay - 4, ax, ay + 3], fill=BORDER, width=1)
        d.line([ax - 3, ay, ax, ay + 3], fill=BORDER, width=1)
        d.line([ax + 3, ay, ax, ay + 3], fill=BORDER, width=1)
        center(d, zh, f_en, TEXT_TER, cx, y2)

    # ---- 底部：三条要点 ----
    f_item = load_font(8)
    items = (["不改本体", "签名完好", "一键还原"] if variant == "install"
             else ["清除调试策略", "删除全部数据", "退出后自动清理"])
    y = 244
    for it in items:
        d.ellipse([cx - 30, y + 3, cx - 26, y + 7],
                  fill=(SUCCESS if variant == "install" else TEXT_TER))
        d.text((cx - 22, y), it, font=f_item, fill=TEXT_SEC)
        y += 18

    # 底部分割线，收住画面
    d.line([24, SIDEBAR_H - 12, SIDEBAR_W - 24, SIDEBAR_H - 12],
           fill=(232, 232, 234), width=1)

    return im


def make_header():
    im = Image.new("RGB", (HEADER_W, HEADER_H), BG)
    d = ImageDraw.Draw(im)

    logo_size = 24
    if not paste_logo(im, 21, HEADER_H // 2, logo_size):
        rrect(d, [9, 16, 33, 40], 6, fill=PRIMARY)

    f1 = load_font(10, bold=True)
    d.text((42, 13), "Copilot 汉化助手", font=f1, fill=TEXT)

    f2 = load_font(7)
    d.text((42, 30), "GitHub Copilot 中文界面", font=f2, fill=TEXT_TER)

    return im


if __name__ == "__main__":
    targets = [
        ("installerSidebar.bmp",   make_sidebar("install")),
        ("uninstallerSidebar.bmp", make_sidebar("uninstall")),
        ("installerHeader.bmp",    make_header()),
    ]
    for name, img in targets:
        out = os.path.join(BUILD, name)
        img.convert("RGB").save(out, "BMP")
        print(f"  {name:26s} {img.size[0]}x{img.size[1]}  {os.path.getsize(out)/1024:5.1f} KB")

    # 生成预览（三张图并排，放大 2 倍）
    a = Image.open(os.path.join(BUILD, "installerSidebar.bmp")).convert("RGB")
    b = Image.open(os.path.join(BUILD, "uninstallerSidebar.bmp")).convert("RGB")
    h = Image.open(os.path.join(BUILD, "installerHeader.bmp")).convert("RGB")

    pad, scale = 16, 2
    sw, sh = SIDEBAR_W * scale, SIDEBAR_H * scale
    canvas = Image.new("RGB", (pad * 3 + sw * 2, pad * 2 + sh + 40 + HEADER_H * scale),
                       (214, 214, 218))
    canvas.paste(a.resize((sw, sh), Image.LANCZOS), (pad, pad))
    canvas.paste(b.resize((sw, sh), Image.LANCZOS), (pad * 2 + sw, pad))
    canvas.paste(h.resize((HEADER_W * scale, HEADER_H * scale), Image.LANCZOS),
                 (pad, pad * 2 + sh))
    prev = os.path.join(BUILD, "_installer-preview.png")
    canvas.save(prev)
    print(f"\n预览: {prev}")
