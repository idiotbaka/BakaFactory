import type { BuildingDefinition } from "../api/client";

export const isLogisticsBuilding = (definition: BuildingDefinition) =>
  [
    "belt",
    "port",
    "splitter",
    "chest",
    "pipe",
    "tank",
    "valve",
    "pump",
  ].includes(definition.role ?? "");
