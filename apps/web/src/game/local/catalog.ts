import definitions from "../../../../server/internal/catalog/definitions.json";
import type { Catalog, BuildingInstance } from "../../api/client";

export const catalog = definitions as unknown as Catalog;
export const buildingDefinitions = new Map(
  catalog.buildings.map((b) => [b.id, b]),
);
export const itemDefinitions = new Map(catalog.items.map((i) => [i.id, i]));
export const recipeDefinitions = new Map(catalog.recipes.map((r) => [r.id, r]));
export const itemID = (name: string) =>
  catalog.items.find((i) => i.name === name)?.id ?? "";
export const isBelt = (type: string) =>
  type === "conveyor" || buildingDefinitions.get(type)?.role === "belt";
export const isFluid = (id: string) =>
  itemDefinitions.get(id)?.kind === "fluid_or_gas";
export const isFluidNode = (type: string) =>
  (buildingDefinitions.get(type)?.fluid_capacity ?? 0) > 0;
export const direction = (rotation: number): [number, number] =>
  rotation === 90
    ? [0, -1]
    : rotation === 180
      ? [-1, 0]
      : rotation === 270
        ? [0, 1]
        : [1, 0];
export const beltTicks = (type: string) =>
  buildingDefinitions.get(type)?.belt_ticks ?? 1;
export const beltCapacity = (type: string) =>
  buildingDefinitions.get(type)?.batch_size ?? 1;
export const isPort = (type: string) =>
  ["item_input", "item_output"].includes(type) ||
  ["port", "splitter"].includes(buildingDefinitions.get(type)?.role ?? "");
export const isChest = (type: string) =>
  buildingDefinitions.get(type)?.role === "chest";
export function selectedRecipe(b: BuildingInstance) {
  const selected = b.configuration.recipe_id;
  const r =
    typeof selected === "string" ? recipeDefinitions.get(selected) : undefined;
  if (r?.building_type === b.building_type) return r;
  // Legacy one-recipe machines retain their behavior when upgrading a save.
  return buildingDefinitions.get(b.building_type)?.legacy
    ? catalog.recipes.find((recipe) => recipe.building_type === b.building_type)
    : undefined;
}
