import type {
  BuildingDefinition,
  BuildingInstance,
  FactoryDetail,
} from "../api/client";
import { footprintCells } from "./footprint";
import { placementIssue, type Cell } from "./editorGeometry";
import { isUnderground, undergroundPeer } from "./local/underground";

// Add future paired building kinds here. Both selection and Worker edits use
// this closure, so a caller cannot accidentally move only half of a group.
const linkedBuildings = (b: BuildingInstance, all: BuildingInstance[]) =>
  isUnderground(b) ? [undergroundPeer(b, all)?.id] : [];

export function expandSelection(
  all: BuildingInstance[],
  ids: readonly string[],
) {
  const selected = new Set(ids);
  for (const id of selected) {
    const b = all.find((b) => b.id === id);
    if (!b) throw new Error("建筑不存在，请重新框选");
    for (const peer of linkedBuildings(b, all)) {
      if (!peer) throw new Error("建筑配对不完整");
      selected.add(peer);
    }
  }
  return all.filter((b) => selected.has(b.id));
}

export function batchEligible(
  f: FactoryDetail,
  b: BuildingInstance,
  definitions: readonly BuildingDefinition[],
) {
  return (
    !["bus", "warehouse_pickup", "warehouse_intake"].includes(
      b.building_type,
    ) &&
    !!definitions.find((d) => d.id === b.building_type && !d.fixed) &&
    !f.robots?.some(
      (r) => r.home_factory_id === f.id && r.home_station === b.id,
    )
  );
}

export function rectangleSelection(
  f: FactoryDetail,
  definitions: readonly BuildingDefinition[],
  a: Cell,
  z: Cell,
) {
  const ids = f.buildings
    .filter(
      (b) =>
        batchEligible(f, b, definitions) &&
        footprintCells(b).some(
          (p) =>
            p.x >= Math.min(a.x, z.x) &&
            p.x <= Math.max(a.x, z.x) &&
            p.y >= Math.min(a.y, z.y) &&
            p.y <= Math.max(a.y, z.y),
        ),
    )
    .map((b) => b.id);
  const selected = new Set<string>();
  for (const id of ids) {
    if (selected.has(id)) continue;
    const group = expandSelection(f.buildings, [id]);
    // A protected linked member excludes the whole group, never half a pair.
    if (group.every((b) => batchEligible(f, b, definitions)))
      for (const b of group) selected.add(b.id);
  }
  return f.buildings.filter((b) => selected.has(b.id)).map((b) => b.id);
}

export function batchMoveIssue(
  f: FactoryDetail,
  ids: readonly string[],
  delta: Cell | null,
) {
  if (!delta) return "请拖入工厂地图";
  const selected = expandSelection(f.buildings, ids);
  const selectedIDs = new Set(selected.map((b) => b.id));
  const remaining = {
    ...f,
    buildings: f.buildings.filter((b) => !selectedIDs.has(b.id)),
  };
  for (const b of selected) {
    const issue = placementIssue(
      remaining,
      { x: b.x + delta.x, y: b.y + delta.y },
      undefined,
      b.building_type,
      b.size === 2 ? 2 : 1,
    );
    if (issue) return issue;
  }
  return null;
}
