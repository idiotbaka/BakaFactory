import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  catalog,
  isChest,
  isFluid,
  isFluidNode,
  itemDefinitions,
  selectedRecipe,
} from "./catalog";
import { add, count, remove, store } from "./inventory";
import { enabled, face, itemFilter, side } from "./transportConfig";
import { acceptsFluid } from "./fluidConfig";
import { fuelValues } from "./fuel";
import {
  cellKey,
  emptyCell,
  endpointBuilding,
  homeEndpoint,
  journey,
  returnCost,
  warehouseEndpoint,
  worldFactories,
  type Endpoint,
  type Point,
  type Robot,
} from "./robotRoutes";
import {
  serviceValid,
  serviceTarget,
  finishService,
  releaseService,
} from "./robotService";
import { recordWork } from "./workLedger";
import {
  constructionValid,
  constructionJourney,
  constructionTicks,
  finishConstruction,
} from "./construction";

type Task = components["schemas"]["RobotTask"];
type Spec = components["schemas"]["RobotDefinition"];
export type FreightAction =
  | {
      type: "robot_task";
      id: string;
      task_id: string;
      source: Endpoint;
      target: Endpoint;
      item: string;
      count: number;
      channel: Task["channel"];
      repeat: boolean;
    }
  | { type: "robot_return"; id: string };
const specFor = (r: Robot) => catalog.robots!.find((d) => d.item === r.item)!;
export const robotStatuses = [
  "idle",
  "charging",
  "paused",
  "charged",
  "no_energy",
  "moving",
  "in_transit",
  "no_path",
  "congested",
  "loading",
  "unloading",
  "source_empty",
  "blocked",
  "rejected",
  "waiting_charge",
  "range_exceeded",
  "returning",
  "inspecting",
  "maintaining",
  "constructing",
];
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 128;
const int = (v: unknown, max: number) =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const keys = (v: object, fields: string[]) =>
  Object.keys(v).every((k) => fields.includes(k));
export const canCarry = (d: Spec, item: string) =>
  !!itemDefinitions.get(item) &&
  d.capacity > 0 &&
  ["carrier", "smart", "repair"].includes(d.role) &&
  (!isFluid(item) || d.role === "smart" || d.energy === "hydraulic");
function validEndpoint(
  root: LocalFactory,
  r: Robot,
  e: unknown,
): e is Endpoint {
  return (
    obj(e) &&
    keys(e, ["factory_id", "building_id"]) &&
    id(e.factory_id) &&
    id(e.building_id) &&
    r.allowed_zones.includes(e.factory_id) &&
    worldFactories(root).some((f) => f.id === e.factory_id)
  );
}
export function validFreight(root: LocalFactory, r: Robot, d: Spec) {
  if (!serviceValid(root, r, d)) return false;
  if (
    !robotStatuses.includes(r.status) ||
    !int(
      r.work_progress ?? 0,
      r.construction ? constructionTicks : d.action_ticks,
    ) ||
    !int(r.completed_tasks ?? 0, Number.MAX_SAFE_INTEGER)
  )
    return false;
  if (
    r.returning !== undefined &&
    !["cancelled", "energy", "complete", "invalid_target"].includes(r.returning)
  )
    return false;
  if (
    r.cargo !== undefined &&
    (!obj(r.cargo) ||
      !keys(r.cargo, ["item", "count"]) ||
      !canCarry(d, r.cargo.item) ||
      !int(r.cargo.count, d.capacity) ||
      r.cargo.count < 1)
  )
    return false;
  if (r.task !== undefined) {
    if (!["carrier", "smart"].includes(d.role)) return false;
    const t = r.task;
    if (
      !obj(t) ||
      !keys(t, [
        "id",
        "source",
        "target",
        "item",
        "count",
        "channel",
        "repeat",
        "phase",
        "delivered",
      ]) ||
      !id(t.id) ||
      !validEndpoint(root, r, t.source) ||
      !validEndpoint(root, r, t.target) ||
      (t.source.factory_id === t.target.factory_id &&
        t.source.building_id === t.target.building_id) ||
      !canCarry(d, t.item) ||
      !int(t.count, d.capacity) ||
      t.count < 1 ||
      typeof t.repeat !== "boolean" ||
      !["auto", "input", "fuel"].includes(t.channel) ||
      !["pickup", "deliver"].includes(t.phase) ||
      !int(t.delivered, t.count) ||
      (r.cargo?.count ?? 0) + t.delivered > t.count ||
      (r.cargo && r.cargo.item !== t.item) ||
      (t.phase === "pickup" && t.delivered !== 0) ||
      (t.phase === "deliver" && !r.cargo)
    )
      return false;
  } else if (r.cargo && !r.returning && !r.construction) return false;
  if (r.transit !== undefined) {
    const t = r.transit;
    if (
      !obj(t) ||
      !keys(t, ["to_factory_id", "x", "y", "remaining_ticks"]) ||
      !d.cross_district ||
      !r.allowed_zones.includes(t.to_factory_id) ||
      t.to_factory_id === r.factory_id ||
      !int(t.remaining_ticks, 8) ||
      !Number.isInteger(t.x) ||
      !Number.isInteger(t.y) ||
      Math.abs(t.x) + Math.abs(t.y) !== 1 ||
      Math.abs(r.x) + Math.abs(r.y) !== 1 ||
      !worldFactories(root).some(
        (f) => f.id === t.to_factory_id && emptyCell(f, t),
      )
    )
      return false;
  }
  return true;
}
const at = (r: Robot, b: { x: number; y: number }, factoryID: string) =>
  !r.transit &&
  r.factory_id === factoryID &&
  Math.abs(r.x - b.x) + Math.abs(r.y - b.y) === 1;
