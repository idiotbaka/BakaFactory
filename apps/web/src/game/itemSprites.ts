import manifest from "../assets/items/v3/manifest.json";

// Resolve URLs once. Keep PNGs external even when they are under Vite's inline
// threshold: the same cached file is shared by GUI and moving payloads.
const files = import.meta.glob<string>("../assets/items/v3/*.png", {
  eager: true,
  import: "default",
  query: "?no-inline",
});
const definitions: Readonly<Record<string, { tier: number }>> = manifest.items;
export const itemStageColors: Readonly<Record<number, string>> = {
  1: "#ffc879",
  2: "#a5d4b2",
  3: "#74edce",
  4: "#46eff2",
  5: "#b69aff",
  6: "#ff72cf",
};

export function itemSpriteURL(id: string): string | undefined {
  return files[`../assets/items/v3/${id}.png`];
}

export function itemSpriteColor(id: string): string {
  return itemStageColors[definitions[id]?.tier] ?? "#46eff2";
}
