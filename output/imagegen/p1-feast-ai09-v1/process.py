"""Rebuild P1 story assets with the approved opening pipeline. Requires Pillow."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OPENING = HERE.parent / "opening-ai09-v1"
DEST = ROOT / "apps/web/src/assets/stories/p1-feast-ai09-v1"
NAMES = [
    "01-parts-within-parts.png",
    "02-hands-learn-the-job.png",
    "03-graduation-becomes-materials.png",
    "04-factory-tasting-menu.png",
    "05-factory-is-hungry.png",
]
# Measured on the final 384x360 grid; the opening warm-skin predicate further
# limits these boxes to skin, leaving hair, clothing and scenery untouched.
REGIONS = [
    [(169, 56, 262, 127), (168, 92, 212, 139),
     (228, 101, 265, 139), (264, 207, 321, 254)],
    [(105, 143, 181, 202)],
    [(103, 95, 176, 151), (107, 127, 145, 159),
     (173, 71, 198, 111), (94, 248, 143, 280)],
    [(72, 103, 102, 140), (79, 130, 98, 150),
     (89, 189, 118, 211), (115, 205, 131, 216)],
    [(271, 196, 283, 215), (232, 253, 255, 274)],
]


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
