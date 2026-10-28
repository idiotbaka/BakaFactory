import { bindWarehouse, warehouseAttempt } from "./warehouseActivity";
import { secondsToTicks } from "./simulationTime";
import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { catalog, buildingDefinitions, selectedRecipe } from "./catalog";
import { canAddAll, count } from "./inventory";
import { enabled, face, rotations } from "./transportConfig";
import { applyFreightAction } from "./robotFreight";
import { applyServiceAction } from "./robotService";
import { powerPriority } from "./power";
import {
  endpointBuilding,
  homeEndpoint,
  worldFactories,
  type Robot,
} from "./robotRoutes";
type Auto = components["schemas"]["RobotAutonomy"];
export type AutonomyAction = {
  type: "robot_autonomy";
  id: string;
  config: Omit<Auto, "next_tick">;
};
const smart = (r: Robot) =>
  catalog.robots!.find((d) => d.item === r.item)?.role === "smart";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const kinds = [
  "configured",
  "refill",
  "inspect",
  "maintain",
  "waiting",
  "construct",
  "built",
] as const;
function log(
  root: LocalFactory,
  r: Robot,
  kind: (typeof kinds)[number],
  detail: string,
) {
  const rows = (r.behavior_log ??= []);
  if (rows.at(-1)?.kind === kind && rows.at(-1)?.detail === detail) return;
  rows.push({ tick: root.simulation.tick, kind, detail });
  r.behavior_log = rows.slice(-20);
}
export function validAutonomy(root: LocalFactory, r: Robot): boolean {
  const a = r.autonomy;
  if (
    a !== undefined &&
    (!a ||
      typeof a !== "object" ||
      Array.isArray(a) ||
      !smart(r) ||
      Object.keys(a).some(
        (k) =>
          !["enabled", "refill", "inspect", "maintain", "next_tick"].includes(
            k,
          ),
      ) ||
      [a.enabled, a.refill, a.inspect, a.maintain].some(
        (v) => typeof v !== "boolean",
      ) ||
      !Number.isSafeInteger(a.next_tick) ||
      a.next_tick < 0 ||
      a.next_tick >
        Math.min(
          Number.MAX_SAFE_INTEGER,
          root.simulation.tick + secondsToTicks(5),
        ))
  )
    return false;
  if (r.behavior_log === undefined) return true;
  return (
    Array.isArray(r.behavior_log) &&
    r.behavior_log.length <= 20 &&
    r.behavior_log.every(
      (e) =>
        !!e &&
        typeof e === "object" &&
        !Array.isArray(e) &&
        Object.keys(e).every((k) => ["tick", "kind", "detail"].includes(k)) &&
        Number.isSafeInteger(e.tick) &&
        e.tick >= 0 &&
        e.tick <= root.simulation.tick &&
        kinds.includes(e.kind) &&
        typeof e.detail === "string" &&
        e.detail.length > 0 &&
        e.detail.length <= 128,
    )
  );
}
export function configureAutonomy(root: LocalFactory, action: AutonomyAction) {
  const r = root.robots?.find((r) => r.id === action.id),
    c = action.config;
  if (
    !r ||
    !smart(r) ||
    !c ||
    Object.keys(c).some(
      (k) => !["enabled", "refill", "inspect", "maintain"].includes(k),
    ) ||
    [c.enabled, c.refill, c.inspect, c.maintain].some(
      (v) => typeof v !== "boolean",
    )
  )
    throw new Error("仅智能机器人可配置自主派单");
  r.autonomy = { ...c, next_tick: root.simulation.tick };
  log(
    root,
    r,
    "configured",
    c.enabled ? "自主派单已启用" : "自主派单已暂停；已有任务仍按原路线执行",
  );
}
// An automatic rejected proposal must be as atomic as a rejected player edit.
// These proposal handlers only mutate this robot and the shared warehouse.
function proposal(root: LocalFactory, r: Robot, apply: () => void) {
  const previous = structuredClone(r),
    warehouse = structuredClone(root.simulation.warehouse);
  try {
    warehouseAttempt(apply);
    return true;
  } catch {
    for (const key of Object.keys(r))
      delete (r as unknown as Record<string, unknown>)[key];
    Object.assign(r, previous);
    root.simulation.warehouse = warehouse;
    bindWarehouse(warehouse, root.id);
    return false;
  }
}
export function dispatchRobots(root: LocalFactory) {
  if (
    !root.robots?.some(
      (r) =>
        smart(r) &&
        r.enabled &&
        r.autonomy?.enabled &&
        !r.task &&
        !r.service &&
        !r.construction &&
        !r.cargo &&
        !r.transit &&
        !r.returning &&
        root.simulation.tick >= r.autonomy.next_tick,
    )
  )
    return;
  const factories = worldFactories(root),
    robots = root.robots ?? [],
    candidates = factories.flatMap((f) =>
      f.buildings.filter(enabled).map((b) => ({
        f,
        b,
        priority: powerPriority(b),
      })),
    );
  const demand = new Map<string, number>(),
    pledges = new Map<string, number>();
  const key = (factory: string, building: string, item: string) =>
    JSON.stringify([factory, building, item]);
  const sourceKey = (factory: string, building: string, item: string) =>
    endpointBuilding(root, { factory_id: factory, building_id: building })
      ?.building_type === "bus"
      ? JSON.stringify(["shared-warehouse", item])
      : key(factory, building, item);
  const reserve = (bot: Robot) => {
    const t = bot.task;
    if (!t) return;
    const target = key(t.target.factory_id, t.target.building_id, t.item);
    demand.set(target, (demand.get(target) ?? 0) + t.count - t.delivered);
    if (t.phase === "pickup") {
      const source = sourceKey(
        t.source.factory_id,
        t.source.building_id,
        t.item,
      );
      pledges.set(
        source,
        (pledges.get(source) ?? 0) + t.count - (bot.cargo?.count ?? 0),
      );
    }
  };
  robots.forEach(reserve);
  // Rotate peers before the stable priority sort. UUIDs and saved tick make
  // selection reproducible across save/reload; there is no wall clock or AI.
  candidates.sort((a, b) => compare(a.f.id, b.f.id) || compare(a.b.id, b.b.id));
  const offset = candidates.length
    ? root.simulation.tick % candidates.length
    : 0;
  const ordered = [
    ...candidates.slice(offset),
    ...candidates.slice(0, offset),
  ].sort((a, b) => a.priority - b.priority);
  const sorted = [...robots].sort((a, b) => compare(a.id, b.id)),
    start = sorted.length ? root.simulation.tick % sorted.length : 0;
  let budget = 2000;
  for (const r of [...sorted.slice(start), ...sorted.slice(0, start)].sort(
    (a, b) => a.priority - b.priority,
  )) {
    if (budget <= 0) break;
    const cfg = r.autonomy;
    if (
      !smart(r) ||
      !r.enabled ||
      !cfg?.enabled ||
      r.task ||
      r.service ||
      r.construction ||
      r.cargo ||
      r.transit ||
      r.returning ||
      root.simulation.tick < cfg.next_tick
    )
      continue;
    const station = endpointBuilding(root, homeEndpoint(r));
    if (
      !station ||
      r.factory_id !== r.home_factory_id ||
      Math.abs(r.x - station.x) + Math.abs(r.y - station.y) !== 1
    )
      continue;
    cfg.next_tick = Math.min(
      Number.MAX_SAFE_INTEGER,
      root.simulation.tick + secondsToTicks(5),
    );
    let assigned = false;
    for (const { f, b } of ordered) {
      if (--budget < 0) break;
      if (!r.allowed_zones.includes(f.id)) continue;
      const endpoint = { factory_id: f.id, building_id: b.id },
        m = f.simulation.buildings[b.id],
        recipe = selectedRecipe(b);
      if (cfg.refill && recipe)
        for (const [item, n] of Object.entries(recipe.inputs)) {
          const reserved = demand.get(key(f.id, b.id, item)) ?? 0,
            missing = n - count(m.input, item) - reserved;
          if (missing <= 0) continue;
          for (const source of factories) {
            if (--budget < 0) break;
            if (!r.allowed_zones.includes(source.id)) continue;
            const bus = source.buildings.find(
              (b) => b.building_type === "bus",
            )!;
            if (
              !enabled(bus) ||
              !rotations.some((rot) => {
                const port = face(bus, rot);
                return port.mode === "output" && port.filter === item;
              })
            )
              continue;
            const pledged =
                pledges.get(sourceKey(source.id, bus.id, item)) ?? 0,
              available = (root.simulation.warehouse[item] ?? 0) - pledged;
            const amount = Math.min(
              missing,
              catalog.robots!.find((d) => d.item === r.item)!.capacity,
              available,
            );
            if (
              amount < 1 ||
              !canAddAll(
                m.input,
                { [item]: amount },
                buildingDefinitions.get(b.building_type)?.input_slots,
              )
            )
              continue;
            if (
              proposal(root, r, () =>
                applyFreightAction(root, {
                  type: "robot_task",
                  id: r.id,
                  task_id: `auto:${r.id.slice(0, 90)}:${root.simulation.tick}`,
                  source: { factory_id: source.id, building_id: bus.id },
                  target: endpoint,
                  item,
                  count: amount,
                  channel: "input",
                  repeat: false,
                }),
              )
            ) {
              reserve(r);
              log(
                root,
                r,
                "refill",
                `${f.name} (${b.x},${b.y}) · ${item} ×${amount}`,
              );
              assigned = true;
              break;
            }
          }
          if (assigned) break;
        }
      if (assigned) break;
      const incident = m.incident;
      if (
        !incident ||
        root.simulation.tick - incident.since_tick < secondsToTicks(5)
      )
        continue;
      for (const kind of ["maintain", "inspect"] as const) {
        if (
          !cfg[kind] ||
          (kind === "inspect" && incident.inspected) ||
          (kind === "maintain" && incident.kind !== "output_full") ||
          robots.some(
            (bot) =>
              !bot.returning &&
              bot.service?.kind === kind &&
              bot.service.target.factory_id === f.id &&
              bot.service.target.building_id === b.id,
          )
        )
          continue;
        if (
          proposal(root, r, () =>
            applyServiceAction(root, {
              type: "robot_service",
              id: r.id,
              kind,
              target: endpoint,
            }),
          )
        ) {
          log(root, r, kind, `${f.name} (${b.x},${b.y}) · ${incident.kind}`);
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }
    if (!assigned)
      log(root, r, "waiting", "授权区内无可达目标、可用供货端或未预留的需求");
  }
}
