import { overlaps, containsCell } from "../footprint";
import type { User } from "../../api/client";
import {
  createLocalFactory,
  editFactory,
  type Edit,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import { buildingDefinitions, itemID } from "./catalog";
import { store } from "./inventory";
import { applyRobotAction, chargeRobots, type RobotAction } from "./robots";
import { stepFreight } from "./robotFreight";
import {
  routeEditsSafe,
  plannedBuildings,
  worldFactories,
} from "./robotRoutes";
import { constructionValid } from "./construction";
import { syncIncidents } from "./incidents";
import { dispatchRobots } from "./robotAutonomy";
import { claimQuest, submitQuest, syncQuests } from "./quests";
import {
  ioUnlocked,
  ioCost,
  ioLimit,
  pickupType,
  intakeType,
  isWarehouseTerminal,
} from "./warehouseIO";
import { catalog } from "./catalog";
import { newMachine } from "./machine";
import { orderRewardClaimed } from "./progression";

export type WorldAction =
  | RobotAction
  | { type: "developer_settings"; warehouse_orders_always_available: boolean }
  | { type: "claim_quest"; id: string }
  | { type: "submit_quest"; id: string }
  | {
      type: "upgrade_io";
      id: string;
      terminal: "warehouse_pickup" | "warehouse_intake";
    }
  | { type: "select_district"; id: string }
  | { type: "expand_district"; name: string }
  | { type: "rename_district"; id: string; name: string };
export type DistrictSummary = {
  id: string;
  name: string;
  buildings: number;
  tick: number;
  headquarters: boolean;
  warehouse_id?: string;
  pickup_terminals?: number;
  intake_terminals?: number;
};
export const districtLimit = (stage: number) =>
  [6, 12, 24, 40, 70, 100][stage - 1];
export const expansionCost = () => ({
  [itemID("基础铁板")]: -20,
  [itemID("简易支架")]: -10,
});
export const allDistricts = (root: LocalFactory) => [
  root,
  ...(root.districts ?? []),
];
export const districtSummary = (root: LocalFactory): DistrictSummary[] =>
  allDistricts(root).map((f) => ({
    id: f.id,
    name: f.name,
    buildings: f.buildings.length,
    tick: f.simulation.tick,
    headquarters: f.id === root.id,
    warehouse_id: f.buildings.find((b) => b.building_type === "bus")?.id,
    pickup_terminals: f.buildings.filter((b) => b.building_type === pickupType)
      .length,
    intake_terminals: f.buildings.filter((b) => b.building_type === intakeType)
      .length,
  }));
export function projectFactory(root: LocalFactory): LocalFactory {
  const f =
    allDistricts(root).find((f) => f.id === root.active_district_id) ?? root;
  // World-only fields are never copied into a viewport or editor response.
  const { districts: _districts, active_district_id: _active, ...view } = f;
  void _districts;
  void _active;
  return {
    ...view,
    revision: root.revision,
    simulation: {
      ...f.simulation,
      warehouse: root.simulation.warehouse,
      industry: root.simulation.industry,
    },
    robots: root.robots,
  };
}
export function initializeWorld(root: LocalFactory): LocalFactory {
  if (root.districts) return root;
  const user = { id: root.owner_id } as User;
  const districts = Array.from({ length: 5 }, (_, index) => {
    const f = createLocalFactory(user, `未命名工厂 ${index + 2}`);
    f.simulation.tick = root.simulation.tick;
    delete f.simulation.industry;
    return f;
  });
  return { ...root, districts, active_district_id: root.id };
}
export const createWorld = (user: User, name: string) =>
  initializeWorld(createLocalFactory(user, name));
export function stepWorld(current: LocalFactory): LocalFactory {
  current = initializeWorld(current);
  const root = step(current);
  const districts: LocalFactory[] = [];
  for (const child of current.districts ?? []) {
    const bus = child.buildings[0],
      m = bus && child.simulation.buildings[bus.id];
    if (
      child.buildings.length === 1 &&
      bus.building_type === "bus" &&
      bus.configuration.enabled !== false &&
      m &&
      m.status === "warehouse" &&
      !child.simulation.transfers?.length &&
      child.simulation.networks?.length === 0 &&
      m.powered === false &&
      m.supplied_kw === 0 &&
      m.generated_kw === 0 &&
      m.power_demand_kw === 0 &&
      m.network_id === undefined &&
      Object.keys(m).every((k) =>
        [
          "input",
          "output",
          "progress",
          "duration",
          "cooldown",
          "status",
          "powered",
          "supplied_kw",
          "generated_kw",
          "network_id",
          "power_demand_kw",
        ].includes(k),
      ) &&
      !m.input.length &&
      !m.output.length &&
      !m.progress &&
      !m.cooldown
    ) {
      if (child.revision >= Number.MAX_SAFE_INTEGER)
        throw new Error("存档版本已达到上限");
      districts.push({
        ...child,
        revision: child.revision + 1,
        simulation: {
          ...child.simulation,
          tick: root.simulation.tick,
        },
      });
      continue;
    }
    // Share only this owned next world's ledger while stepping a district.
    // Persist no district copy, so snapshots cannot duplicate total stock.
    const next = step(
      {
        ...child,
        robots: root.robots,
        simulation: { ...child.simulation, industry: root.simulation.industry },
      },
      false,
      root.simulation.warehouse,
    );
    root.simulation.industry = next.simulation.industry;
    delete next.simulation.industry;
    delete next.robots;
    next.simulation.warehouse = {};
    districts.push(next);
  }
  root.districts = districts;
  chargeRobots(root);
  syncIncidents(root);
  dispatchRobots(root);
  stepFreight(root);
  syncQuests(root);
  return root;
}
export function editWorld(
  current: LocalFactory,
  edit: Edit,
  target?: string,
): LocalFactory {
  const id = target ?? current.active_district_id ?? current.id;
  if (id !== (current.active_district_id ?? current.id))
    throw new Error("厂区已切换，请重新操作");
  const shape =
    edit.kind === "place" || edit.kind === "move"
      ? {
          ...edit.placement,
          size:
            edit.kind === "move"
              ? (worldFactories(current)
                  .find((f) => f.id === id)
                  ?.buildings.find((b) => b.id === edit.id)?.size ?? 1)
              : edit.placement.size,
        }
      : undefined;
  if (shape && plannedBuildings(current, id).some((b) => overlaps(b, shape)))
    throw new Error("该格已预留施工蓝图，请先取消施工");
  if (
    shape &&
    current.robots?.some(
      (r) =>
        (!r.transit && r.factory_id === id && containsCell(shape, r)) ||
        (r.transit?.to_factory_id === id && containsCell(shape, r.transit)),
    )
  )
    throw new Error("该格有机器人停靠，请先召回或移走机器人");
  if (
    (edit.kind === "delete" || edit.kind === "move") &&
    current.robots?.some(
      (r) => r.home_factory_id === id && r.home_station === edit.id,
    )
  )
    throw new Error("该补能站仍绑定机器人，请先召回后再移动或拆除");
  const verify = (next: LocalFactory) => {
    if ((next.robots ?? []).some((r) => !constructionValid(next, r)))
      throw new Error("该编辑与在建蓝图的位置、数量或解锁限制冲突");
    if (
      (edit.kind === "place" || edit.kind === "move") &&
      !routeEditsSafe(current, next)
    )
      throw new Error("该建造会堵住机器人返站通路或超出其剩余能量范围");
    return next;
  };
  if (id === current.id) return verify(editFactory(current, edit));
  const index = current.districts?.findIndex((f) => f.id === id) ?? -1;
  if (index < 0) throw new Error("厂区不存在");
  if (
    edit.kind === "industry" &&
    ["scavenge", "workshop", "order_workshop", "cancel_workshop"].includes(
      edit.action.type,
    )
  )
    return verify(editFactory(current, edit));
  if (
    edit.kind === "place" &&
    buildingDefinitions.get(edit.building_type)?.role === "source"
  )
    throw new Error("垃圾提取口只允许建在起始回收场");
  const child = current.districts![index];
  const next = editFactory(
    {
      ...child,
      simulation: {
        ...child.simulation,
        warehouse: current.simulation.warehouse,
        industry: current.simulation.industry,
      },
    },
    edit,
  );
  const root = {
    ...current,
    revision: current.revision + 1,
    simulation: {
      ...current.simulation,
      warehouse: next.simulation.warehouse,
      industry: next.simulation.industry,
    },
    districts: [...current.districts!],
  };
  if (!Number.isSafeInteger(root.revision))
    throw new Error("存档版本已达到上限");
  delete next.simulation.industry;
  next.simulation.warehouse = {};
  root.districts[index] = next;
  return verify(root);
}
export function actWorld(
  current: LocalFactory,
  action: WorldAction,
): LocalFactory {
  const root = structuredClone(initializeWorld(current));
  if (!Number.isSafeInteger(root.revision + 1))
    throw new Error("存档版本已达到上限");
  if (action.type === "developer_settings") {
    if (typeof action.warehouse_orders_always_available !== "boolean")
      throw new Error("开发者开关值无效");
    const p = root.simulation.industry!;
    if (
      !action.warehouse_orders_always_available &&
      p.workshop?.order &&
      !orderRewardClaimed(p)
    )
      throw new Error("请先完成或取消当前机械手订单，再关闭开发者下单开关");
    p.developer = {
      warehouse_orders_always_available:
        action.warehouse_orders_always_available,
    };
    root.revision++;
    return root;
  }
  if (action.type === "claim_quest" || action.type === "submit_quest") {
    if (action.type === "claim_quest") claimQuest(root, action.id);
    else submitQuest(root, action.id);
    root.revision++;
    return root;
  }
  if (action.type === "upgrade_io") {
    const f = allDistricts(root).find((f) => f.id === action.id);
    if (!f || !isWarehouseTerminal(action.terminal))
      throw new Error("厂区或终端类型无效");
    if (!ioUnlocked(root.simulation))
      throw new Error("请先领取「舱门过于拥挤」任务奖励");
    const stage = root.simulation.industry!.stage;
    if (
      f.buildings.filter((b) => b.building_type === action.terminal).length >=
      ioLimit(stage, action.terminal)
    )
      throw new Error("当前阶段该类终端已达上限");
    // Deterministic search near WH, excluding complete footprints, robots,
    // landing reservations and construction. Also preserve safe return routes.
    const cells = Array.from({ length: 441 }, (_, i) => ({
      x: (i % 21) - 10,
      y: 10 - Math.floor(i / 21),
    })).sort(
      (a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y),
    );
    const id = crypto.randomUUID();
    const p = cells.find((p) => {
      if (
        f.buildings.some((b) => containsCell(b, p)) ||
        plannedBuildings(root, f.id).some((b) => containsCell(b, p)) ||
        root.robots?.some(
          (r) =>
            (!r.transit &&
              r.factory_id === f.id &&
              r.x === p.x &&
              r.y === p.y) ||
            (r.transit?.to_factory_id === f.id &&
              r.transit.x === p.x &&
              r.transit.y === p.y),
        )
      )
        return false;
      const candidate = {
        id,
        factory_id: f.id,
        building_type: action.terminal,
        ...p,
        rotation: 0 as const,
        configuration: {},
      };
      const before = f.buildings;
      f.buildings = [...before, candidate];
      const safe = routeEditsSafe(current, root);
      f.buildings = before;
      return safe;
    });
    if (!p)
      throw new Error(
        "没有可安装终端的空闲格子，请腾出一格并保留机器人返站通路",
      );
    store(root.simulation.warehouse, ioCost(stage, action.terminal));
    f.buildings = [
      ...f.buildings,
      {
        id,
        factory_id: f.id,
        building_type: action.terminal,
        ...p,
        rotation: 0,
        configuration:
          action.terminal === pickupType
            ? { output_items: [catalog.root_item!], enabled: false }
            : {},
      },
    ];
    f.simulation.buildings[id] = newMachine();
    root.revision++;
    return root;
  }
  if (
    action.type === "robot_deploy" ||
    action.type === "robot_recall" ||
    action.type === "robot_config" ||
    action.type === "robot_task" ||
    action.type === "robot_return" ||
    action.type === "robot_service" ||
    action.type === "robot_camera" ||
    action.type === "robot_autonomy" ||
    action.type === "robot_construct"
  ) {
    applyRobotAction(root, action);
    root.revision++;
    return root;
  }
  if (action.type === "select_district") {
    if (!allDistricts(root).some((f) => f.id === action.id))
      throw new Error("厂区不存在");
    root.active_district_id = action.id;
  } else {
    const name = action.name.trim();
    if (!name || [...name].length > 32 || /\p{Cc}/u.test(name))
      throw new Error("厂区名称需为 1～32 个字符，不能包含控制字符");
    if (action.type === "rename_district") {
      const f = allDistricts(root).find((f) => f.id === action.id);
      if (!f) throw new Error("厂区不存在");
      f.name = name;
    } else {
      if (
        allDistricts(root).length >=
        districtLimit(root.simulation.industry!.stage)
      )
        throw new Error("当前阶段的厂区数量已达上限");
      store(root.simulation.warehouse, expansionCost());
      const child = createLocalFactory({ id: root.owner_id } as User, name);
      child.simulation.tick = root.simulation.tick;
      delete child.simulation.industry;
      (root.districts ??= []).push(child);
      root.active_district_id = child.id;
    }
  }
  syncQuests(root);
  root.revision++;
  return root;
}
