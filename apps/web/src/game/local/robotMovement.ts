import type { BuildingInstance } from "../../api/client";
import { buildingDefinitions } from "./catalog";

const walkableRoles = new Set([
  "belt",
  "pipe",
  "shaft",
  "hydraulic_line",
  "cable",
]);
export const robotCanTraverse = (type: string | undefined) =>
  !!type && walkableRoles.has(buildingDefinitions.get(type)?.role ?? "");
export const robotBlocksMovement = (building: BuildingInstance) =>
  !robotCanTraverse(building.building_type);

// Released saves may hold the old, longer preparation/work progress. Accept
// those bounded values; the next real action reconciles with the new duration.
const legacyWorkSeconds: Readonly<Record<string, number>> = {
  i0108: 8,
  i0168: 10,
  i0169: 30,
  i0226: 8,
  i0227: 5,
  i0279: 2,
  i0280: 40,
  i0295: 35,
  i0341: 2,
};
export const robotWorkLimit = (item: string, seconds: number) =>
  Math.max(seconds, legacyWorkSeconds[item] ?? 0);
