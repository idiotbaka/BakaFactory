import { wholeUnitsThisTick } from "./simulationTime";
import { containsCell } from "../footprint";
import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { buildingDefinitions, catalog } from "./catalog";
import { store } from "./inventory";
import { enabled } from "./transportConfig";
import {
  applyFreightAction,
  validFreight,
  type FreightAction,
} from "./robotFreight";
import { applyServiceAction, type ServiceAction } from "./robotService";
import { itemID } from "./catalog";
import {
  applyConstruction,
  constructionValid,
  type ConstructionAction,
} from "./construction";
import { plannedBuildings } from "./robotRoutes";
import { requiredRobotZones } from "./robotLifecycle";
import { robotBlocksMovement } from "./robotMovement";
import {
  configureAutonomy,
  validAutonomy,
  type AutonomyAction,
} from "./robotAutonomy";

export type RobotState = components["schemas"]["RobotState"];
export const robotDefinitions = new Map(
  (catalog.robots ?? []).map((r) => [r.item, r]),
);
export type RobotAction =
  | ConstructionAction
  | FreightAction
  | ServiceAction
  | AutonomyAction
  | {
      type: "robot_deploy";
      factory_id: string;
      station: string;
      item: string;
      id: string;
    }
  | { type: "robot_recall"; id: string }
  | {
      type: "robot_config";
      id: string;
      enabled?: boolean;
      priority?: number;
      allowed_zones?: string[];
    };
const factories = (root: LocalFactory) => [root, ...(root.districts ?? [])];
const integer = (n: unknown, min: number, max: number) =>
  Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 128;
const robotFields = new Set([
  "id",
  "item",
  "home_factory_id",
  "home_station",
  "factory_id",
  "x",
  "y",
  "energy_kj",
  "charge_remainder",
  "enabled",
  "allowed_zones",
  "priority",
  "cooldown",
  "status",
  "cargo",
  "task",
  "transit",
  "returning",
  "work_progress",
  "completed_tasks",
  "service",
  "camera",
  "autonomy",
  "behavior_log",
  "construction",
]);

export function validRobotWorld(root: LocalFactory): boolean {
  if (root.robots === undefined) return true;
  if (!Array.isArray(root.robots) || root.robots.length > 500) return false;
  const world = new Map(factories(root).map((f) => [f.id, f]));
  const ids = new Set<string>(),
    cells = new Set<string>();
  for (const r of root.robots) {
    if (
      !object(r) ||
      Object.keys(r).some((key) => !robotFields.has(key)) ||
      Object.values(r).some((value) => value === null) ||
      !identifier(r.id) ||
      ids.has(r.id) ||
      typeof r.item !== "string"
    )
      return false;
    const d = robotDefinitions.get(r.item),
      home = world.get(r.home_factory_id);
    if (
      !d ||
      !home ||
      !world.has(r.factory_id) ||
      !Array.isArray(r.allowed_zones) ||
      !r.allowed_zones.includes(r.factory_id) ||
      d.tier > (root.simulation.industry?.stage ?? 1) ||
      !identifier(r.home_station) ||
      !integer(r.x, -10, 10) ||
      !integer(r.y, -10, 10) ||
      !integer(r.energy_kj, 0, d.energy_capacity_kj) ||
      (r.charge_remainder !== undefined &&
        (!integer(r.charge_remainder, 0, 99) ||
          (d.energy !== "electric" && r.charge_remainder > 0) ||
          (r.energy_kj === d.energy_capacity_kj && r.charge_remainder > 0))) ||
      !integer(r.cooldown, 0, 60) ||
      !integer(r.priority, 1, 6) ||
      typeof r.enabled !== "boolean" ||
      !validFreight(root, r, d) ||
      !constructionValid(root, r) ||
      !validAutonomy(root, r)
    )
      return false;
    const station = home.buildings.find((b) => b.id === r.home_station),
      sd = station && buildingDefinitions.get(station.building_type);
    if (
      !station ||
      sd?.role !== "station" ||
      sd.energy !== d.energy ||
      !(sd.station_capacity_kj ?? 0) ||
      (!r.transit &&
        world
          .get(r.factory_id)!
          .buildings.some((b) => robotBlocksMovement(b) && containsCell(b, r)))
    )
      return false;
    if (
      !Array.isArray(r.allowed_zones) ||
      !r.allowed_zones.length ||
      r.allowed_zones.length > 100 ||
      new Set(r.allowed_zones).size !== r.allowed_zones.length ||
      !r.allowed_zones.includes(home.id) ||
      [...requiredRobotZones(r)].some((id) => !r.allowed_zones.includes(id)) ||
      r.allowed_zones.some(
        (id) => !world.has(id) || (!d.cross_district && id !== home.id),
      )
    )
      return false;
    const cell = `${r.factory_id}:${r.x},${r.y}`;
    if (!r.transit) {
      if (cells.has(cell)) return false;
      cells.add(cell);
    }
    ids.add(r.id);
  }
  return true;
}

