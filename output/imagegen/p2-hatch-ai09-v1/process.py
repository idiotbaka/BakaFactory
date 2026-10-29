"""Rebuild P2 crowded-hatch story assets with the approved opening pipeline. Requires Pillow."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OPENING = HERE.parent / "opening-ai09-v1"
DEST = ROOT / "apps/web/src/assets/stories/p2-hatch-ai09-v1"
NAMES = [
    "01-crowded-doors.png",
    "02-charcoal-vip.png",
    "03-rush-hour-again.png",
    "04-extra-mouths.png",
    "05-clock-out-rejected.png",
]
# Measured on the final 384x360 grid; the opening warm-skin predicate further
# limits these boxes to skin, leaving hair, clothing and scenery untouched.
REGIONS = [
    [(247, 204, 267, 226), (299, 166, 320, 184)],
    [(100, 66, 141, 117), (95, 103, 116, 127),
     (101, 164, 131, 194), (140, 172, 151, 198)],
    [(142, 80, 160, 108), (138, 100, 148, 115),
     (162, 183, 180, 201), (72, 194, 85, 207)],
    [(124, 128, 142, 170), (105, 154, 142, 182),
     (230, 279, 275, 323)],
    [(131, 79, 164, 122), (113, 116, 132, 146),
     (266, 122, 309, 155), (92, 249, 119, 288)],
]
# These close views put warm paper / sunset walls beside the skin. Intersect
# the usual boxes and warm-color predicate with measured silhouettes so those
# surfaces never inherit the protected skin palette.
SKIN_OUTLINES = {
    3: [
        [(127, 131), (135, 139), (136, 150), (131, 160),
         (123, 169), (119, 175), (116, 175), (120, 162),
         (124, 151)],
        [(102, 171), (113, 174), (119, 179), (119, 183),
         (110, 181), (103, 177)],
        [(230, 301), (236, 293), (245, 285), (251, 283),
         (259, 285), (265, 288), (266, 292), (271, 295),
         (272, 301), (275, 305), (272, 310), (263, 316),
         (253, 321), (245, 318), (238, 313)],
    ],
    4: [
        [(266, 140), (277, 135), (285, 130), (293, 127),
         (308, 127), (310, 131), (297, 137), (302, 140),
         (302, 144), (298, 147), (299, 149), (292, 152),
         (282, 154), (270, 151)],
        [(131, 79), (164, 79), (164, 122), (131, 122)],
        [(113, 116), (132, 116), (132, 146), (113, 146)],
        [(92, 249), (119, 249), (119, 288), (92, 288)],
    ],
}


def main():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("opening_art", OPENING / "process.py")
    opening = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(opening)
    palette = [tuple(color) for color in json.loads(
        (OPENING / "asset-validation.json").read_text(encoding="utf-8")
    )["shared_skin_palette"]]
    assert len(palette) == 6
    DEST.mkdir(parents=True, exist_ok=True)
    records = []
    sheet = Image.new("RGB", (768 * 3, 720 * 2), "#151520")
    for index, name in enumerate(NAMES):
        with Image.open(HERE / "sources" / name) as source:
            source_size = list(source.size)
            crop_box = list(opening.source_box(source))
            pre = opening.preprocess(source)
        base = pre.quantize(colors=64, method=Image.Quantize.MEDIANCUT,
                            dither=Image.Dither.NONE).convert("RGB")
        result = base.copy()
        positions, colors = opening.skin_samples(pre, REGIONS[index])
        if index in SKIN_OUTLINES:
            mask = Image.new("1", result.size)
            draw = ImageDraw.Draw(mask)
            for outline in SKIN_OUTLINES[index]:
                draw.polygon(outline, fill=1)
            samples = [(position, color) for position, color in zip(positions, colors)
                       if mask.getpixel(position)]
            positions, colors = map(list, zip(*samples))
        for position, color in zip(positions, colors):
            result.putpixel(position, opening.nearest_skin(color, palette))
        protected = set(positions)
        assert positions, "Expected visible skin in each panel"
        assert all(result.getpixel((x, y)) == base.getpixel((x, y))
                   for y in range(360) for x in range(384)
                   if (x, y) not in protected)
        unique = len(set(opening.pixels(result)))
        assert result.size == (384, 360) and unique <= 70
        path = DEST / name
        result.save(path)
        with Image.open(path) as saved:
            assert saved.format == "PNG" and saved.mode == "RGB"
            assert saved.tobytes() == result.tobytes()
        preview = result.resize((768, 720), Image.Resampling.NEAREST)
        preview.save(HERE / f"{index + 1:02}-preview-2x.png")
        sheet.paste(preview, ((index % 3) * 768, (index // 3) * 720))
        records.append({
            "path": path.relative_to(ROOT).as_posix(),
            "width": 384, "height": 360, "source_size": source_size,
            "source_crop_box": crop_box, "colors": unique,
            "skin_regions": REGIONS[index],
            "skin_outlines": SKIN_OUTLINES.get(index),
            "protected_skin_pixels": len(positions),
            "non_skin_pixels_unchanged": True,
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    assert len({record["sha256"] for record in records}) == 5
    sheet.save(HERE / "contact-sheet-2x.png")
    (HERE / "asset-validation.json").write_text(json.dumps({
        "pipeline": "opening-ai09-v1/process.py (unchanged)",
        "shared_skin_palette": palette, "assets": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(records, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
