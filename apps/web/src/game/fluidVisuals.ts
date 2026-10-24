import type { BuildingInstance, BuildingPlacement } from "../api/client";
import { direction, isFluidNode } from "./local/catalog";

type PipeGeometry = {
  x: number;
  y: number;
  rotation: BuildingPlacement["rotation"];
  buildings: ReadonlyMap<string, BuildingInstance>;
  instanceID?: string;
};

const ends = [
  { x: 48, y: 24, dx: 1, dy: 0 },
  { x: 24, y: 48, dx: 0, dy: 1 },
  { x: 0, y: 24, dx: -1, dy: 0 },
  { x: 24, y: 0, dx: 0, dy: -1 },
] as const;

// Presentation only: an adjacent fluid node points into this cell. Do not
// infer successful flow, pressure, compatibility or available capacity here.
export function fluidPipeConnections({
  x,
  y,
  rotation,
  buildings,
  instanceID,
}: PipeGeometry): number[] {
  const incoming: number[] = [];
  for (let local = 0; local < 4; local++) {
    const world = (rotation + local * 90) % 360,
      [dx, dy] = direction(world),
      neighbor = buildings.get(`${x + dx},${y + dy}`);
    if (
      neighbor &&
      neighbor.id !== instanceID &&
      isFluidNode(neighbor.building_type) &&
      neighbor.rotation === (world + 180) % 360
    )
      incoming.push(local);
  }
  return incoming;
}

export function fluidPipePath(args: PipeGeometry): string {
  const incoming = fluidPipeConnections(args);
  // The output always follows the pipe's arrow. With no other inlet, retain
  // the rear connector for a machine / WH source or an unconnected preview.
  const ports = [...new Set([0, ...incoming])];
  if (ports.length === 1) ports.push(2);
  if (ports.length === 2) {
    const a = ends[ports[0]],
      b = ends[ports[1]];
    if (ports[1] === 2) return "M0 24H48";
    return `M${a.x} ${a.y}L${24 + a.dx * 8} ${24 + a.dy * 8}Q24 24 ${24 + b.dx * 8} ${24 + b.dy * 8}L${b.x} ${b.y}`;
  }
  return ports.map((port) => `M24 24L${ends[port].x} ${ends[port].y}`).join("");
}