// Runs on actWorld's clone: deployment and recall cannot partially transfer a
// device, and a deployed body is unavailable to recipes using warehouse stock.
export function applyRobotAction(root: LocalFactory, action: RobotAction) {
  if (action.type === "robot_construct") {
    applyConstruction(root, action);
    if (!validRobotWorld(root)) throw new Error("施工状态或厂区授权无效");
    return;
  }
  if (action.type === "robot_autonomy") {
    configureAutonomy(root, action);
    if (!validRobotWorld(root)) throw new Error("自主配置无效");
    return;
  }
  if (action.type === "robot_service" || action.type === "robot_camera") {
    applyServiceAction(root, action);
    if (!validRobotWorld(root)) throw new Error("机器人作业或厂区授权无效");
    return;
  }
  if (action.type === "robot_task" || action.type === "robot_return") {
    applyFreightAction(root, action);
    if (!validRobotWorld(root)) throw new Error("机器人任务或厂区授权无效");
    return;
  }
  const robots = (root.robots ??= []);
  if (action.type === "robot_deploy") {
    const home = factories(root).find((f) => f.id === action.factory_id),
      d = robotDefinitions.get(action.item);
    if (!home || action.factory_id !== (root.active_district_id ?? root.id))
      throw new Error("厂区已切换，请重新选择补能站");
    if (
      !identifier(action.id) ||
      robots.some((r) => r.id === action.id) ||
      robots.length >= 500
    )
      throw new Error("机器人 ID 重复或已达 500 台上限");
    if (!d || d.tier > (root.simulation.industry?.stage ?? 1))
      throw new Error("机器人尚未解锁");
    const station = home.buildings.find((b) => b.id === action.station),
      sd = station && buildingDefinitions.get(station.building_type);
    if (
      !station ||
      sd?.role !== "station" ||
      sd.energy !== d.energy ||
      !(sd.station_capacity_kj ?? 0)
    )
      throw new Error("请选择兼容该机器人能源的实际补能站");
    const dock = [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ]
      .map(([dx, dy]) => ({ x: station.x + dx, y: station.y + dy }))
      .find(
        (p) =>
          Math.abs(p.x) <= 10 &&
          Math.abs(p.y) <= 10 &&
          !home.buildings.some(
            (b) => robotBlocksMovement(b) && containsCell(b, p),
          ) &&
          !plannedBuildings(root, home.id).some((b) => containsCell(b, p)) &&
          !robots.some(
            (r) =>
              r.transit?.to_factory_id === home.id &&
              r.transit.x === p.x &&
              r.transit.y === p.y,
          ) &&
          !robots.some(
            (r) =>
              !r.transit &&
              r.factory_id === home.id &&
              r.x === p.x &&
              r.y === p.y,
          ),
      );
    if (!dock) throw new Error("补能站相邻空格已满，请留出停靠位置");
    store(root.simulation.warehouse, { [d.item]: -1 }, home.id);
    robots.push({
      id: action.id,
      item: d.item,
      home_factory_id: home.id,
      home_station: station.id,
      factory_id: home.id,
      ...dock,
      energy_kj: 0,
      enabled: true,
      allowed_zones: [home.id],
      priority: 3,
      cooldown: 0,
      status: "idle",
    });
  } else {
    const r = robots.find((r) => r.id === action.id);
    if (!r) throw new Error("机器人不存在");
    if (action.type === "robot_recall") {
      const home = factories(root).find((f) => f.id === r.home_factory_id),
        station = home?.buildings.find((b) => b.id === r.home_station);
      if (
        r.task ||
        r.service ||
        r.construction ||
        r.cargo ||
        r.transit ||
        r.returning ||
        !home ||
        !station ||
        r.factory_id !== home.id ||
        Math.abs(r.x - station.x) + Math.abs(r.y - station.y) !== 1
      )
        throw new Error("机器人须实际返站后才能召回");
      store(root.simulation.warehouse, { [r.item]: 1 }, r.factory_id);
      if (r.camera)
        store(
          root.simulation.warehouse,
          { [itemID("摄像头组件")]: 1 },
          r.factory_id,
        );
      root.robots = robots.filter((b) => b.id !== r.id);
      if (root.simulation.industry?.work_receipts)
        root.simulation.industry.work_receipts =
          root.simulation.industry.work_receipts.filter(
            (e) => e.robot_id !== r.id,
          );
    } else {
      if (action.enabled !== undefined) r.enabled = action.enabled;
      if (action.priority !== undefined) r.priority = action.priority;
      if (action.allowed_zones !== undefined)
        r.allowed_zones = action.allowed_zones;
      // Active status is also the departure/handling phase. Configuration or
      // pause must not turn an in-flight task into a fresh charging departure.
      if (
        !r.task &&
        !r.service &&
        !r.construction &&
        !r.transit &&
        !r.returning
      )
        r.status = r.enabled ? "idle" : "paused";
    }
  }
  if (!validRobotWorld(root))
    throw new Error("机器人位置、能源、优先级或厂区权限无效");
}

