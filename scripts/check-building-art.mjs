import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "apps/web/src/assets/buildings/v1");
const catalog = JSON.parse(
  await readFile(
    path.join(root, "apps/server/internal/catalog/definitions.json"),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const files = new Set(
  (await readdir(directory)).filter((file) => file.endsWith(".png")),
);
const ids = Object.keys(manifest.buildings);
const machineNames = JSON.parse(
  await readFile(
    path.join(root, "apps/web/src/game/machineMapNames.json"),
    "utf8",
  ),
);
const machines = catalog.buildings.filter((b) => b.category === "machine");
if (Object.keys(machineNames).length !== machines.length)
  throw new Error("Machine map names must cover exactly the machine catalog");
if (new Set(Object.values(machineNames)).size !== machines.length)
  throw new Error("Machine map names must be distinct");
for (const machine of machines) {
  const name = machineNames[machine.id];
  if (typeof name !== "string" || !/^[\p{Script=Han}]{1,3}$/u.test(name))
    throw new Error(
      `Machine map name must be 1–3 Chinese characters: ${machine.id}`,
    );
}
if (
  ids.length !== catalog.buildings.length ||
  manifest.size !== 128 ||
  manifest.logicalSize !== 64
)
  throw new Error(
    "Building artwork manifest does not cover the catalog or has invalid dimensions",
  );
function renderer(b) {
  if (b.id === "conveyor" || b.role === "belt") return "belt";
  if (b.id === "pipe" || b.id === "return_pipe") return "pipe";
  return (
    { shaft: "shaft", cable: "cable", hydraulic_line: "hydraulic" }[b.role] ??
    "image"
  );
}
let facadeCount = 0,
  bytes = 0;
await Promise.all(
  catalog.buildings.map(async (b) => {
    const art = manifest.buildings[b.id];
    if (
      !art ||
      art.renderer !== renderer(b) ||
      art.tier !== (b.tier ?? null) ||
      art.color !== b.color
    )
      throw new Error(`Invalid building artwork classification/stage: ${b.id}`);
    if (art.renderer !== "image") {
      if (files.has(`${b.id}.png`))
        throw new Error(`Procedural route must not have a facade PNG: ${b.id}`);
      return;
    }
    if (!files.has(`${b.id}.png`)) throw new Error(`Missing facade: ${b.id}`);
    facadeCount++;
    const png = await readFile(path.join(directory, `${b.id}.png`));
    bytes += png.length;
    if (
      !png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      png.readUInt32BE(16) !== 128 ||
      png.readUInt32BE(20) !== 128 ||
      png[24] !== 8 ||
      png[25] !== 6
    )
      throw new Error(`Expected 128px RGBA facade: ${b.id}`);
  }),
);
if (files.size !== facadeCount) throw new Error("Unexpected facade files");
// Validate the actual renderer's pure integer geometry, not a parallel Python model.
const source = await readFile(
  path.join(root, "apps/web/src/game/routeGeometry.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const geo = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const sides = [geo.PORT_N, geo.PORT_E, geo.PORT_S, geo.PORT_W];
const opposite = new Map([
  [1, 4],
  [2, 8],
  [4, 1],
  [8, 2],
]);
const edge = (pixels, side) =>
  Array.from(
    { length: 30 },
    (_, i) =>
      pixels[
        side === 2
          ? i * 30 + 29
          : side === 8
            ? i * 30
            : side === 1
              ? i
              : 870 + i
      ],
  );
const equal = (a, b) => a.every((value, i) => value === b[i]);
let configurations = 0;
for (const kind of ["belt", "pipe", "shaft", "hydraulic", "cable"]) {
  const references = new Map(
    sides.map((side) => [side, edge(geo.routePixels(kind, side, side), side)]),
  );
  for (let ports = 0; ports < 16; ports++)
    for (let open = 0; open < 16; open++) {
      if (open & ~ports) continue;
      const pixels = geo.routePixels(kind, ports, open);
      for (const side of sides) {
        const boundary = edge(pixels, side);
        if (open & side) {
          if (
            !equal(boundary, references.get(side)) ||
            !equal(boundary, references.get(opposite.get(side)))
          )
            throw new Error(
              `Route seam mismatch ${kind}/${ports}/${open}/${side}`,
            );
        } else if (boundary.some(Boolean))
          throw new Error(
            `Closed route edge leak ${kind}/${ports}/${open}/${side}`,
          );
      }
      if (
        geo.routeGeometry(kind, ports, open) !==
        geo.routeGeometry(kind, ports, open)
      )
        throw new Error("Route cache identity lost");
      configurations++;
    }
}
const report = {
  facades: facadeCount,
  procedural: ids.length - facadeCount,
  catalog_ids: ids.length,
  png_bytes: bytes,
  tile_size: 30,
  geometry_configurations: configurations,
  edge_profiles: "matched; closed edges clear",
  geometry_source: "apps/web/src/game/routeGeometry.ts",
};
const reportIndex = process.argv.indexOf("--report");
if (reportIndex >= 0)
  await writeFile(
    path.resolve(process.argv[reportIndex + 1]),
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(
  `Building art: ${ids.length} IDs, ${facadeCount} facades (${Math.ceil(bytes / 1024)} KiB), ${configurations} cached route geometries with exact seams; ${machines.length} unique machine captions (1–3 characters)`,
);
