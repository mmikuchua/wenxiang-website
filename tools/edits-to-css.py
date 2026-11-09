"""把 ?edit=1 导出的 JSON 里的 offset / size 转成可以直接贴进 CSS 的规则。

用法：
    python tools/edits-to-css.py .shots/export.json
    python tools/edits-to-css.py .shots/export.json > web/assets/css/tuning.css

规则形式：
    <selector> { font-size: 1.27em; transform: translate(0.1em, 0.2em); }
"""
import json
import sys
from pathlib import Path


def fmt(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法: python tools/edits-to-css.py <export.json>")
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    offsets = data.get("offset") or {}
    sizes = data.get("size") or {}

    print("/* 由 tools/edits-to-css.py 生成：?edit=1 的拖动与缩放结果 */")
    for selector in dict.fromkeys([*offsets, *sizes]):
        declarations = []
        size = sizes.get(selector)
        if size and size.get("kind") == "font":
            declarations.append(f"font-size: {fmt(size['value'])}em")
        offset = offsets.get(selector) or {"x": 0, "y": 0}
        if offset["x"] or offset["y"]:
            declarations.append(
                f"transform: translate({fmt(offset['x'])}em, {fmt(offset['y'])}em)"
            )
        scale = size["value"] if size and size.get("kind") == "scale" else None
        if scale and scale != 1:
            declarations.append(f"transform: translate({fmt(offset['x'])}em, {fmt(offset['y'])}em) scale({fmt(scale)})")
        if not declarations:
            continue
        # transform 同时可能来自 offset 与 scale，去重后只保留最后一条
        if len([d for d in declarations if d.startswith("transform")]) > 1:
            declarations = [d for d in declarations if not d.startswith("transform")]
            declarations.append(
                f"transform: translate({fmt(offset['x'])}em, {fmt(offset['y'])}em) scale({fmt(scale)})"
            )
        print(f"{selector} {{ {'; '.join(declarations)}; }}")


if __name__ == "__main__":
    main()
