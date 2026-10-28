import type { BuildingInstance } from "../../api/client";
import { buildingDefinitions, catalog } from "./catalog";

// Recipe-bearing production machines. Logistics,
// extractors and utility-only facilities retain their own transport rules.
const machines = new Set(
  catalog.recipes
    .map((r) => r.building_type)
    .filter((type) => buildingDefinitions.get(type)?.category === "machine"),
);
export const canAutoEject = (type: string) => machines.has(type);
export const autoEject = (b: BuildingInstance) =>
  canAutoEject(b.building_type) && b.configuration.auto_eject === true;
export const AUTO_EJECT_BATCH = 6;
