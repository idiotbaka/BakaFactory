import type { BuildingDefinition } from "../api/client";

export type Cell = { x: number; y: number };
export type Footprint = Cell & { size?: number };
export const footprintSize = (p: { size?: number }) => (p.size === 2 ? 2 : 1);
export const supportsLargeSize = (
  d: Pick<BuildingDefinition, "supported_sizes"> | undefined,
) => d?.supported_sizes?.includes(2) === true;
export const validSize = (d: BuildingDefinition, size: unknown) =>
  size === undefined || size === 1 || (size === 2 && supportsLargeSize(d));
// Coordinates always name the top-left cell; world Y points up. Rotation
// changes facing only, so square footprints retain the same anchor.
export function footprintCells(p: Footprint): Cell[] {
  const size = footprintSize(p);
  return Array.from({ length: size * size }, (_, i) => ({
    x: p.x + (i % size),
    y: p.y - Math.floor(i / size),
  }));
}
export function containsCell(p: Footprint, cell: Cell) {
  const size = footprintSize(p);
  return (
    cell.x >= p.x && cell.x < p.x + size && cell.y <= p.y && cell.y > p.y - size
  );
}
export const overlaps = (a: Footprint, b: Footprint) =>
  footprintCells(a).some((cell) => containsCell(b, cell));
export const inBounds = (p: Footprint, width = 21, height = 21) =>
  footprintCells(p).every(
    (cell) =>
      Math.abs(cell.x) <= Math.floor(width / 2) &&
      Math.abs(cell.y) <= Math.floor(height / 2),
  );
export function occupancy<T extends Footprint>(buildings: readonly T[]) {
  return new Map<string, T>(
    buildings.flatMap((b) =>
      footprintCells(b).map((p) => [`${p.x},${p.y}`, b] as const),
    ),
  );
}
// Stable right/down/left/up order, then each edge from its first cell.
export function edgeCells(p: Footprint, rotation: number): Cell[] {
  const n = footprintSize(p);
  return Array.from({ length: n }, (_, i) =>
    rotation === 0
      ? { x: p.x + n, y: p.y - i }
      : rotation === 90
        ? { x: p.x + i, y: p.y - n }
        : rotation === 180
          ? { x: p.x - 1, y: p.y - i }
          : { x: p.x + i, y: p.y + 1 },
  );
}
export const perimeterCells = (p: Footprint) =>
  [0, 90, 180, 270].flatMap((r) => edgeCells(p, r));
export const isAdjacent = (p: Footprint, cell: Cell) =>
  perimeterCells(p).some((v) => v.x === cell.x && v.y === cell.y);
// A successful transfer uses the contacted footprint cell, not the anchor.
export const contactCell = (p: Footprint, neighbor: Cell): Cell => ({
  x: Math.max(p.x, Math.min(p.x + footprintSize(p) - 1, neighbor.x)),
  y: Math.min(p.y, Math.max(p.y - footprintSize(p) + 1, neighbor.y)),
});
