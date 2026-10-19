import type { BuildingPlacement, FactoryDetail } from "../api/client";
export type Cell = { x: number; y: number };
export type Camera = { x: number; y: number; zoom: number };
export const TILE_SIZE = 30;
export const GRID_INSET = 26; // 25px axis + 1px grid border.
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
): string | null {
  if (!cell) return "请拖入工厂地图";
  if (
    Math.abs(cell.x) > Math.floor(factory.width / 2) ||
    Math.abs(cell.y) > Math.floor(factory.height / 2)
  )
    return "坐标超出工厂边界";
  if (
    factory.buildings.some(
      (b) => b.x === cell.x && b.y === cell.y && b.id !== excludeID,
    )
  )
    return "目标格子已被占用";
  return null;
}
export function nextRotation(
  rotation: BuildingPlacement["rotation"],
): BuildingPlacement["rotation"] {
  return ((rotation + 90) % 360) as BuildingPlacement["rotation"];
}
