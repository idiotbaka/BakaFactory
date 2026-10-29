"""Rebuild P2 clockwork-colleague story assets with the approved opening pipeline. Requires Pillow."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OPENING = HERE.parent / "opening-ai09-v1"
DEST = ROOT / "apps/web/src/assets/stories/p2-clockwork-ai09-v1"
NAMES = [
    "01-welcome-headless-colleague.png",
    "02-thirty-turn-wake-up.png",
    "03-patient-charcoal-waiter.png",
    "04-perfect-attendance.png",
    "05-handover-rejected.png",
]
# Measured on the final 384x360 grid; the opening warm-skin predicate further
# limits these boxes to skin, leaving hair, clothing and scenery untouched.
REGIONS = [
    [(146, 100, 181, 134), (129, 123, 146, 150),
     (118, 190, 156, 209), (203, 214, 237, 244)],
    [(58, 53, 86, 84), (56, 76, 66, 91), (48, 127, 57, 140)],
    [(80, 137, 95, 155), (31, 189, 54, 205), (58, 154, 78, 169)],
    [(248, 152, 270, 198), (318, 190, 363, 209),
     (216, 222, 261, 259), (126, 248, 166, 301)],
    [(130, 161, 140, 172), (156, 171, 173, 190), (192, 187, 215, 210)],
]
# Paper, sunset and mustard cart paint must not inherit skin tones. These
# measured local outlines intersect the unchanged opening warm-color predicate.
SKIN_OUTLINES = {
    0: [
        [(146, 100), (181, 100), (181, 134), (146, 134)],
        [(129, 123), (146, 123), (146, 150), (129, 150)],
        [(118, 190), (156, 190), (156, 209), (118, 209)],
        [(204, 219), (209, 217), (216, 218), (227, 221),
         (232, 226), (235, 233), (233, 240), (229, 243),
         (225, 239), (225, 233), (220, 229), (217, 231),
         (214, 231), (208, 227), (204, 224)],
    ],
    3: [
        [(249, 153), (260, 163), (262, 175), (269, 196),
         (264, 194), (260, 185), (254, 176), (253, 167)],
        [(319, 199), (330, 193), (350, 190), (361, 198),
         (356, 202), (341, 206), (327, 207)],
        [(228, 223), (241, 225), (248, 231), (255, 238),
         (260, 245), (254, 257), (240, 253), (229, 245),
         (222, 242), (219, 238), (221, 233), (224, 229), (229, 229)],
        [(129, 251), (132, 250), (136, 263), (144, 266),
         (142, 252), (145, 249), (151, 253), (158, 266),
         (163, 282), (163, 287), (154, 298), (140, 291),
         (131, 283), (128, 271), (127, 260)],
    ],
    4: [
        [(130, 161), (140, 161), (140, 172), (130, 172)],
        [(157, 177), (161, 174), (165, 172), (171, 172),
         (171, 176), (168, 179), (166, 183), (160, 188), (157, 185)],
        [(193, 197), (197, 191), (204, 189), (209, 188),
         (212, 191), (211, 196), (213, 198), (211, 204),
         (208, 207), (200, 208), (194, 204)],
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