// A station only distributes kJ already paid by allocatePower. Priority then
// tick rotation decides contention; the station's total rate is shared.
export function chargeRobots(root: LocalFactory) {
  root.robots = structuredClone(root.robots ?? []);
  if (!root.robots.length) return;
  const docks = new Map<string, Map<string, RobotState[]>>();
  for (const r of root.robots) {
    if (!r.enabled) continue;
    const stations =
      docks.get(r.home_factory_id) ?? new Map<string, RobotState[]>();
    docks.set(r.home_factory_id, stations);
    const rows = stations.get(r.home_station) ?? [];
    rows.push(r);
    stations.set(r.home_station, rows);
  }
  for (const r of root.robots) {
    if (
      r.enabled &&
      (r.task || r.service || r.construction || r.transit || r.returning)
    )
      continue;
    r.status = !r.enabled
      ? "paused"
      : r.energy_kj >= robotDefinitions.get(r.item)!.energy_capacity_kj
        ? "charged"
        : r.energy_kj
          ? "idle"
          : "no_energy";
  }
  for (const f of factories(root))
    for (const station of f.buildings) {
      const sd = buildingDefinitions.get(station.building_type)!;
      if (sd.role !== "station" || !enabled(station)) continue;
      const state = f.simulation.buildings[station.id];
      let budget = Math.min(
        state.station_energy_kj ?? 0,
        wholeUnitsThisTick(sd.station_transfer_kw ?? 0, root.simulation.tick),
      );
      budget = Math.floor(budget);
      const candidates = (docks.get(f.id)?.get(station.id) ?? [])
        .filter(
          (r) =>
            r.enabled &&
            !r.transit &&
            r.home_factory_id === f.id &&
            r.home_station === station.id &&
            r.factory_id === f.id &&
            Math.abs(r.x - station.x) + Math.abs(r.y - station.y) === 1,
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const offset = candidates.length
        ? root.simulation.tick % candidates.length
        : 0;
      const ordered = [
        ...candidates.slice(offset),
        ...candidates.slice(0, offset),
      ];
      for (let priority = 1; priority <= 6; priority++)
        for (const r of ordered.filter((r) => r.priority === priority)) {
          const d = robotDefinitions.get(r.item)!,
            missing = d.energy_capacity_kj - r.energy_kj,
            n = Math.min(
              budget,
              d.energy === "electric"
                ? Math.ceil((missing * 100 - (r.charge_remainder ?? 0)) / 88)
                : missing,
            );
          if (n > 0) {
            if (d.energy === "electric") {
              const scaled = n * 88 + (r.charge_remainder ?? 0);
              r.energy_kj += Math.floor(scaled / 100);
              r.charge_remainder =
                r.energy_kj >= d.energy_capacity_kj ? 0 : scaled % 100;
            } else r.energy_kj += n;
            state.station_energy_kj! -= n;
            budget -= n;
            state.status = "refueling";
          }
          // A passing robot may receive paid energy, but remains in its
          // current task phase rather than restarting the full-charge gate.
          if (!r.task && !r.service && !r.construction && !r.returning)
            r.status =
              r.energy_kj === d.energy_capacity_kj
                ? "charged"
                : n > 0
                  ? "charging"
                  : r.energy_kj
                    ? "idle"
                    : "no_energy";
        }
    }
}
