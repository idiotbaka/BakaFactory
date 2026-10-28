import type { BuildingDefinition } from "../api/client";
import { isWarehouseTerminal } from "./local/warehouseIO";

export const isPlaceableBuilding = (
  definition: BuildingDefinition,
  stage: number,
) =>
  !definition.fixed &&
  !isWarehouseTerminal(definition.id) &&
  definition.id !== "bus" &&
  (definition.tier ?? 1) <= stage;

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
