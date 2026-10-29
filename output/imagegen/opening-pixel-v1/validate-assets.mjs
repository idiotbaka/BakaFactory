import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = [];
for (const [name, width] of [
  ["01-galactic-contract", 1672],
  ["02-promoted-factory-chief", 1671],
]) {
  const path = `apps/web/src/assets/stories/opening-pixel-v1/${name}.png`;
  const bytes = await readFile(new URL(`../../../${path}`, import.meta.url));
  if (
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== width ||
    bytes.readUInt32BE(20) !== 941
  )
    throw new Error(`PNG format or dimensions do not match: ${path}`);
  assets.push({
    path,
    width,
    height: 941,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (new Set(assets.map((asset) => asset.sha256)).size !== 2)
  throw new Error("Expected two distinct illustrations");
await writeFile(
  new URL("asset-validation.json", import.meta.url),
  `${JSON.stringify({ assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2)}\n`,
);
console.log("Opening pixel art: two distinct PNGs verified (1672/1671 x 941).");
