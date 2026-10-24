import type { BuildingDefinition, FactoryDetail } from "../api/client";
import { isLogisticsBuilding } from "./catalogPresentation";
import {
  GRID_INSET,
  TILE_SIZE,
  type Camera,
  type Cell,
} from "./editorGeometry";
import names from "./machineMapNames.json";

export const MACHINE_NAME_MIN_ZOOM = 1.2;
const captions: Readonly<Record<string, string>> = names;
export function machineMapName(
  definition: BuildingDefinition,
): string | undefined {
  if (definition.category !== "machine" || isLogisticsBuilding(definition))
    return undefined;
  return Object.hasOwn(captions, definition.id)
    ? captions[definition.id]
    : undefined;
}

/** Screen coordinates: labels stay 12px rather than being scaled with the map. */
export function machineNamePosition(
  factory: Pick<FactoryDetail, "width" | "height">,
  camera: Camera,
  cell: Cell,
) {
  return {
    left:
      camera.x +
      (GRID_INSET +
        (cell.x + Math.floor(factory.width / 2) + 0.5) * TILE_SIZE) *
        camera.zoom,
    top:
      camera.y +
      (GRID_INSET +
        (Math.floor(factory.height / 2) - cell.y + 0.72) * TILE_SIZE) *
        camera.zoom,
    width: TILE_SIZE * camera.zoom - 4,
  };
}
