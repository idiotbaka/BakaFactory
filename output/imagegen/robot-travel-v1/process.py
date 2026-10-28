"""Crop the approved ImageGen atlases; run with Python + Pillow from any cwd."""
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "apps/web/src/assets/robots/v1"
OUT.mkdir(parents=True, exist_ok=True)
BATCHES = [
    ("p2-p3", ["i0108", "i0168", "i0169"], True),
    ("p4-p5-carriers", ["i0226", "i0227", "i0279"], False),
    ("p5-p6-service", ["i0280", "i0295", "i0341"], False),
]
DIRECTIONS = ["side", "up", "down"]
manifest = {"version": 1, "size": 128, "logicalSize": 32, "robots": {}}
preview = Image.new("RGBA", (9 * 128, 3 * 128), "#101220")
for batch_index, (batch, ids, mirror) in enumerate(BATCHES):
    source = Image.open(HERE / f"{batch}-source.png").convert("RGBA")
    for row, item in enumerate(ids):
        crops = []
        for col in range(3):
            image = source.crop((col * source.width // 3, row * source.height // 3,
                                 (col + 1) * source.width // 3, (row + 1) * source.height // 3))
            alpha = image.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
            image.putalpha(alpha)
            bounds = alpha.getbbox()
            if not bounds:
                raise ValueError(f"Empty sprite: {item}:{col}")
            image = image.crop(bounds)
            if col == 0 and mirror:
                image = ImageOps.mirror(image)
            crops.append(image)
        scale = 26 / max(max(image.size) for image in crops)
        for col, (direction, image) in enumerate(zip(DIRECTIONS, crops)):
            image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.NEAREST)
            alpha = image.getchannel("A")
            colors = image.convert("RGB").quantize(colors=16, dither=Image.Dither.NONE).convert("RGBA")
            colors.putalpha(alpha)
            logical = Image.new("RGBA", (32, 32))
            logical.alpha_composite(colors, ((32 - colors.width) // 2, 29 - colors.height))
            sprite = logical.resize((128, 128), Image.Resampling.NEAREST)
            sprite.save(OUT / f"{item}-{direction}.png", optimize=True)
            preview.alpha_composite(sprite, ((batch_index * 3 + row) * 128, col * 128))
            assert set(sprite.getchannel("A").tobytes()) <= {0, 255}
            assert sum(1 for _, rgba in sprite.getcolors(128 * 128) if rgba[3]) <= 16
        manifest["robots"][item] = {"source": batch, "row": row, "sideFaces": "right", "directions": DIRECTIONS}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
preview.save(HERE / "preview.png", optimize=True)
print("Robot sprites: 9 models / 27 directions, 128px RGBA, binary alpha, <=16 colors.")
