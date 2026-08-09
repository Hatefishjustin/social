# -*- coding: utf-8 -*-
# 生成微信分享封面 /assets/share-cover.png (1200x630)
# SoulMirror Luxury / Editorial 风格
# 背景 #F9F8F6  文字 #1A1A1A  点缀 #D4AF37
import sys, traceback, os

try:
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1200, 630
    BG = (249, 248, 246)      # #F9F8F6
    INK = (26, 26, 26)        # #1A1A1A
    GOLD = (212, 175, 55)     # #D4AF37
    GRAY = (120, 118, 114)    # 次级文字

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    def font(size):
        for p in [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/simhei.ttf",
        ]:
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    continue
        return ImageFont.load_default()

    # 1. 顶部细金线
    draw.rectangle([0, 0, W, 6], fill=GOLD)

    # 2. 居中 Logo（保留原始比例，正方形）
    logo_path = "assets/logo.png"
    logo_size = 210
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")
        logo = logo.resize((logo_size, logo_size), Image.LANCZOS)
        lx = (W - logo_size) // 2
        ly = 120
        img.paste(logo, (lx, ly), logo)

    # 3. 品牌名
    f_brand = font(64)
    brand = "SoulMirror 心镜"
    bw = draw.textlength(brand, font=f_brand)
    draw.text(((W - bw) / 2, 380), brand, font=f_brand, fill=INK)

    # 4. 金色分隔线
    line_w = 120
    draw.rectangle([(W - line_w) / 2, 500, (W + line_w) / 2, 502], fill=GOLD)

    # 5. 描述
    f_desc = font(30)
    desc = "探索你的灵魂匹配"
    dw = draw.textlength(desc, font=f_desc)
    draw.text(((W - dw) / 2, 540), desc, font=f_desc, fill=GRAY)

    # 6. 底部细金线
    draw.rectangle([0, H - 6, W, H], fill=GOLD)

    os.makedirs("assets", exist_ok=True)
    img.save("assets/share-cover.png", "PNG")
    with open("make_cover_log.txt", "w", encoding="utf-8") as f:
        f.write("OK saved assets/share-cover.png %s\n" % (img.size,))
except Exception:
    with open("make_cover_log.txt", "w", encoding="utf-8") as f:
        f.write(traceback.format_exc())
