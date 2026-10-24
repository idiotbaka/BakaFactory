import {
  occupancy,
  containsCell,
  perimeterCells,
  type Footprint,
} from "../footprint";
import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import type { BuildingInstance } from "../../api/client";

export type Robot = components["schemas"]["RobotState"];
export type Endpoint = components["schemas"]["RobotEndpoint"];
export type Point = { factory_id: string; x: number; y: number };
const indexes = new WeakMap<
  LocalFactory,
  {
    districts: LocalFactory["districts"];
    factories: LocalFactory[];
    byID: Map<string, LocalFactory>;
    buildings: Map<string, BuildingInstance>;
  }
>();
function worldIndex(root: LocalFactory) {
  let index = indexes.get(root);
  if (!index || index.districts !== root.districts) {
    const factories = [root, ...(root.districts ?? [])];
    index = {
      districts: root.districts,
      factories,
      byID: new Map(factories.map((f) => [f.id, f])),
      buildings: new Map(
        factories.flatMap((f) =>
          f.buildings.map((b) => [JSON.stringify([f.id, b.id]), b] as const),
        ),
      ),
    };
    indexes.set(root, index);
  }
  return index;
}
export const invalidateWorldIndex = (root: LocalFactory) =>
  indexes.delete(root);
export const worldFactories = (root: LocalFactory) =>
  worldIndex(root).factories;
export function plannedBuildings(
  root: LocalFactory,
  factoryID: string,
  exclude?: string,
): BuildingInstance[] {
  return (root.robots ?? [])
    .filter(
      (r) =>
        !r.returning &&
        r.id !== exclude &&
        r.construction?.factory_id === factoryID,
    )
    .map((r) => ({
      id: r.construction!.id,
      factory_id: factoryID,
      building_type: r.construction!.building_type,
      x: r.construction!.x,
      y: r.construction!.y,
      rotation: r.construction!.rotation,
      size: r.construction!.size,
      configuration: {},
    }));
}
export function plannedLayout(
  root: LocalFactory,
  f: LocalFactory,
  exclude?: string,
): LocalFactory {
  return {
    ...f,
    buildings: [...f.buildings, ...plannedBuildings(root, f.id, exclude)],
  };
}
export const adjacentCells = (p: { x: number; y: number }) =>
  [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ].map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }));
export const cellKey = (p: Point) => `${p.factory_id}:${p.x},${p.y}`;
export const endpointBuilding = (root: LocalFactory, e: Endpoint) =>
  worldIndex(root).buildings.get(JSON.stringify([e.factory_id, e.building_id]));
