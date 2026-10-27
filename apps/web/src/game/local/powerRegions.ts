import {
  footprintCells,
  occupancy,
  perimeterCells,
  type Cell,
} from "../footprint";
import type { BuildingInstance } from "../../api/client";
import type { PowerKind } from "./power";

export type PowerRegion = {
  id: string;
  buildings: BuildingInstance[];
  cells: Cell[];
};

const compare = (a: BuildingInstance, b: BuildingInstance) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const powerNetworkID = (kind: PowerKind, regionID: string) =>
  `${kind}:${regionID}`;

// All placed buildings touching orthogonally share one power-conducting region;
// underground spans, robots, and construction blueprints are not placed tiles.
export function powerRegions(
  buildings: readonly BuildingInstance[],
): PowerRegion[] {
  const ordered = [...buildings].sort(compare),
    positions = occupancy(ordered),
    visited = new Set<string>(),
    regions: PowerRegion[] = [];
  for (const start of ordered) {
    if (visited.has(start.id)) continue;
    const queue = [start];
    visited.add(start.id);
    for (let index = 0; index < queue.length; index++) {
      const b = queue[index];
      for (const p of perimeterCells(b)) {
        const next = positions.get(`${p.x},${p.y}`);
        if (next && !visited.has(next.id)) {
          visited.add(next.id);
          queue.push(next);
        }
      }
    }
    const members = queue.sort(compare);
    regions.push({
      id: members[0].id,
      buildings: members,
      cells: members.flatMap((b) => footprintCells(b)),
    });
  }
  return regions;
}
