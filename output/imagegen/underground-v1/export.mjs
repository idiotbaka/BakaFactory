// Asset preparation only. Requires sharp available through NODE_PATH.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const sharp = createRequire(import.meta.url)("sharp");
const root = new URL("../../../", import.meta.url);
const source = fileURLToPath(new URL("source.png", import.meta.url));
const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let left = info.width,
  right = 0,
  top = info.height,
  bottom = 0;
for (let y = 0; y < info.height; y++)
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] >= 128) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
const pixels = await sharp(source)
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
  .resize(26, 26, {
    fit: "contain",
    kernel: "nearest",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .ensureAlpha()
  .raw()
  .toBuffer();
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i + 3] = pixels[i + 3] >= 128 ? 255 : 0;
  if (!pixels[i + 3]) pixels.fill(0, i, i + 3);
}
const palette = await sharp(pixels, {
  raw: { width: 26, height: 26, channels: 4 },
})
  .png({ palette: true, colours: 16, dither: 0 })
  .toBuffer();
const art = await sharp(palette).ensureAlpha().raw().toBuffer();
const canvas = Buffer.alloc(32 * 32 * 4);
for (let y = 0; y < 26; y++)
  for (let x = 0; x < 26; x++) {
    const i = (y * 26 + x) * 4;
    if (!art[i + 3]) continue;
    // One logical pixel black silhouette, then stamp the generated artwork.
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const j = ((y + 3 + dy) * 32 + x + 3 + dx) * 4;
      canvas.set([8, 9, 19, 255], j);
    }
  }
for (let y = 0; y < 26; y++)
  for (let x = 0; x < 26; x++) {
    const i = (y * 26 + x) * 4;
    if (art[i + 3])
      canvas.set(art.subarray(i, i + 4), ((y + 3) * 32 + x + 3) * 4);
  }
const destination = new URL("apps/web/src/assets/items/v3/d0001.png", root);
await sharp(canvas, { raw: { width: 32, height: 32, channels: 4 } })
  .resize(128, 128, { kernel: "nearest" })
  .png({ palette: false })
  .toFile(fileURLToPath(destination));
const itemManifestPath = new URL(
  "apps/web/src/assets/items/v3/manifest.json",
  root,
);
const items = JSON.parse(await readFile(itemManifestPath, "utf8"));
items.items.d0001 = { tier: 2 };
await writeFile(itemManifestPath, JSON.stringify(items, null, 2) + "\n");
const buildingPath = new URL(
  "apps/web/src/assets/buildings/v1/manifest.json",
  root,
);
const buildings = JSON.parse(await readFile(buildingPath, "utf8"));
buildings.buildings.underground_belt = {
  renderer: "belt",
  tier: 2,
  color: "#a5d4b2",
};
await writeFile(buildingPath, JSON.stringify(buildings, null, 2) + "\n");
const colors = new Set();
for (let i = 0; i < canvas.length; i += 4)
  if (canvas[i + 3]) colors.add(canvas.subarray(i, i + 3).toString("hex"));
await writeFile(
  new URL("export-report.json", import.meta.url),
  JSON.stringify(
    {
      width: 128,
      height: 128,
      logical_size: 32,
      opaque_colors: colors.size,
      alpha: [0, 255],
      source: "source.png",
      prompt: "prompt.txt",
      generator: "built-in image_gen",
    },
    null,
    2,
  ) + "\n",
);
