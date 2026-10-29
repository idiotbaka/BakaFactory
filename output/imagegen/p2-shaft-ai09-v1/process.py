"""Rebuild P2 shaft-overload story assets with the approved opening pipeline. Requires Pillow."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OPENING = HERE.parent / "opening-ai09-v1"
DEST = ROOT / "apps/web/src/assets/stories/p2-shaft-ai09-v1"
NAMES = [
    "01-claws-at-full-power.png",
    "02-one-furnace-for-all.png",
    "03-overload-slow-motion.png",
    "04-future-energy-atlas.png",
    "05-more-furnaces-more-power.png",
]
# Measured on the final 384x360 grid; the opening warm-skin predicate further
# limits these boxes to skin, leaving hair, clothing and scenery untouched.
REGIONS = [
    [(80, 40, 99, 65), (135, 28, 154, 49), (115, 94, 130, 119)],
    [(123, 187, 140, 207), (91, 185, 106, 206)],
    [(80, 125, 124, 164), (74, 157, 89, 177),
     (130, 107, 150, 141), (60, 189, 94, 212)],
    [(264, 95, 301, 150), (330, 142, 365, 159),
     (126, 259, 170, 307), (212, 209, 259, 238)],
    [(287, 80, 308, 105), (334, 82, 352, 102), (250, 131, 266, 155)],
]
# Warm paper is close to skin in the atlas. Measured silhouettes restrict
# the unchanged opening warm-color predicate to face, nape and both hands.
SKIN_OUTLINES = {
    3: [
        [(265, 96), (276, 103), (278, 113), (285, 124),
         (289, 133), (298, 141), (298, 147), (290, 142),
         (280, 135), (274, 126), (270, 118), (267, 109), (266, 103)],
        [(330, 147), (340, 146), (354, 142), (364, 146),
         (359, 153), (344, 157), (334, 155)],
        [(128, 271), (134, 269), (145, 277), (148, 262),
         (151, 261), (156, 267), (159, 277), (164, 285),
         (168, 291), (164, 299), (158, 305), (145, 302),
         (136, 298), (132, 291), (128, 286), (128, 280)],
        [(213, 216), (224, 211), (235, 210), (245, 214),
         (257, 221), (251, 237), (237, 235), (225, 230), (219, 223)],
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
            assert samples, "Expected skin inside measured silhouettes"
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
