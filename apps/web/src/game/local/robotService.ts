import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import {
  itemID,
  isFluid,
  selectedRecipe,
  catalog,
  buildingDefinitions,
} from "./catalog";
import { count, remove, store } from "./inventory";
import { incidentKind, matureIncident } from "./incidents";
import { recordWork } from "./workLedger";
import {
  endpointBuilding,
  homeEndpoint,
  journey,
  returnCost,
  worldFactories,
  type Robot,
  type Endpoint,
} from "./robotRoutes";
type Spec = components["schemas"]["RobotDefinition"];
export type ServiceAction =
  | {
      type: "robot_service";
      id: string;
      kind: "inspect" | "maintain";
      target: Endpoint;
    }
  | { type: "robot_camera"; id: string; equipped: boolean };
const specs = (r: Robot) => importSpecs.get(r.item)!;
const importSpecs = new Map(catalog.robots!.map((d) => [d.item, d]));
export function serviceValid(root: LocalFactory, r: Robot, d: Spec) {
  if (
    r.camera !== undefined &&
    (typeof r.camera !== "boolean" ||
      (r.camera && (root.simulation.industry?.stage ?? 1) < 5))
  )
    return false;
  const s = r.service;
  if (s === undefined) return true;
  if (
    !s ||
    typeof s !== "object" ||
    Array.isArray(s) ||
    Object.keys(s).some(
      (k) => !["kind", "target", "since_tick", "parts"].includes(k),
    ) ||
    !["inspect", "maintain"].includes(s.kind) ||
    !Number.isSafeInteger(s.since_tick) ||
    s.since_tick < 0 ||
    s.since_tick > root.simulation.tick ||
    !Number.isInteger(s.parts) ||
    s.parts < 0 ||
    s.parts > 1 ||
    s.parts > d.capacity ||
    r.task
  )
    return false;
  const t = s.target;
  if (
    !t ||
    typeof t !== "object" ||
    Array.isArray(t) ||
    Object.keys(t).some((k) => !["factory_id", "building_id"].includes(k)) ||
    typeof t.building_id !== "string" ||
    !t.building_id.length ||
    t.building_id.length > 128 ||
    !r.allowed_zones.includes(t.factory_id) ||
    !worldFactories(root).some((f) => f.id === t.factory_id)
  )
    return false;
  if (s.kind === "inspect")
    return ["inspector", "smart"].includes(d.role) && s.parts === 0 && !r.cargo;
  return (
    ["repair", "smart"].includes(d.role) &&
    (s.parts === 1 || !!r.returning) &&
    (!r.cargo || (!isFluid(r.cargo.item) && !!r.returning && s.parts === 0))
  );
}
export function serviceTarget(root: LocalFactory, r: Robot) {
  const s = r.service;
  if (!s) return;
  const f = worldFactories(root).find((f) => f.id === s.target.factory_id),
    b = endpointBuilding(root, s.target);
  if (!f || !b) return;
  const m = f.simulation.buildings[b.id],
    i = m.incident;
  if (
    !i ||
    i.since_tick !== s.since_tick ||
    !matureIncident(m, root.simulation.tick) ||
    incidentKind(
      {
        ...f,
        robots: root.robots,
        simulation: { ...f.simulation, industry: root.simulation.industry },
      },
      b,
    ) !== i.kind
  )
    return;
  if (s.kind === "inspect") return !i.inspected ? { f, b, m, i } : undefined;
  if (i.kind !== "output_full" || !s.parts) return;
  const recipe = selectedRecipe(b);
  // First remove a real solid output that blocks the selected batch. The
  // carried load is returned through the same physical freight paths.
  const item =
    m.output.find(
      (stack) =>
        !isFluid(stack.item) &&
        count(m.output, stack.item) + (recipe?.outputs[stack.item] ?? 0) > 100,
    )?.item ??
    (m.output.length >=
    (buildingDefinitions.get(b.building_type)?.output_slots ?? 12)
      ? m.output.find((stack) => !isFluid(stack.item))?.item
      : undefined);
  if (item) return { f, b, m, i, item };
}
export function applyServiceAction(root: LocalFactory, action: ServiceAction) {
  const r = root.robots?.find((r) => r.id === action.id);
  if (!r) throw new Error("机器人不存在");
  const home = endpointBuilding(root, homeEndpoint(r))!,
    f = worldFactories(root).find((f) => f.id === r.home_factory_id)!;
  if (
    r.task ||
    r.service ||
    r.construction ||
    r.cargo ||
    r.transit ||
    r.returning ||
    r.factory_id !== f.id ||
    Math.abs(r.x - home.x) + Math.abs(r.y - home.y) !== 1
  )
    throw new Error("请先取消任务并实际返站");
  if (action.type === "robot_camera") {
    if (
      typeof action.equipped !== "boolean" ||
      (root.simulation.industry?.stage ?? 1) < 5
    )
      throw new Error("摄像头需 P5 实物组件");
    if (!!r.camera === action.equipped) return;
    store(root.simulation.warehouse, {
      [itemID("摄像头组件")]: action.equipped ? -1 : 1,
    });
    r.camera = action.equipped;
    return;
  }
  r.service = {
    kind: action.kind,
    target: action.target,
    since_tick: endpointBuilding(root, action.target)
      ? (worldFactories(root).find((f) => f.id === action.target.factory_id)!
          .simulation.buildings[action.target.building_id].incident
          ?.since_tick ?? root.simulation.tick)
      : root.simulation.tick,
    parts: action.kind === "maintain" ? 1 : 0,
  };
  const d = specs(r),
    target = serviceTarget(root, r),
    path = journey(root, r, action.target);
  if (!serviceValid(root, r, d) || !target || !path)
    throw new Error("无可处理的持续异常、机型不符或现场不可达");
  const needed =
    path.cost +
    returnCost(root, r, path.end, action.kind === "maintain") +
    d.action_ticks +
    2;
  if (needed > d.energy_capacity_kj)
    throw new Error("现场作业及携货返程超过储能范围");
  if (r.service.parts)
    store(root.simulation.warehouse, { [itemID("维修备件箱")]: -1 });
  r.work_progress = 0;
  r.status = "waiting_charge";
}
export function finishService(root: LocalFactory, r: Robot): boolean {
  const target = serviceTarget(root, r);
  if (!target) return false;
  const fresh =
    r.service!.kind === "maintain" ? !target.i.maintained : !target.i.inspected;
  if (r.service!.kind === "maintain") {
    if (!("item" in target) || !target.item) return false;
    const n = Math.min(specs(r).capacity, count(target.m.output, target.item));
    remove(target.m.output, target.item, n);
    r.cargo = { item: target.item, count: n };
    r.service!.parts = 0;
    target.i.maintained = true;
  } else target.i.inspected = true;
  if (fresh) recordWork(root, r, "inspection");
  return true;
}
// Unused physical parts are only released after the robot really docks home.
export function releaseService(root: LocalFactory, r: Robot) {
  if (r.service?.parts) {
    const warehouse = root.simulation.warehouse,
      item = itemID("维修备件箱");
    if (!Number.isSafeInteger((warehouse[item] ?? 0) + r.service.parts))
      return false;
    store(warehouse, { [item]: r.service.parts });
  }
  delete r.service;
  return true;
}
