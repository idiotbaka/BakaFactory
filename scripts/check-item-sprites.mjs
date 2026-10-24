import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "apps/web/src/assets/items/v3");
const catalog = JSON.parse(
  await readFile(
    path.join(root, "apps/server/internal/catalog/definitions.json"),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
if (manifest.size !== 128 || manifest.logicalSize !== 32)
  throw new Error("Item sprites must use 128px files with a 32px logical grid");
const expected = new Map(catalog.items.map((item) => [item.id, item]));
const files = (await readdir(directory)).filter((file) =>
  file.endsWith(".png"),
);
const ids = Object.keys(manifest.items);
if (ids.length !== expected.size || files.length !== expected.size)
  throw new Error(
    "Item sprite manifest, PNGs and catalog must have equal coverage",
  );
const pngs = new Set(files);
let bytes = 0;
await Promise.all(
  ids.map(async (id) => {
    const item = expected.get(id);
    if (!item || !pngs.has(`${id}.png`))
      throw new Error(`Missing or unexpected item sprite: ${id}`);
    if (manifest.items[id].tier !== (item.tier ?? 1))
      throw new Error(`Incorrect sprite stage: ${id}`);
    const png = await readFile(path.join(directory, `${id}.png`));
    if (
      !png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      png.subarray(12, 16).toString() !== "IHDR" ||
      png.readUInt32BE(16) !== 128 ||
      png.readUInt32BE(20) !== 128 ||
      png[24] !== 8 ||
      png[25] !== 6
    )
      throw new Error(`Expected a 128x128 RGBA PNG: ${id}`);
    bytes += png.length;
  }),
);
console.log(
  `Item sprites: ${ids.length} catalog IDs covered by 128px RGBA PNGs (${Math.ceil(bytes / 1024)} KiB)`,
);
