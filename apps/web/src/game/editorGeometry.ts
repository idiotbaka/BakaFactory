import { containsCell, overlaps, inBounds } from "./footprint";
import type {
  BuildingDefinition,
  BuildingPlacement,
  FactoryDetail,
} from "../api/client";
export type Cell = { x: number; y: number };
export type Camera = { x: number; y: number; zoom: number };
export const TILE_SIZE = 30;
export const GRID_INSET = 26; // 25px axis + 1px grid border.
// Underground endpoints have paired geometry and cannot rotate independently.
export function directionEditTarget(
  factory: FactoryDetail,
  cell: Cell | null,
  definition: BuildingDefinition,
) {
  if (
    !cell ||
    definition.id === "underground_belt" ||
    !["belt", "pipe"].includes(definition.role ?? "")
  )
    return undefined;
  return factory.buildings.find(
    (b) =>
      b.building_type === definition.id && b.x === cell.x && b.y === cell.y,
  );
}
export function zoomAt(
  camera: Camera,
  x: number,
  y: number,
  zoom: number,
): Camera {
  const bounded = Math.min(3, Math.max(0.5, zoom));
  const ratio = bounded / camera.zoom;
  return {
    x: x - (x - camera.x) * ratio,
    y: y - (y - camera.y) * ratio,
    zoom: bounded,
  };
}
export function centeredCamera(
  width: number,
  height: number,
  columns: number,
  rows: number,
  fit = false,
): Camera {
  const mapWidth = 27 + columns * TILE_SIZE,
    mapHeight = 27 + rows * TILE_SIZE;
  const zoom = fit
    ? Math.min(
        1.25,
        Math.max(
          0.5,
          Math.min((width - 32) / mapWidth, (height - 32) / mapHeight),
        ),
      )
    : 1.25;
  return {
    x: (width - mapWidth * zoom) / 2,
    y: (height - mapHeight * zoom) / 2,
    zoom,
  };
}
export function cellAtPoint(
  left: number,
  top: number,
  tileSize: number,
  width: number,
  height: number,
  clientX: number,
  clientY: number,
): Cell | null {
  if (tileSize <= 0) return null;
  const column = Math.floor((clientX - left) / tileSize),
    row = Math.floor((clientY - top) / tileSize);
  if (column < 0 || column >= width || row < 0 || row >= height) return null;
  return { x: column - Math.floor(width / 2), y: Math.floor(height / 2) - row };
}
export function placementIssue(
  factory: FactoryDetail,
  cell: Cell | null,
  excludeID?: string,
  buildingType?: string,
  size: 1 | 2 = 1,
): string | null {
  if (!cell) return "请拖入工厂地图";
  const shape = { ...cell, size };
  if (
    factory.robots?.some(
      (r) =>
        !r.returning &&
        r.construction?.factory_id === factory.id &&
        overlaps(r.construction, shape),
    )
  )
    return "该格已预留施工蓝图";
  if (
    factory.robots?.some(
      (r) =>
        (!r.transit && r.factory_id === factory.id && containsCell(shape, r)) ||
        (r.transit?.to_factory_id === factory.id &&
          containsCell(shape, r.transit)),
    )
  )
    return "该格有机器人停靠";
  if (
    buildingType === "waste_port" &&
    cell.y !== Math.floor(factory.height / 2)
  )
    return "垃圾提取口必须安装在顶部垃圾堆";
  if (!inBounds(shape, factory.width, factory.height))
    return "坐标超出工厂边界";
  if (factory.buildings.some((b) => overlaps(b, shape) && b.id !== excludeID))
    return "目标格子已被占用";
  return null;
}
export function nextRotation(
  rotation: BuildingPlacement["rotation"],
): BuildingPlacement["rotation"] {
  return ((rotation + 90) % 360) as BuildingPlacement["rotation"];
}
