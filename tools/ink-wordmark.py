"""把四张书法字图片处理成首页字标（wordmark）可直接使用的 WebP。

用法：
    1. 把原图放进 web/assets/images/title/source/，按 wen/xiang/zhi/pei 命名（png/jpg 都行）
    2. python tools/ink-wordmark.py
    3. 产物在 web/assets/images/title/*.webp

处理做了三件事：
    - 抠掉背景：只保留 alpha，宣纸白底变成透明；
    - 统一比例：四个字按同一「字身高度」缩放，宽字（配）限宽，底部对齐同一基线；
    - 上色：默认墨色 #1b1815，后两个字另外生成赭色 #a94a24 版本。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "assets" / "images" / "title" / "source"
OUT = ROOT / "web" / "assets" / "images" / "title"

INK = (27, 24, 21)       # 对应 --ink
CLAY = (169, 74, 36)     # 对应 --clay
GLYPHS = ["wen", "xiang", "zhi", "pei"]
ACCENT = {"zhi", "pei"}  # 这两个字额外生成赭色版

DESIGN_H = 1000          # 设计稿里的字身高度
MAX_RATIO = 1.30         # 单字最大宽高比，超出就按宽度缩
CANVAS_H = 1.05          # 画布高 = 字身高度 × 1.05，多出来的一点留白在顶部
CANVAS_PX = 300          # 输出画布高度（约等于页面上的 1em，按 3x 屏留足余量）


def load_glyph(name: str) -> Image.Image:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        path = SRC / f"{name}{ext}"
        if path.exists():
            image = Image.open(path).convert("RGBA")
            break
    else:
        raise SystemExit(f"缺少原图：{SRC / (name + '.png')}")
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"原图是全透明的：{path}")
    return image.crop(box)


def fit(glyph: Image.Image, height: int) -> Image.Image:
    width, ratio = glyph.width, glyph.width / glyph.height
    target_w = min(round(height * ratio), round(height * MAX_RATIO))
    target_h = round(target_w / ratio)
    return glyph.resize((target_w, target_h), Image.LANCZOS)


def tint(glyph: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    solid = Image.new("RGBA", glyph.size, color + (0,))
    solid.putalpha(glyph.getchannel("A"))
    return solid


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    glyphs = {name: fit(load_glyph(name), DESIGN_H) for name in GLYPHS}

    canvas_h = round(DESIGN_H * CANVAS_H)
    scale = CANVAS_PX / canvas_h

    for name, glyph in glyphs.items():
        # 画布只有字宽（左右不留白，字距交给 CSS 的 gap），高度固定成「字身」，
        # 字贴底放：这样四张图都按 1em 显示时，基线齐、字距匀、大小关系也对。
        canvas = Image.new("RGBA", (glyph.width, canvas_h), (0, 0, 0, 0))
        canvas.alpha_composite(glyph, (0, canvas_h - glyph.height))
        canvas = canvas.resize(
            (max(1, round(glyph.width * scale)), CANVAS_PX), Image.LANCZOS
        )

        variants = {"": INK}
        if name in ACCENT:
            variants["-clay"] = CLAY
        for suffix, color in variants.items():
            path = OUT / f"{name}{suffix}.webp"
            tint(canvas, color).save(path, "WEBP", quality=92, method=6)
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