function beginReturn(r: Robot, reason: NonNullable<Robot["returning"]>) {
  r.returning = reason;
  r.work_progress = 0;
  if (reason !== "energy") delete r.task;
}
function tripCost(root: LocalFactory, r: Robot, t: Task) {
  const source = freightJourney(root, r, t.source, t.item, true),
    target =
      source && freightJourney(root, source.end, t.target, t.item, false);
  return source && target
    ? Math.max(
        source.cost + target.cost + returnCost(root, r, target.end, true),
        source.cost + returnCost(root, r, source.end, true),
      ) +
        2 * specFor(r).action_ticks +
        2 * t.count +
        2
    : Infinity;
}
export function freightJourney(
  root: LocalFactory,
  from: Point,
  endpoint: Endpoint,
  item: string,
  loading: boolean,
  occupied?: Set<string>,
) {
  const b = endpointBuilding(root, endpoint);
  const dock =
    b?.building_type === "bus"
      ? (p: { x: number; y: number }) => {
          const rotation = side(b, p);
          if (rotation === undefined) return false;
          const port = face(b, rotation);
          return (
            enabled(b) &&
            (loading
              ? port.mode === "output" && port.filter === item
              : port.mode === "input" && (!port.filter || port.filter === item))
          );
        }
      : undefined;
  return journey(root, from, endpoint, occupied, dock);
}
export function applyFreightAction(root: LocalFactory, action: FreightAction) {
  const r = root.robots?.find((r) => r.id === action.id);
  if (!r) throw new Error("机器人不存在");
  if (action.type === "robot_return") {
    beginReturn(r, "cancelled");
    return;
  }
  if (
    r.task ||
    r.service ||
    r.construction ||
    r.cargo ||
    r.transit ||
    r.returning
  )
    throw new Error("请先取消现有任务并实际返站后再指派");
  if (!["carrier", "smart"].includes(specFor(r).role))
    throw new Error("该机型请使用巡检或维护作业");
  const home = endpointBuilding(root, homeEndpoint(r));
  if (!home || !at(r, home, r.home_factory_id))
    throw new Error("请实际返站后再指派路线");
  r.task = {
    id: action.task_id,
    source: action.source,
    target: action.target,
    item: action.item,
    count: action.count,
    channel: action.channel,
    repeat: action.repeat,
    phase: "pickup",
    delivered: 0,
  };
  if (!validFreight(root, r, specFor(r)))
    throw new Error("运输物品、载重、端点或厂区授权无效");
  const source = endpointBuilding(root, action.source),
    target = endpointBuilding(root, action.target);
  const supported = (type: string) =>
    type === "bus" ||
    isChest(type) ||
    isFluidNode(type) ||
    buildingDefinitions.get(type)?.category === "machine";
  if (
    !source ||
    !target ||
    !supported(source.building_type) ||
    !supported(target.building_type)
  )
    throw new Error("请选择实际机器、WH、箱子或流体容器");
  const cost = tripCost(root, r, r.task);
  if (!Number.isFinite(cost))
    throw new Error("路线不可达，请在端点及 WH 出入口留出空闲通道");
  if (cost > specFor(r).energy_capacity_kj)
    throw new Error("完整行程超过机器人储能范围，请缩短路线或升级机器人");
  r.work_progress = 0;
  r.status = "waiting_charge";
}

