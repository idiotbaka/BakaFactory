import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { buildingDefinitions, catalog, recipeDefinitions } from "./catalog";
import { validatePlacement } from "./placement";
import { newMachine } from "./machine";
import { store } from "./inventory";
import {
  homeEndpoint,
  endpointBuilding,
  worldFactories,
  plannedLayout,
  journey,
  returnCost,
  routeEditsSafe,
  invalidateWorldIndex,
  type Robot,
  type Point,
} from "./robotRoutes";
type Blueprint = components["schemas"]["RobotConstruction"];
export const constructionTicks = 10;
export type ConstructionAction = {
  type: "robot_construct";
  id: string;
  blueprint: Blueprint;
};
export function constructionLog(
  root: LocalFactory,
  r: Robot,
  kind: "construct" | "built",
  detail: string,
) {
  r.behavior_log = [
    ...(r.behavior_log ?? []),
    { tick: root.simulation.tick, kind, detail: detail.slice(0, 128) },
  ].slice(-20);
}
export function constructionValid(root: LocalFactory, r: Robot): boolean {
  const c = r.construction;
  if (c === undefined) return true;
  if (
    !c ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    Object.keys(c).some(
      (k) =>
        ![
          "id",
          "factory_id",
          "building_type",
          "x",
          "y",
          "rotation",
          "recipe_id",
        ].includes(k),
    ) ||
    catalog.robots?.find((d) => d.item === r.item)?.role !== "smart" ||
    r.task ||
    r.service ||
    typeof c.id !== "string" ||
    !c.id.length ||
    c.id.length > 128 ||
    !r.allowed_zones.includes(c.factory_id) ||
    !Number.isInteger(c.x) ||
    !Number.isInteger(c.y) ||
    Math.abs(c.x) > 10 ||
    Math.abs(c.y) > 10 ||
    ![0, 90, 180, 270].includes(c.rotation)
  )
    return false;
  const f = worldFactories(root).find((f) => f.id === c.factory_id),
    d = buildingDefinitions.get(c.building_type);
  if (
    !f ||
    !d?.item ||
    d.fixed ||
    d.legacy ||
    (d.tier ?? 1) > (root.simulation.industry?.stage ?? 1)
  )
    return false;
  if (c.recipe_id !== undefined) {
    const recipe = recipeDefinitions.get(c.recipe_id);
    if (
      !recipe ||
      recipe.building_type !== c.building_type ||
      (recipe.tier ?? 1) > (root.simulation.industry?.stage ?? 1) ||
      (recipe.gate &&
        !root.simulation.industry?.milestones.includes(recipe.gate))
    )
      return false;
  }
  if (r.cargo && (r.cargo.item !== d.item || r.cargo.count !== 1)) return false;
  if (!r.returning) {
    if (
      !r.cargo ||
      worldFactories(root).some((f) =>
        f.buildings.some((b) => b.id === c.id),
      ) ||
      (root.robots ?? []).some(
        (other) =>
          other.id !== r.id &&
          !other.returning &&
          other.construction?.id === c.id,
      )
    )
      return false;
    try {
      validatePlacement(
        {
          ...plannedLayout(root, f, r.id),
          simulation: { ...f.simulation, industry: root.simulation.industry },
        },
        c.building_type,
        c.id,
        c,
      );
    } catch {
      return false;
    }
    if (d.role === "source" && f.id !== root.id) return false;
    if (
      (root.robots ?? []).some(
        (other) =>
          (!other.transit &&
            other.factory_id === f.id &&
            other.x === c.x &&
            other.y === c.y) ||
          (other.transit?.to_factory_id === f.id &&
            other.transit.x === c.x &&
            other.transit.y === c.y),
      )
    )
      return false;
  }
  return true;
}
export function constructionJourney(
  root: LocalFactory,
  r: Robot,
  from: Point = r,
  occupied?: Set<string>,
) {
  const c = r.construction!;
  return journey(
    root,
    from,
    { factory_id: c.factory_id, building_id: c.id },
    occupied,
    undefined,
    c,
  );
}
export function applyConstruction(
  root: LocalFactory,
  action: ConstructionAction,
) {
  const r = root.robots?.find((r) => r.id === action.id),
    d = r && catalog.robots?.find((d) => d.item === r.item);
  if (
    !r ||
    d?.role !== "smart" ||
    r.task ||
    r.service ||
    r.construction ||
    r.cargo ||
    r.transit ||
    r.returning
  )
    throw new Error("请选择空闲智能机器人并实际返站");
  const station = endpointBuilding(root, homeEndpoint(r))!;
  if (
    r.factory_id !== r.home_factory_id ||
    Math.abs(r.x - station.x) + Math.abs(r.y - station.y) !== 1 ||
    r.energy_kj !== d.energy_capacity_kj
  )
    throw new Error("施工需实际停靠归属站并补满能量");
  const before = { ...root, robots: structuredClone(root.robots) };
  r.construction = structuredClone(action.blueprint);
  const type = buildingDefinitions.get(r.construction.building_type);
  if (!type?.item) throw new Error("蓝图设备无实际安装道具");
  r.cargo = { item: type.item, count: 1 };
  if (!constructionValid(root, r))
    throw new Error("蓝图类型、位置、阶段、厂区授权或格位预留无效");
  const plan = constructionJourney(root, r),
    need = plan
      ? plan.cost + constructionTicks + returnCost(root, r, plan.end, true) + 2
      : Infinity;
  if (need > r.energy_kj || !routeEditsSafe(before, root))
    throw new Error("蓝图堵断返程、现场不可达或储能不足");
  store(root.simulation.warehouse, { [type.item]: -1 });
  r.work_progress = 0;
  r.status = "moving";
  constructionLog(
    root,
    r,
    "construct",
    `${r.construction.factory_id} (${r.construction.x},${r.construction.y}) · ${type.code}`,
  );
}
export function finishConstruction(root: LocalFactory, r: Robot): boolean {
  if (!constructionValid(root, r)) return false;
  const c = r.construction!,
    f = worldFactories(root).find((f) => f.id === c.factory_id)!;
  if (
    r.transit ||
    r.factory_id !== f.id ||
    Math.abs(r.x - c.x) + Math.abs(r.y - c.y) !== 1
  )
    return false;
  // Replace the building array: stepWorld shares the old immutable layout.
  f.buildings = [
    ...f.buildings,
    {
      id: c.id,
      factory_id: f.id,
      building_type: c.building_type,
      x: c.x,
      y: c.y,
      rotation: c.rotation,
      configuration: c.recipe_id ? { recipe_id: c.recipe_id } : {},
    },
  ];
  f.simulation.buildings[c.id] = newMachine();
  invalidateWorldIndex(root);
  constructionLog(
    root,
    r,
    "built",
    `${f.name} (${c.x},${c.y}) · ${buildingDefinitions.get(c.building_type)!.code}`,
  );
  delete r.cargo;
  delete r.construction;
  return true;
}
