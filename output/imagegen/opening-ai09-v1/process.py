"""Rebuild the approved opening assets. Requires Pillow; no model/API calls."""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEST = ROOT / "apps/web/src/assets/stories/opening-ai09-v1"
SIZE = (384, 360)
NAMES = [
    "01-galactic-contract.png",
    "02-promoted-factory-chief.png",
    "03-zero-applicants.png",
    "04-build-colleagues.png",
    "05-plan-to-clock-out.png",
]


def pixels(image):
    return (image.get_flattened_data() if hasattr(image, "get_flattened_data")
            else image.getdata())

# Bounds are measured on the final 384x360 grid, then intersected with a
# warm-skin predicate. Keep clothes, paper, sunset and mechanical parts intact.
REGIONS = [
    [],
    [(85, 105, 143, 152), (108, 143, 138, 166),
     (80, 140, 111, 170), (188, 153, 223, 180)],
    [(138, 104, 177, 169), (125, 145, 162, 171),
     (150, 177, 172, 195), (128, 162, 145, 181), (207, 228, 239, 247)],
    [(96, 103, 167, 166), (143, 139, 170, 184),
     (121, 155, 145, 178), (87, 225, 126, 256)],
    [(144, 108, 153, 119), (182, 164, 195, 179), (82, 212, 96, 225)],
]


def source_box(source):
    ratio = SIZE[0] / SIZE[1]
    difference = abs(source.width / source.height / ratio - 1)
    assert difference < 0.04, "Source needs recomposition instead of stretching"
    if difference < 0.002:
        return (0, 0, source.width, source.height)
    if source.width / source.height > ratio:
        width = round(source.height * ratio)
        left = (source.width - width) // 2
        return (left, 0, left + width, source.height)
    height = round(source.width / ratio)
    top = (source.height - height) // 2
    return (0, top, source.width, top + height)


def preprocess(source):
    source = source.crop(source_box(source))
    small = source.convert("RGB").filter(ImageFilter.MedianFilter(3))
    small = small.resize(SIZE, Image.Resampling.BOX)
    small = ImageEnhance.Color(small).enhance(0.60)
    small = ImageEnhance.Brightness(small).enhance(0.90)
    return small.filter(ImageFilter.UnsharpMask(radius=0.6, percent=100, threshold=4))


def skin_samples(pre, regions):
    warm = ImageEnhance.Color(pre).enhance(1.15)
    warm = ImageEnhance.Brightness(warm).enhance(1.035)
    positions, colors = [], []
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in regions):
                continue
            r, g, b = pre.getpixel((x, y))
            if (r >= 145 and g >= 125 and b >= 115 and 6 <= r - g <= 60
                    and 2 <= g - b <= 28 and r - b <= 75):
                r, g, b = warm.getpixel((x, y))
                positions.append((x, y))
                colors.append((min(255, r + 2), g, min(255, b + 2)))
    return positions, colors


def train_skin_palette(colors):
    strip = Image.new("RGB", (len(colors), 1))
    strip.putdata(colors)
    indexed = strip.quantize(colors=6, method=Image.Quantize.MEDIANCUT,
                             dither=Image.Dither.NONE)
    return sorted(set(pixels(indexed.convert("RGB"))))


def nearest_skin(color, palette):
    return min(palette, key=lambda p: sum((a - b) ** 2 for a, b in zip(color, p)))


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    sources = [Image.open(HERE / "sources" / name) for name in NAMES]
    prepared = [preprocess(source) for source in sources]
    # Page 2 is the exact user-approved local six-color palette, not 9-bit RGB.
    palette = train_skin_palette(skin_samples(prepared[1], REGIONS[1])[1])
    records = []
    for index, (name, pre) in enumerate(zip(NAMES, prepared)):
        base = pre.quantize(colors=64, method=Image.Quantize.MEDIANCUT,
                            dither=Image.Dither.NONE).convert("RGB")
        result = base.copy()
        positions, colors = skin_samples(pre, REGIONS[index])
        if index == 1:
            # Preserve the approved page 2's original median-cut assignments.
            strip = Image.new("RGB", (len(colors), 1))
            strip.putdata(colors)
            mapped = list(pixels(strip.quantize(colors=6, method=Image.Quantize.MEDIANCUT,
                                                dither=Image.Dither.NONE).convert("RGB")))
        else:
            mapped = [nearest_skin(color, palette) for color in colors]
        for position, color in zip(positions, mapped):
            result.putpixel(position, color)
        protected = set(positions)
        assert all(result.getpixel((x, y)) == base.getpixel((x, y))
                   for y in range(SIZE[1]) for x in range(SIZE[0])
                   if (x, y) not in protected)
        unique = len(set(pixels(result)))
        assert result.size == SIZE and unique <= (70 if positions else 64)
        if index < 2:
            approved = Image.open(HERE / f"approved-{index + 1:02}.png").convert("RGB")
            assert ImageChops.difference(result, approved).getbbox() is None, "Approved page changed"
        path = DEST / name
        result.save(path)
        result.resize((768, 720), Image.Resampling.NEAREST).save(HERE / f"{index + 1:02}-preview-2x.png")
        records.append({
            "path": path.relative_to(ROOT).as_posix(), "width": 384, "height": 360,
            "source_size": list(sources[index].size),
            "source_crop_box": list(source_box(sources[index])),
            "colors": unique, "protected_skin_pixels": len(positions),
            "non_skin_pixels_unchanged": True, "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    (HERE / "asset-validation.json").write_text(json.dumps({
        "shared_skin_palette": palette, "assets": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sheet = Image.new("RGB", (768 * 3, 720), "#151520")
    for index in range(3):
        sheet.paste(Image.open(HERE / f"{index + 3:02}-preview-2x.png"), (768 * index, 0))
    sheet.save(HERE / "03-05-preview.png")
    print(json.dumps(records, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