// Sequential post-production planning runs on a fresh world clone. Each
// confirmed stock operation and its cargo update happen in the same tick.
function exchange(
  root: LocalFactory,
  r: Robot,
  e: Endpoint,
  loading: boolean,
  wanted: number,
  budgets: Map<string, number>,
) {
  const f = worldFactories(root).find((f) => f.id === e.factory_id)!,
    b = endpointBuilding(root, e)!;
  const d = buildingDefinitions.get(b.building_type)!,
    m = f.simulation.buildings[b.id],
    item = r.task!.item;
  let n = Math.max(0, wanted),
    kind: "warehouse" | "input" | "output" | "fuel" | "fluid";
  let budgetKey = "";
  if (b.building_type === "bus") {
    const rotation = side(b, r),
      port = rotation === undefined ? undefined : face(b, rotation);
    if (!enabled(b) || !port) return { n: 0, status: "rejected" };
    if (
      loading
        ? port.mode !== "output" || port.filter !== item
        : port.mode !== "input" || (!!port.filter && port.filter !== item)
    )
      return { n: 0, status: "rejected" };
    kind = "warehouse";
    if (loading) {
      // Fluid auto-output has no per-face receipt: conservatively yield this
      // tick rather than exceed the shared WH face rate.
      if (
        (m.flow_out ?? 0) > 0 ||
        (f.simulation.transfers ?? []).some(
          (t) =>
            t.tick === f.simulation.tick &&
            t.source.id === b.id &&
            side(b, t.via ?? t.target) === rotation,
        )
      )
        return { n: 0, status: "blocked" };
      budgetKey = `${f.id}:${b.id}:${rotation}`;
      const limit = 1 - (budgets.get(budgetKey) ?? 0);
      n = Math.min(n, f.simulation.warehouse[item] ?? 0, limit);
    } else
      n = Math.min(
        n,
        Number.MAX_SAFE_INTEGER - (f.simulation.warehouse[item] ?? 0),
      );
  } else if (isFluidNode(b.building_type)) {
    if (
      !enabled(b) ||
      !isFluid(item) ||
      !acceptsFluid(b.building_type, item) ||
      (itemFilter(b) && itemFilter(b) !== item) ||
      (m.fluid && m.fluid.item !== item)
    )
      return { n: 0, status: "rejected" };
    kind = "fluid";
    n = Math.min(
      n,
      loading
        ? (m.fluid?.count ?? 0)
        : (d.fluid_capacity ?? 0) - (m.fluid?.count ?? 0),
    );
  } else if (isChest(b.building_type)) {
    if (
      !enabled(b) ||
      isFluid(item) ||
      (!loading && itemFilter(b) && itemFilter(b) !== item)
    )
      return { n: 0, status: "rejected" };
    kind = "output";
  } else if (loading) kind = "output";
  else if (r.task!.channel !== "fuel" && selectedRecipe(b)?.inputs[item])
    kind = "input";
  else if (r.task!.channel !== "input" && fuelValues(d)[item]) kind = "fuel";
  else return { n: 0, status: "rejected" };
  if (kind !== "warehouse" && kind !== "fluid") {
    const inv = m[kind] ?? [],
      slots =
        kind === "fuel"
          ? 3
          : kind === "input"
            ? (d.input_slots ?? 12)
            : (d.output_slots ?? 12);
    n = Math.min(
      n,
      loading
        ? count(inv, item)
        : inv.some((s) => s.item === item) || inv.length < slots
          ? 100 - count(inv, item)
          : 0,
    );
  }
  if (n <= 0) return { n: 0, status: loading ? "source_empty" : "blocked" };
  // Capacity/source probe before paying handling energy; no mutation yet.
  return {
    n,
    status: loading ? "loading" : "unloading",
    commit: () => {
      if (kind === "warehouse")
        store(f.simulation.warehouse, { [item]: loading ? -n : n });
      else if (kind === "fluid") {
        if (loading) {
          m.fluid!.count -= n;
          if (!m.fluid!.count) delete m.fluid;
        } else m.fluid = { item, count: (m.fluid?.count ?? 0) + n };
      } else if (loading) remove(m[kind]!, item, n);
      else {
        m[kind] ??= [];
        if (
          !add(
            m[kind]!,
            item,
            n,
            kind === "fuel"
              ? 3
              : kind === "input"
                ? d.input_slots
                : d.output_slots,
          )
        )
          throw new Error("机器人容量预留与提交不一致");
      }
      if (budgetKey) budgets.set(budgetKey, (budgets.get(budgetKey) ?? 0) + n);
    },
  };
}