export const homeEndpoint = (r: Robot): Endpoint => ({
  factory_id: r.home_factory_id,
  building_id: r.home_station,
});
export function warehouseEndpoint(root: LocalFactory, id: string): Endpoint {
  return {
    factory_id: id,
    building_id: worldFactories(root)
      .find((f) => f.id === id)!
      .buildings.find((b) => b.building_type === "bus")!.id,
  };
}
export function emptyCell(f: LocalFactory, p: { x: number; y: number }) {
  return (
    Math.abs(p.x) <= 10 &&
    Math.abs(p.y) <= 10 &&
    !f.buildings.some((b) => containsCell(b, p))
  );
}
// BFS uses empty ground only. An optional occupancy set handles live collision;
// static paths are also used to reserve enough real energy for a safe return.
function path(
  f: LocalFactory,
  from: Point,
  target: Footprint,
  occupied?: Set<string>,
  dock?: (p: { x: number; y: number }) => boolean,
) {
  const blocked = new Set(occupancy(f.buildings).keys());
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const goals = new Set(
    perimeterCells(target)
      .filter(
        (p) =>
          Math.abs(p.x) <= 10 &&
          Math.abs(p.y) <= 10 &&
          !blocked.has(key(p)) &&
          (!dock || dock(p)) &&
          !occupied?.has(cellKey({ ...p, factory_id: f.id })),
      )
      .map(key),
  );
  const queue = [from],
    parents = new Map<string, Point | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (goals.has(key(p))) {
      const result: Point[] = [];
      let at = p;
      while (parents.get(key(at))) {
        result.push(at);
        at = parents.get(key(at))!;
      }
      return result.reverse();
    }
    for (const n of adjacentCells(p)) {
      const point = { ...n, factory_id: f.id };
      if (
        Math.abs(n.x) > 10 ||
        Math.abs(n.y) > 10 ||
        blocked.has(key(n)) ||
        parents.has(key(n)) ||
        occupied?.has(cellKey(point))
      )
        continue;
      parents.set(key(n), p);
      queue.push(point);
    }
  }
}
type Journey = { route: Point[]; end: Point; cost: number; arrival?: Point };
export function journey(
  root: LocalFactory,
  from: Point,
  target: Endpoint,
  occupied?: Set<string>,
  dock?: (p: { x: number; y: number }) => boolean,
  site?: Footprint,
): Journey | undefined {
  const sourceRaw = worldIndex(root).byID.get(from.factory_id),
    destRaw = worldIndex(root).byID.get(target.factory_id),
    building = site ?? endpointBuilding(root, target);
  const source = sourceRaw && plannedLayout(root, sourceRaw),
    dest = destRaw && plannedLayout(root, destRaw);
  if (!source || !dest || !building) return;
  if (source.id === dest.id) {
    const route = path(source, from, building, occupied, dock);
    return route && { route, end: route.at(-1) ?? from, cost: route.length };
  }
  const gate = source.buildings.find((b) => b.building_type === "bus")!;
  const route = path(source, from, gate, occupied);
  if (!route) return;
  let best: { arrival: Point; end: Point; cost: number } | undefined;
  for (const p of adjacentCells({ x: 0, y: 0 })) {
    const arrival = { ...p, factory_id: dest.id };
    if (!emptyCell(dest, p) || occupied?.has(cellKey(arrival))) continue;
    const tail = path(dest, arrival, building, occupied, dock);
    if (tail && (!best || tail.length < best.cost))
      best = { arrival, end: tail.at(-1) ?? arrival, cost: tail.length };
  }
  return (
    best && {
      route,
      end: best.end,
      cost: route.length + 8 + best.cost,
      arrival: best.arrival,
    }
  );
}
export function returnCost(
  root: LocalFactory,
  r: Robot,
  from: Point = r,
  cargo = !!r.cargo,
): number {
  const home = homeEndpoint(r);
  if (!cargo) return journey(root, from, home)?.cost ?? Infinity;
  const toWarehouse = journey(
    root,
    from,
    warehouseEndpoint(root, r.home_factory_id),
  );
  return toWarehouse
    ? toWarehouse.cost +
        1 +
        (journey(root, toWarehouse.end, home)?.cost ?? Infinity)
    : Infinity;
}
export function routeEditsSafe(before: LocalFactory, after: LocalFactory) {
  for (const r of after.robots ?? []) {
    const previous = before.robots?.find((b) => b.id === r.id);
    if (!previous) continue;
    const location = r.transit
      ? { factory_id: r.transit.to_factory_id, x: r.transit.x, y: r.transit.y }
      : r;
    const oldLocation = previous.transit
      ? {
          factory_id: previous.transit.to_factory_id,
          x: previous.transit.x,
          y: previous.transit.y,
        }
      : previous;
    const cost =
        returnCost(after, r, location) + (r.transit?.remaining_ticks ?? 0),
      oldCost =
        returnCost(before, previous, oldLocation) +
        (previous.transit?.remaining_ticks ?? 0);
    if (
      r.transit &&
      !emptyCell(
        worldFactories(after).find((f) => f.id === location.factory_id)!,
        location,
      )
    )
      return false;
    if (cost > r.energy_kj && cost > oldCost) return false;
  }
  return true;
}
