import { readFile, readdir } from "node:fs/promises";
const directory = new URL("../apps/web/src/assets/robots/v1/", import.meta.url);
const catalog = JSON.parse(
  await readFile(
    new URL(
      "../apps/server/internal/catalog/definitions.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", directory), "utf8"),
);
const files = (await readdir(directory)).filter((f) => f.endsWith(".png"));
if (
  manifest.size !== 128 ||
  manifest.logicalSize !== 32 ||
  files.length !== catalog.robots.length * 3 ||
  Object.keys(manifest.robots).length !== catalog.robots.length
)
  throw new Error("Robot sprite coverage/grid mismatch");
for (const robot of catalog.robots) {
  if (manifest.robots[robot.item]?.sideFaces !== "right")
    throw new Error(`Missing directional robot: ${robot.item}`);
  for (const direction of ["side", "up", "down"]) {
    const png = await readFile(
      new URL(`${robot.item}-${direction}.png`, directory),
    );
    if (
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.readUInt32BE(16) !== 128 ||
      png.readUInt32BE(20) !== 128 ||
      png[24] !== 8 ||
      png[25] !== 6
    )
      throw new Error(`Invalid robot PNG: ${robot.item}-${direction}`);
  }
}
console.log(
  `Robot sprites: ${catalog.robots.length} models / ${files.length} directions, 128px RGBA.`,
);
