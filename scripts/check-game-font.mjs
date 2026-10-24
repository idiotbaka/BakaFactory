import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL("../apps/web/public/fonts/fusion-pixel/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", base), "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const font = await readFile(new URL(manifest.file, base));
if (
  font.toString("ascii", 0, 4) !== "wOF2" ||
  font.readUInt32BE(8) !== font.length ||
  font.length !== manifest.bytes ||
  hash(font) !== manifest.sha256
)
  throw new Error("Bundled Fusion Pixel WOFF2 differs from its pinned release");
for (const license of manifest.licenses) {
  if (hash(await readFile(new URL(license.file, base))) !== license.sha256)
    throw new Error(`Font license missing or changed: ${license.file}`);
}
const [css, html, loader] = await Promise.all(
  [
    "../apps/web/src/style.css",
    "../apps/web/index.html",
    "../apps/web/src/game/gameAssets.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
if (
  ![css, html, loader].every((source) => source.includes(manifest.file)) ||
  !css.includes(`font-family: "${manifest.family}"`)
)
  throw new Error(
    "Font CSS, document preload and game resource gate must use the same pinned font",
  );
console.log(
  `Game font: Fusion Pixel ${manifest.release}, ${Math.ceil(font.length / 1024)} KiB WOFF2, ${manifest.licenses.length} original license files verified.`,
);
