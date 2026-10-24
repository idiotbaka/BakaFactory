"""Rebuild the review assets from the generated sheet. Requires Python + Pillow.

Run from the repository root:
    python3 output/imagegen/item-icons-v2/process.py
Use --font to choose a CJK font when the preview font cannot be discovered.
"""

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ITEM_IDS = [
    "i0001", "i0002", "i0004", "i0049",
    "i0110", "i0108", "i0139", "i0146",
    "i0192", "i0213", "i0248", "i0264",
    "i0328", "i0331", "i0334", "i0341",
]
ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent


def source_regions(source):
    """Assign complete silhouettes to grid slots before cutting.

    Generated grids are approximate: fingers may cross an equal-cell boundary.
    Grouping whole components by center prevents clipping or neighboring debris.
    """
    mask = source.getchannel("A").point(lambda a: 255 if a >= 220 else 0)
    width, height = mask.size
    pixels = mask.tobytes()
    seen = bytearray(width * height)
    groups = [[] for _ in ITEM_IDS]
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
        if len(component) < 64:
            continue
        cx = sum(pos % width for pos in component) / len(component)
        cy = sum(pos // width for pos in component) / len(component)
        col, row = min(3, int(cx * 4 / width)), min(3, int(cy * 4 / height))
        groups[row * 4 + col].append(component)
    regions = []
    for group in groups:
        if not group:
            raise ValueError("No visible item found in a source grid slot")
        minimum = max(map(len, group)) * 0.05
        main = max(group, key=len)
        main_bounds = (
            min(pos % width for pos in main), min(pos // width for pos in main),
            max(pos % width for pos in main), max(pos // width for pos in main),
        )
        alpha = bytearray(width * height)
        for component in group:
            cx = sum(pos % width for pos in component) / len(component)
            cy = sum(pos // width for pos in component) / len(component)
            interior = main_bounds[0] <= cx <= main_bounds[2] and main_bounds[1] <= cy <= main_bounds[3]
            if len(component) >= minimum or interior:
                for pos in component:
                    alpha[pos] = 255
        mask = Image.frombytes("L", source.size, bytes(alpha))
        bounds = mask.getbbox()
        item = source.copy()
        item.putalpha(mask)
        regions.append((item.crop(bounds), bounds))
    return regions


def sprite_from_cell(cell):
    mask = cell.getchannel("A").point(lambda a: 255 if a >= 220 else 0)
    bounds = mask.getbbox()
    cell.putalpha(mask)
    body = cell.crop(bounds)
    scale = min(28 / body.width, 28 / body.height)
    size = (max(1, round(body.width * scale)), max(1, round(body.height * scale)))
    # No averaging, smooth resizing, or dithering: keep the generated big clusters.
    body = body.resize(size, Image.Resampling.NEAREST)
    alpha = body.getchannel("A").point(lambda a: 255 if a >= 220 else 0)
    # Collapse near-identical generated shades before palette training, so tiny
    # accent clusters are not crowded out by many almost identical navy tones.
    rgb = body.convert("RGB").point(lambda v: round(round(v * 7 / 255) * 255 / 7))
    opaque = [color for color, a in zip(rgb.get_flattened_data(), alpha.tobytes()) if a]
    samples = Image.new("RGB", (len(opaque), 1))
    samples.putdata(opaque)
    # A console-style palette has 15 opaque colors plus transparency. Train it
    # only on visible pixels so hidden RGB does not displace small pink accents.
    palette = samples.quantize(colors=15, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    body = rgb.quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    body.putalpha(alpha)
    icon = Image.new("RGBA", (32, 32))
    icon.alpha_composite(body, ((32 - body.width) // 2, (32 - body.height) // 2))
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
    draw.text((24, 18), "BAKAFACTORY / MD · SFC 像素物品 · V2", font=fonts[32], fill="#eeedf9")
    draw.text((24, 66), "32 × 32 RGBA · 每件至多 15 色＋透明 · 最近邻 · 左侧 4 倍 / 右侧原尺寸", font=fonts[18], fill="#a8b3cf")
    draw.text((24, 100), "大色块与简洁明暗；阶段彩边留给游戏代码，未绘入贴图。样稿尚未接入。", font=fonts[18], fill="#46eff2")
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
    draw.text((24, 1194), "ImageGen 低分辨率构图 → 完整轮廓裁切 → 最近邻 32px → 限色硬边 PNG", font=fonts[18], fill="#a8b3cf")
    canvas.convert("RGB").save(OUT / "preview.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "apps/server/internal/catalog/definitions.json").read_text())
    lookup = {item["id"]: item for item in catalog["items"]}
    items = [lookup[item_id] for item_id in ITEM_IDS]
    source = Image.open(OUT / "source-sheet.png").convert("RGBA")
    regions = source_regions(source)
    (OUT / "icons32").mkdir(exist_ok=True)
    atlas = Image.new("RGBA", (128, 128))
    icons, entries = [], []
    for n, item in enumerate(items):
        col, row = n % 4, n // 4
        region, box = regions[n]
        icon, bounds = sprite_from_cell(region)
        file = f'icons32/{item["id"]}.png'
        icon.save(OUT / file)
        atlas.alpha_composite(icon, (col * 32, row * 32))
        icons.append(icon)
        entries.append({
            "id": item["id"], "name": item["name"], "stage": item["tier"],
            "stage_color": item["color"], "file": file, "row": row, "column": col,
            "source_region": box, "source_content_bounds": bounds,
        })
    atlas.save(OUT / "atlas-32.png")
    atlas.resize((768, 768), Image.Resampling.NEAREST).save(OUT / "atlas-6x.png")
    preview(items, icons, font_path(args.font))
    manifest = {
        "status": "sample-awaiting-user-review", "generator": "built-in image_gen",
        "source": "source-sheet.png", "prompt": "prompt.txt", "size": [32, 32],
        "atlas": "atlas-32.png", "grid": [4, 4], "items": entries,
        "processing": {
            "source_alpha_threshold": 220, "fit_body_max": 28,
            "sampling": "NEAREST, 8 channel levels, then max 15 opaque colors; no dithering",
            "final_alpha": [0, 255], "stage_outline_baked": False,
            "stage_outline_plan": "game rendering code; catalog item.color",
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
        color_count = len({pixel[:3] for pixel in icon.get_flattened_data() if pixel[3]})
        assert color_count <= 15, item["id"]
        report.append({"id": item["id"], "size": [32, 32], "mode": icon.mode, "alpha": sorted(alpha), "bounds": bounds, "opaque_colors": color_count})
    (OUT / "validation.json").write_text(json.dumps({"count": len(report), "items": report}, indent=2) + "\n")
    print(f"Exported {len(icons)} transparent 32x32 icons, atlas, preview, manifest and validation report")


if __name__ == "__main__":
    main()
