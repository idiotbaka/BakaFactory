"""Rebuild the review assets from the generated sheet. Requires Python + Pillow.

Run from the repository root:
    python3 output/imagegen/item-icons-v1/process.py
Use --font to choose a CJK font when the preview font cannot be discovered.
"""

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ITEM_IDS = [
    "i0001", "i0002", "i0004", "i0049",
    "i0110", "i0108", "i0139", "i0146",
    "i0192", "i0213", "i0248", "i0264",
    "i0328", "i0331", "i0334", "i0341",
]
ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent


def clean_mask(mask):
    """Discard tiny disconnected generation artifacts; preserve real scrap pieces."""
    width, height = mask.size
    pixels = mask.tobytes()
    seen = bytearray(width * height)
    components = []
    for start, value in enumerate(pixels):
        if not value or seen[start]:
            continue
        seen[start] = 1
        queue = deque([start])
        component = []
        while queue:
            pos = queue.popleft()
            component.append(pos)
            x, y = pos % width, pos // width
            neighbors = []
            if x:
                neighbors.append(pos - 1)
            if x + 1 < width:
                neighbors.append(pos + 1)
            if y:
                neighbors.append(pos - width)
            if y + 1 < height:
                neighbors.append(pos + width)
            for nxt in neighbors:
                if pixels[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    queue.append(nxt)
        components.append(component)
    if not components:
        raise ValueError("An empty sprite cell was encountered")
    minimum = max(12, round(max(map(len, components)) * 0.05))
    cleaned = bytearray(width * height)
    for component in components:
        if len(component) >= minimum:
            for pos in component:
                cleaned[pos] = 255
    return Image.frombytes("L", mask.size, bytes(cleaned))


def sprite_from_cell(cell, outline):
    mask = clean_mask(cell.getchannel("A").point(lambda a: 255 if a >= 220 else 0))
    bounds = mask.getbbox()
    cell.putalpha(mask)
    body = cell.crop(bounds)
    scale = min(26 / body.width, 26 / body.height)
    size = (max(1, round(body.width * scale)), max(1, round(body.height * scale)))
    # Area sampling preserves thin features. Palette reduction and binary alpha
    # happen at the final resolution, leaving no blended transparency or dithering.
    body = body.resize(size, Image.Resampling.BOX)
    alpha = body.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
    body = body.convert("RGB").quantize(
        colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    ).convert("RGBA")
    body.putalpha(alpha)
    icon = Image.new("RGBA", (32, 32))
    icon.alpha_composite(body, ((32 - body.width) // 2, (32 - body.height) // 2))
    silhouette = icon.getchannel("A")
    inner_edge = ImageChops.subtract(silhouette, silhouette.filter(ImageFilter.MinFilter(3)))
    icon.paste("#17172e", (0, 0, 32, 32), inner_edge)
    outer_edge = ImageChops.subtract(silhouette.filter(ImageFilter.MaxFilter(3)), silhouette)
    icon.paste(outline, (0, 0, 32, 32), outer_edge)
    # Zero RGB in transparent pixels for clean atlas packing and deterministic PNGs.
    result = Image.new("RGBA", (32, 32))
    result.paste(icon, mask=icon.getchannel("A"))
    return result, bounds


def font_path(override):
    candidates = [override] if override else [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "C:/Windows/Fonts/msyh.ttc",
    ]
    for path in candidates:
        if path and Path(path).is_file():
            return path
    raise RuntimeError("Preview needs a CJK font; pass --font path/to/font.ttf")


def checker(size, light=False):
    colors = ("#e4e6ed", "#c7cbd8") if light else ("#11182b", "#182239")
    image = Image.new("RGBA", size, colors[0])
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 8):
        for x in range(0, size[0], 8):
            if (x // 8 + y // 8) % 2:
                draw.rectangle((x, y, x + 7, y + 7), fill=colors[1])
    return image


def preview(items, icons, path):
    width, height = 1120, 1224
    canvas = Image.new("RGBA", (width, height), "#070912")
    draw = ImageDraw.Draw(canvas)
    fonts = {size: ImageFont.truetype(path, size) for size in (14, 18, 22, 32)}
    draw.text((24, 18), "BAKAFACTORY / 物品像素贴图 · 首批样稿", font=fonts[32], fill="#eeedf9")
    draw.text((24, 66), "16 款 · 六阶段描边 · 透明 PNG · 左侧 4 倍放大 / 右侧原生 32px", font=fonts[18], fill="#a8b3cf")
    draw.text((24, 100), "阶段色沿物品轮廓绘制；没有方形图标底板。样稿尚未接入游戏。", font=fonts[18], fill="#46eff2")
    for n, (item, icon) in enumerate(zip(items, icons)):
        x, y = 24 + (n % 4) * 272, 148 + (n // 4) * 258
        draw.rounded_rectangle((x, y, x + 255, y + 241), radius=8, fill="#101220", outline="#303650")
        draw.rectangle((x + 1, y + 1, x + 254, y + 4), fill=item["color"])
        large = checker((128, 128))
        large.alpha_composite(icon.resize((128, 128), Image.Resampling.NEAREST))
        canvas.alpha_composite(large, (x + 16, y + 20))
        for dy, light in ((24, False), (100, True)):
            small = checker((64, 48), light)
            small.alpha_composite(icon, (16, 8))
            canvas.alpha_composite(small, (x + 172, y + dy))
        draw.text((x + 16, y + 158), item["name"], font=fonts[22], fill="#eeedf9")
        draw.text((x + 16, y + 195), f'P{item["tier"]}  /  {item["id"]}', font=fonts[18], fill=item["color"])
        draw.text((x + 172, y + 78), "32 × 32", font=fonts[14], fill="#a8b3cf")
    draw.text((24, 1194), "ImageGen 批量绘制 → 裁切 → 32px 调色与硬边处理 → 精确阶段色描边", font=fonts[18], fill="#a8b3cf")
    canvas.convert("RGB").save(OUT / "preview.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "apps/server/internal/catalog/definitions.json").read_text())
    lookup = {item["id"]: item for item in catalog["items"]}
    items = [lookup[item_id] for item_id in ITEM_IDS]
    source = Image.open(OUT / "source-sheet.png").convert("RGBA")
    (OUT / "icons32").mkdir(exist_ok=True)
    atlas = Image.new("RGBA", (128, 128))
    icons, entries = [], []
    for n, item in enumerate(items):
        col, row = n % 4, n // 4
        box = (
            round(col * source.width / 4), round(row * source.height / 4),
            round((col + 1) * source.width / 4), round((row + 1) * source.height / 4),
        )
        icon, bounds = sprite_from_cell(source.crop(box), item["color"])
        file = f'icons32/{item["id"]}.png'
        icon.save(OUT / file)
        atlas.alpha_composite(icon, (col * 32, row * 32))
        icons.append(icon)
        entries.append({
            "id": item["id"], "name": item["name"], "stage": item["tier"],
            "outline": item["color"], "file": file, "row": row, "column": col,
            "source_cell": box, "source_content_bounds": bounds,
        })
    atlas.save(OUT / "atlas-32.png")
    atlas.resize((768, 768), Image.Resampling.NEAREST).save(OUT / "atlas-6x.png")
    preview(items, icons, font_path(args.font))
    manifest = {
        "status": "sample-awaiting-user-review", "generator": "built-in image_gen",
        "source": "source-sheet.png", "prompt": "prompt.txt", "size": [32, 32],
        "atlas": "atlas-32.png", "grid": [4, 4], "items": entries,
        "processing": {
            "source_alpha_threshold": 220, "fit_body_max": 26,
            "sampling": "BOX then 24-color quantization, no dithering",
            "final_alpha": [0, 255], "outline_width_px": 1,
            "outline_source": "item.color from catalog; outline follows silhouette",
            "preview_upscale": "nearest-neighbor",
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    report = []
    for item, icon in zip(items, icons):
        alpha = set(icon.getchannel("A").tobytes())
        assert icon.size == (32, 32) and icon.mode == "RGBA"
        assert alpha == {0, 255}, item["id"]
        bounds = icon.getbbox()
        assert bounds and min(bounds[:2]) >= 2 and max(bounds[2:]) <= 30, item["id"]
        assert (*bytes.fromhex(item["color"].removeprefix("#")), 255) in set(icon.get_flattened_data()), item["id"]
        report.append({"id": item["id"], "size": [32, 32], "mode": icon.mode, "alpha": sorted(alpha), "bounds": bounds})
    (OUT / "validation.json").write_text(json.dumps({"count": len(report), "items": report}, indent=2) + "\n")
    print(f"Exported {len(icons)} transparent 32x32 icons, atlas, preview, manifest and validation report")


if __name__ == "__main__":
    main()
