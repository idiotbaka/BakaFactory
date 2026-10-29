import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const manifest = JSON.parse(
  await readFile(new URL("prompts.json", import.meta.url), "utf8"),
);
const assets = [];
for (const { asset } of manifest.prompts) {
  const path = `apps/web/src/assets/stories/p2-clockwork-v1/${asset}.png`;
  const bytes = await readFile(new URL(`../../../${path}`, import.meta.url));
  if (
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== manifest.export.width ||
    bytes.readUInt32BE(20) !== manifest.export.height
  )
    throw new Error(`PNG format or dimensions do not match: ${path}`);
  assets.push({
    path,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (new Set(assets.map((asset) => asset.sha256)).size !== 5)
  throw new Error("Expected five distinct illustrations");
await writeFile(
  new URL("asset-validation.json", import.meta.url),
  `${JSON.stringify({ assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2)}\n`,
);
console.log("Story art: five distinct 1672x941 PNGs verified.");
