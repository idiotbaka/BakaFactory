import type { BuildingInstance, BuildingPlacement } from "../../api/client";
import { direction } from "./catalog";

export const undergroundType = "underground_belt";
export const undergroundItem = "d0001";
export const isUnderground = (b: Pick<BuildingInstance, "building_type">) =>
  b.building_type === undergroundType;
export const isUndergroundEntry = (b: BuildingInstance) =>
  isUnderground(b) && b.configuration.underground_role === "entry";
export const undergroundPeer = (
  b: BuildingInstance,
  buildings: readonly BuildingInstance[],
) => buildings.find((p) => p.id === b.configuration.underground_peer);

// Coordinates are tile centers: distance 8 leaves seven intervening tiles.
export function undergroundSpan(
  entry: Pick<BuildingPlacement, "x" | "y" | "rotation">,
  exit: Pick<BuildingPlacement, "x" | "y" | "rotation">,
) {
  const [dx, dy] = direction(entry.rotation);
  const x = exit.x - entry.x,
    y = exit.y - entry.y;
  const distance = x * dx + y * dy;
  return (
    entry.rotation === exit.rotation &&
    x * dy === y * dx &&
    Number.isInteger(distance) &&
    distance >= 1 &&
    distance <= 8
  );
}

export function undergroundMoveIssue(
  b: BuildingInstance,
  placement: BuildingPlacement,
  buildings: readonly BuildingInstance[],
): string | null {
  if (!isUnderground(b)) return null;
  const peer = undergroundPeer(b, buildings);
  if (
    !peer ||
    placement.rotation !== b.rotation ||
    !(isUndergroundEntry(b)
      ? undergroundSpan(placement, peer)
      : undergroundSpan(peer, placement))
  )
    return "地下端口只能沿原直线移动，保持共同朝向及前后 1～8 格；更换方向请回收后重建";
  return null;
}

export function validUndergroundPairs(buildings: readonly BuildingInstance[]) {
  const byID = new Map(buildings.map((b) => [b.id, b]));
  return buildings.every((b) => {
    if (!isUnderground(b))
      return (
        b.configuration.underground_role === undefined &&
        b.configuration.underground_peer === undefined
      );
    const role = b.configuration.underground_role;
    const peerID = b.configuration.underground_peer;
    if (
      !["entry", "exit"].includes(role as string) ||
      typeof peerID !== "string" ||
      !peerID.length ||
      peerID.length > 128
    )
      return false;
    const peer = byID.get(peerID);
    return (
      !!peer &&
      isUnderground(peer) &&
      peer.factory_id === b.factory_id &&
      peer.configuration.underground_peer === b.id &&
      peer.configuration.underground_role ===
        (role === "entry" ? "exit" : "entry") &&
      (role === "entry" ? undergroundSpan(b, peer) : undergroundSpan(peer, b))
    );
  });
}
