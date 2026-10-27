import { readFile, writeFile } from "node:fs/promises";
import { pinyin } from "pinyin-pro";
import { format } from "prettier";
import earlyMachineNames from "../apps/web/src/game/earlyMachineNames.json" with { type: "json" };

const source = new URL(
  "../apps/server/internal/catalog/definitions.json",
  import.meta.url,
);
const target = new URL(
  "../apps/web/src/game/catalogSearchIndex.json",
  import.meta.url,
);
const definitions = JSON.parse(await readFile(source, "utf8"));
// Include recipes and robot models too, since their search fields use names
// from the same catalog. Names are deduplicated, with deterministic ordering.
const names = [
  ...new Set([
    ...["items", "buildings", "recipes", "robots"].flatMap((group) =>
      (definitions[group] ?? []).map((entry) => entry.name),
    ),
    ...Object.values(earlyMachineNames).map((entry) => entry.workshop),
  ]),
].sort();
const index = Object.fromEntries(
  names.map((name) => {
    if (typeof name !== "string" || !name.trim())
      throw new Error("Search catalog entries must have a nonempty name");
    const options = {
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
      v: true,
    };
    return [
      name,
      [
        pinyin(name, options).join(""),
        pinyin(name, { ...options, pattern: "first" }).join(""),
      ],
    ];
  }),
);
const output = await format(JSON.stringify(index), { parser: "json" });
let current;
try {
  current = await readFile(target, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (process.argv.includes("--check")) {
  if (current !== output)
    throw new Error(
      "Catalog search index is stale. Run npm run generate:search and include the generated file.",
    );
} else if (current !== output) {
  await writeFile(target, output);
}
console.log(
  `Catalog search: ${names.length} names, ${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB index${process.argv.includes("--check") ? " verified" : " ready"}.`,
);
