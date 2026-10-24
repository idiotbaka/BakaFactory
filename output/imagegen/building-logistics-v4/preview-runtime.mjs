// Static presentation of the same integer pixels consumed by RouteVisual.
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const source = new URL(
  "../../../apps/web/src/game/routeGeometry.ts",
  import.meta.url,
);
const compiled = ts.transpileModule(await readFile(source, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { routePixels } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const masks = [6, 14, 12, 0, 0, 7, 15, 13, 2, 10, 11, 9];
const routes = Object.fromEntries(
  ["belt", "pipe", "shaft", "hydraulic", "cable"].map((kind) => [
    kind,
    masks.map((mask) => [...routePixels(kind, mask)]),
  ]),
);
await writeFile(
  new URL("runtime-pixels.json", import.meta.url),
  JSON.stringify({ masks, columns: 4, routes }),
);
