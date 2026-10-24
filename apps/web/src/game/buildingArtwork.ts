import manifest from "../assets/buildings/v1/manifest.json";
import { phaseColors } from "./entityTheme";
import type { RouteKind } from "./routeGeometry";

type Artwork = {
  renderer: "image" | RouteKind;
  tier: number | null;
  color: string;
};
const entries: Readonly<Record<string, Artwork>> = manifest.buildings as Record<
  string,
  Artwork
>;
const files = import.meta.glob<string>("../assets/buildings/v1/*.png", {
  eager: true,
  import: "default",
  query: "?no-inline",
});
export const buildingSpriteURLs: readonly string[] = Object.values(files);
export const buildingArtwork = (id: string): Artwork | undefined =>
  Object.hasOwn(entries, id) ? entries[id] : undefined;
export const buildingSpriteURL = (id: string): string | undefined =>
  files[`../assets/buildings/v1/${id}.png`];
export function buildingStageColor(id: string): string {
  const art = buildingArtwork(id);
  return (
    (art?.tier ? phaseColors[art.tier] : undefined) ?? art?.color ?? "#46eff2"
  );
}
