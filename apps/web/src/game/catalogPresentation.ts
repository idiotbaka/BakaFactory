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
    "warehouse_pickup",
    "warehouse_intake",
    "source",
  ].includes(definition.role ?? "");