export function robotDestination(
  root: LocalFactory,
  r: Robot,
): Endpoint | undefined {
  if (r.returning)
    return r.cargo
      ? warehouseEndpoint(root, r.home_factory_id)
      : homeEndpoint(r);
  if (r.service) return r.service.target;
  if (r.construction)
    return {
      factory_id: r.construction.factory_id,
      building_id: r.construction.id,
    };
  if (r.task) return r.task.phase === "pickup" ? r.task.source : r.task.target;
}
export function robotJourney(
  root: LocalFactory,
  r: Robot,
  occupied?: Set<string>,
) {
  const endpoint = robotDestination(root, r);
  if (!endpoint) return;
  return r.returning || r.service
    ? journey(root, r, endpoint, occupied)
    : r.construction
      ? constructionJourney(root, r, r, occupied)
      : freightJourney(
          root,
          r,
          endpoint,
          r.task!.item,
          r.task!.phase === "pickup",
          occupied,
        );
}
export function stepFreight(root: LocalFactory) {
  const rows = [...(root.robots ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    offset = rows.length ? root.simulation.tick % rows.length : 0;
  const ordered = [...rows.slice(offset), ...rows.slice(0, offset)].sort(
    (a, b) => a.priority - b.priority,
  );
  const occupied = new Set(rows.filter((r) => !r.transit).map(cellKey)),
    budgets = new Map<string, number>();
  for (const r of ordered) {
    if (!r.enabled) continue;
    const d = specFor(r);
    const spend = () => {
      if (r.energy_kj < 1) {
        r.status = "no_energy";
        return false;
      }
      r.energy_kj--;
      return true;
    };
    if (r.transit) {
      r.status = "in_transit";
      if (r.transit.remaining_ticks > 0) {
        if (!spend()) continue;
        r.transit.remaining_ticks--;
      }
      if (!r.transit.remaining_ticks) {
        const landing = {
          factory_id: r.transit.to_factory_id,
          x: r.transit.x,
          y: r.transit.y,
        };
        if (!occupied.has(cellKey(landing))) {
          Object.assign(r, landing);
          delete r.transit;
          occupied.add(cellKey(r));
        } else r.status = "congested";
      }
      continue;
    }
    const home = endpointBuilding(root, homeEndpoint(r))!;
    if (r.returning && !r.cargo && at(r, home, r.home_factory_id)) {
      if (
        r.returning === "energy" &&
        (r.task || r.service) &&
        r.energy_kj < d.energy_capacity_kj
      ) {
        r.status = "waiting_charge";
        continue;
      }
      if (r.returning !== "energy" && !releaseService(root, r)) {
        r.status = "blocked";
        continue;
      }
      delete r.returning;
      delete r.construction;
      r.work_progress = 0;
    }
    if (!r.task && !r.service && !r.construction && !r.returning) continue;
    if (r.cooldown > 0 && !r.returning) {
      r.cooldown--;
      continue;
    }
    if (
      r.task &&
      (!endpointBuilding(root, r.task.source) ||
        !endpointBuilding(root, r.task.target))
    )
      beginReturn(r, "invalid_target");
    if (!r.returning && r.service && !serviceTarget(root, r))
      beginReturn(r, "invalid_target");
    if (!r.returning && r.construction && !constructionValid(root, r))
      beginReturn(r, "invalid_target");
    if (
      !r.returning &&
      r.service &&
      at(r, home, r.home_factory_id) &&
      r.energy_kj < d.energy_capacity_kj
    ) {
      r.status = "waiting_charge";
      continue;
    }
    if (!r.returning && r.task?.phase === "pickup" && !r.cargo) {
      if (
        at(r, home, r.home_factory_id) &&
        r.energy_kj < d.energy_capacity_kj
      ) {
        r.status = "waiting_charge";
        continue;
      }
      const needed = tripCost(root, r, r.task);
      if (!Number.isFinite(needed)) {
        r.status = "no_path";
        continue;
      }
      if (needed > d.energy_capacity_kj) {
        r.status = "range_exceeded";
        continue;
      }
      if (r.energy_kj < needed) beginReturn(r, "energy");
    }
    const endpoint = robotDestination(root, r)!;
    occupied.delete(cellKey(r));
    const plan = robotJourney(root, r, occupied);
    occupied.add(cellKey(r));
    if (!plan) {
      r.status = robotJourney(root, r) ? "congested" : "no_path";
      continue;
    }
    if (plan.route.length) {
      const next = plan.route[0],
        needed = returnCost(root, r, next);
      if (r.energy_kj - 1 < needed + (r.returning ? 0 : 2)) {
        if (!r.returning) beginReturn(r, "energy");
        r.status = "no_energy";
        continue;
      }
      if (!spend()) continue;
      occupied.delete(cellKey(r));
      Object.assign(r, next);
      occupied.add(cellKey(r));
      r.work_progress = 0;
      r.status = r.returning ? "returning" : "moving";
      continue;
    }
    if (plan.arrival) {
      if (
        r.energy_kj <
        8 + returnCost(root, r, plan.arrival) + (r.returning ? 0 : 2)
      ) {
        if (!r.returning) beginReturn(r, "energy");
        r.status = "no_energy";
        continue;
      }
      occupied.delete(cellKey(r));
      r.transit = {
        to_factory_id: plan.arrival.factory_id,
        x: plan.arrival.x,
        y: plan.arrival.y,
        remaining_ticks: 8,
      };
      r.work_progress = 0;
      r.status = "in_transit";
      continue;
    }
    if (r.returning) {
      if (r.cargo) {
        const f = worldFactories(root).find((f) => f.id === r.home_factory_id)!;
        if (
          !Number.isSafeInteger(
            (f.simulation.warehouse[r.cargo.item] ?? 0) + r.cargo.count,
          )
        ) {
          r.status = "blocked";
          continue;
        }
        if (!spend()) continue;
        store(f.simulation.warehouse, { [r.cargo.item]: r.cargo.count });
        delete r.cargo;
        if (r.task) {
          if (r.task.repeat) {
            r.task.phase = "pickup";
            r.task.delivered = 0;
          } else delete r.task;
        }
      }
      r.status = "returning";
      continue;
    }
    if (r.construction) {
      if (r.energy_kj - 1 < returnCost(root, r) + 2) {
        beginReturn(r, "energy");
        continue;
      }
      if (!spend()) continue;
      r.work_progress = (r.work_progress ?? 0) + 1;
      r.status = "constructing";
      if (r.work_progress >= constructionTicks) {
        beginReturn(
          r,
          finishConstruction(root, r) ? "complete" : "invalid_target",
        );
      }
      continue;
    }
    if (r.service) {
      if (
        r.energy_kj - 1 <
        returnCost(root, r, r, r.service.kind === "maintain") + 2
      ) {
        beginReturn(r, "energy");
        continue;
      }
      if (!spend()) continue;
      r.work_progress = (r.work_progress ?? 0) + 1;
      r.status = r.service.kind === "inspect" ? "inspecting" : "maintaining";
      if (r.work_progress >= d.action_ticks) {
        if (finishService(root, r)) beginReturn(r, "complete");
        else beginReturn(r, "invalid_target");
      }
      continue;
    }
    const t = r.task!,
      loading = t.phase === "pickup";
    const transfer = exchange(
      root,
      r,
      endpoint,
      loading,
      loading ? t.count - (r.cargo?.count ?? 0) : r.cargo!.count,
      budgets,
    );
    if (!transfer.n) {
      if (loading && r.cargo) {
        t.phase = "deliver";
        r.work_progress = 0;
      }
      r.status = transfer.status;
      continue;
    }
    if (r.energy_kj - 1 < returnCost(root, r, r, loading || !!r.cargo) + 2) {
      beginReturn(r, "energy");
      continue;
    }
    if (!spend()) continue;
    if ((r.work_progress ?? 0) < d.action_ticks) {
      r.work_progress = (r.work_progress ?? 0) + 1;
      r.status = loading ? "loading" : "unloading";
      continue;
    }
    transfer.commit!();
    if (loading) {
      r.cargo = { item: t.item, count: (r.cargo?.count ?? 0) + transfer.n };
      if (r.cargo.count >= t.count) {
        t.phase = "deliver";
        r.work_progress = 0;
      }
    } else {
      r.cargo!.count -= transfer.n;
      t.delivered += transfer.n;
      if (!r.cargo!.count) {
        delete r.cargo;
        recordWork(root, r, "freight");
        r.completed_tasks = Math.min(
          Number.MAX_SAFE_INTEGER,
          (r.completed_tasks ?? 0) + 1,
        );
        r.work_progress = 0;
        if (t.repeat) {
          t.phase = "pickup";
          t.delivered = 0;
        } else beginReturn(r, "complete");
      }
    }
    r.status = loading ? "loading" : "unloading";
  }
}
