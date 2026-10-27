import { SIMULATION_TPS, STEP_SECONDS, isStepValue } from "./simulationTime";
import { upgradeClock } from "./clockUpgrade";
import { footprintCells, inBounds, overlaps, validSize } from "../footprint";
import type {
  BuildingInstance,
  BuildingPlacement,
  FactoryDetail,
  Simulation,
  User,
} from "../../api/client";
import type { components } from "../../api/schema";
import { catalog, buildingDefinitions, recipeDefinitions } from "./catalog";
import {
  applyIndustry,
  initialIndustry,
  type IndustryAction,
} from "./industry";
import { store } from "./inventory";
import { fuelValues } from "./fuel";
import {
  beltCapacity,
  beltTicks,
  isBelt,
  isFluid,
  itemID,
  isFluidNode,
} from "./catalog";
import { acceptsFluid } from "./fluidConfig";
import { validTransportConfig } from "./transportConfig";
import { validRobotWorld } from "./robots";
import { validWorkReceipts } from "./workLedger";
import { validIncident } from "./incidents";
import { newMachine } from "./machine";
import { validatePlacement } from "./placement";
import {
  undergroundType,
  isUnderground,
  isUndergroundEntry,
  undergroundPeer,
  undergroundSpan,
  undergroundMoveIssue,
  validUndergroundPairs,
} from "./underground";
import { validDiscoveries, restoreDiscoveries } from "./discovery";
import { validWorkshopCounts, workshopMachineAvailable } from "./workshop";
import { restoreQuestProgress, syncQuests, validQuestProgress } from "./quests";
import { expectedStage } from "./progression";
import { validWorkshopOrder } from "./orders";
import {
  ioLimit,
  ioUnlocked,
  pickupType,
  intakeType,
  isWarehouseTerminal,
} from "./warehouseIO";
export { newMachine } from "./machine";

export { catalog } from "./catalog";
export type LocalFactory = Omit<
  FactoryDetail,
  "districts" | "active_district_id"
> & {
  revision: number;
  simulation: Simulation;
  districts?: LocalFactory[];
  active_district_id?: string;
};
export type GameSave = components["schemas"]["GameSave"];
export type CloudSave = components["schemas"]["CloudSave"];
export { direction, isPort } from "./catalog";
export function createLocalFactory(user: User, name: string): LocalFactory {
  name = name.trim();
  if (!name || [...name].length > 32 || /\p{Cc}/u.test(name))
    throw new Error("工厂名称需为 1～32 个字符，不能包含控制字符");
  const id = crypto.randomUUID();
  const bus: BuildingInstance = {
    id: crypto.randomUUID(),
    factory_id: id,
    building_type: "bus",
    x: 0,
    y: 0,
    rotation: 0,
    configuration: {},
  };
  return {
    id,
    owner_id: user.id,
    name,
    width: 21,
    height: 21,
    created_at: new Date().toISOString(),
    revision: 0,
    buildings: [bus],
    simulation: {
      tick: 0,
      tick_rate: SIMULATION_TPS,
      buildings: { [bus.id]: newMachine() },
      warehouse: {},
      transfers: [],
      industry: initialIndustry(),
    },
  };
}
export const toSave = (factory: LocalFactory): GameSave => ({
  format_version: 1,
  rules_version: 3,
  factory,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= max;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const rotations = [0, 90, 180, 270];

// Treat IndexedDB and downloaded JSON as untrusted structures, while accepting
// player-chosen quantities within the format. Invalid saves are never reset.
export function validateSave(
  value: unknown,
  owner: string,
  context: { source?: string; path?: string } = {},
): LocalFactory {
  const root = context.path ?? "factory";
  const fail = (
    path: string,
    reason: string,
    details?: Record<string, unknown>,
  ): never => {
    // Log only the failed rule and bounded transport diagnostics, never the
    // complete save, account or credentials. Internal callers stay quiet.
    if (context.source)
      console.error(
        `[BakaFactory] 存档校验失败 ${JSON.stringify({ source: context.source, path, reason, ...(details ? { details } : {}) })}`,
        {
          source: context.source,
          path,
          reason,
          ...(details ? { details } : {}),
        },
      );
    throw new Error("存档损坏或版本不兼容；原存档已保留，请勿清除网站数据");
  };
  if (!object(value)) return fail("$", "存档必须是对象");
  if (value.format_version !== 1)
    return fail("format_version", "仅支持格式版本 1");
  if (![1, 2, 3].includes(value.rules_version as number))
    return fail("rules_version", "仅支持规则版本 1 / 2 / 3");
  if (!object(value.factory)) return fail(root, "缺少有效工厂对象");
  if (
    object(value.factory.simulation) &&
    value.factory.simulation.tick_rate === 1
  ) {
    let upgraded: LocalFactory;
    try {
      upgraded = upgradeClock(value.factory as unknown as LocalFactory);
    } catch {
      return fail(root, "旧时钟存档结构无效");
    }
    return validateSave(
      {
        ...value,
        factory: upgraded,
      },
      owner,
      context,
    );
  }
  const f = value.factory;
  const sharedWarehouse = value.rules_version === 3;
  if (
    !identifier(f.id) ||
    f.owner_id !== owner ||
    typeof f.name !== "string" ||
    !f.name.trim() ||
    [...f.name].length > 32 ||
    /\p{Cc}/u.test(f.name) ||
    f.width !== 21 ||
    f.height !== 21 ||
    !integer(f.revision) ||
    typeof f.created_at !== "string" ||
    !Array.isArray(f.buildings) ||
    f.buildings.length < 1 ||
    f.buildings.length > 441 ||
    !object(f.simulation)
  )
    return fail(
      root,
      "工厂标识 / 账号归属 / 名称 / 尺寸 / revision / 建筑列表无效",
    );
  const sim = f.simulation;
  if (!integer(sim.tick))
    return fail(`${root}.simulation.tick`, "tick 必须为非负安全整数");
  if (sim.tick_rate !== SIMULATION_TPS)
    return fail(
      `${root}.simulation.tick_rate`,
      "存档 tick_rate 必须为 2，开发者倍速不应写入存档",
    );
  if (!object(sim.buildings))
    return fail(`${root}.simulation.buildings`, "机器状态必须为对象");
  if (!object(sim.warehouse))
    return fail(`${root}.simulation.warehouse`, "仓库必须为对象");
  if (
    !Array.isArray(sim.transfers) ||
    sim.transfers.length > 3 * f.buildings.length
  )
    return fail(
      `${root}.simulation.transfers`,
      "收据必须为数组且数量不超过建筑数的 3 倍",
    );
  const items = new Set(catalog.items.map((i) => i.id));
  const types = new Set(catalog.buildings.map((b) => b.id));
  const ids = new Set<string>(),
    cells = new Set<string>(),
    payloads = new Set<string>();
  let buses = 0;
  for (const [buildingIndex, b] of f.buildings.entries()) {
    const buildingPath = `${root}.buildings[${buildingIndex}]`;
    if (
      !object(b) ||
      !identifier(b.id) ||
      ids.has(b.id) ||
      b.factory_id !== f.id ||
      typeof b.building_type !== "string" ||
      !types.has(b.building_type) ||
      !Number.isInteger(b.x) ||
      Math.abs(b.x as number) > 10 ||
      !Number.isInteger(b.y) ||
      Math.abs(b.y as number) > 10 ||
      !rotations.includes(b.rotation as number) ||
      !object(b.configuration)
    )
      return fail(
        buildingPath,
        "建筑标识 / 归属 / 类型 / 坐标 / 方向 / 配置无效或 ID 重复",
      );
    const shape = b as unknown as BuildingInstance;
    if (
      !validSize(buildingDefinitions.get(shape.building_type)!, b.size) ||
      !inBounds(shape)
    )
      return fail(`${buildingPath}.size`, "占地尺寸不受支持或建筑越界");
    for (const p of footprintCells(shape)) {
      const cell = `${p.x},${p.y}`;
      if (cells.has(cell)) return fail(buildingPath, "建筑占格重叠");
      cells.add(cell);
    }
    ids.add(b.id);
    if (b.building_type === "bus") {
      buses++;
      if (b.rotation !== 0)
        return fail(buildingPath, "WH 方向必须固定为 0");
    }
    const m = sim.buildings[b.id];
    const machinePath = `${root}.simulation.buildings[${b.id}]`;
    if (!object(m)) return fail(machinePath, "缺少机器状态对象");
    for (const [field, max] of [
      ["progress", 100000],
      ["duration", 100000],
      ["cooldown", 60],
    ] as const)
      if (!isStepValue(m[field], max))
        return fail(
          `${machinePath}.${field}`,
          `必须为 0～${max} 且符合字段精度的数值`,
        );
    if (typeof m.status !== "string")
      return fail(`${machinePath}.status`, "状态必须为字符串");
    const definition = buildingDefinitions.get(b.building_type)!;
    if (
      m.terminal_cursor !== undefined &&
      (b.building_type !== pickupType || !integer(m.terminal_cursor, 1))
    )
      return fail(`${machinePath}.terminal_cursor`, "取货终端轮询游标无效");
    if (
      isWarehouseTerminal(b.building_type) &&
      ((Array.isArray(m.input) && m.input.length) ||
        (Array.isArray(m.output) && m.output.length) ||
        m.belt !== undefined ||
        m.fluid !== undefined ||
        (Array.isArray(m.fuel) && m.fuel.length))
    )
      return fail(machinePath, "仓库终端不能保存独立库存或载荷");
    if (
      (m.batches_completed !== undefined && !integer(m.batches_completed)) ||
      !validIncident(m.incident, sim.tick as number)
    )
      return fail(machinePath, "累计批次或 incident 异常记录无效");
    for (const [field, max] of [
      ["work_energy_kj", 1000],
      ["station_energy_kj", definition.station_capacity_kj ?? 0],
      ["generated_kw", 1000],
      ["power_demand_kw", 1000],
      ["charge_kj", definition.capacity_kj ?? 0],
      ["charge_remainder", 99],
      ["medium", 10],
      ["flow_in", 80],
      ["flow_out", 80],
      ["fluid_cursor", 29],
    ] as const) {
      if (
        m[field] !== undefined &&
        !(field === "work_energy_kj" ||
        field === "station_energy_kj" ||
        field === "charge_kj"
          ? isStepValue(m[field], max)
          : integer(m[field], max))
      )
        return fail(
          `${machinePath}.${field}`,
          `必须为 0～${max} 且符合字段精度的数值`,
        );
    }
    if (
      (m.powered !== undefined && typeof m.powered !== "boolean") ||
      (m.network_id !== undefined &&
        (typeof m.network_id !== "string" || m.network_id.length > 160)) ||
      ((m.medium as number) > 0 && b.building_type !== "m21") ||
      ((m.charge_remainder as number) > 0 && definition.role !== "battery")
    )
      return fail(
        machinePath,
        "供能状态 / 网络标识 / 启动介质 / 电池余数与设备不符",
      );
    if (
      !validTransportConfig(b as unknown as BuildingInstance) ||
      (m.supplied_kw !== undefined && !integer(m.supplied_kw, 1000))
    )
      return fail(
        `${buildingPath}.configuration`,
        "物流 / 流体 / 能源配置无效，或 supplied_kw 超限",
      );
    const validFuels = fuelValues(definition);
    if ((m.fluid_cursor as number) > 0 && definition.role !== "valve")
      return fail(`${machinePath}.fluid_cursor`, "非阀门设备不能持有分流游标");
    if (m.fluid !== undefined) {
      const fluid = m.fluid;
      if (
        !isFluidNode(b.building_type) ||
        !object(fluid) ||
        typeof fluid.item !== "string" ||
        !acceptsFluid(b.building_type, fluid.item) ||
        !integer(fluid.count, definition.fluid_capacity) ||
        fluid.count === 0
      )
        return fail(`${machinePath}.fluid`, "流体类型 / 容量 / 过滤与容器不符");
    }
    if ((m.energy_kj as number) > 0 && !Object.keys(validFuels).length)
      return fail(`${machinePath}.energy_kj`, "非燃料设备不能持有炉体余热");
    if (m.energy_kj !== undefined && !isStepValue(m.energy_kj, 16000))
      return fail(
        `${machinePath}.energy_kj`,
        "炉体余热必须为 0～16000 且为 0.5 kJ 的整数倍",
      );
    if (m.fuel !== undefined && !Array.isArray(m.fuel))
      return fail(`${machinePath}.fuel`, "燃料缓存必须是数组");
    for (const [field, inv, slots] of [
      ["input", m.input, definition.input_slots],
      ["output", m.output, definition.output_slots],
      ["fuel", m.fuel ?? [], 3],
    ] as const) {
      if (!Array.isArray(inv) || inv.length > (slots ?? 4))
        return fail(
          `${machinePath}.${field}`,
          `缓存必须是数组且最多 ${slots ?? 4} 格`,
        );
      const seen = new Set<string>();
      for (const [stackIndex, stack] of inv.entries()) {
        if (
          !object(stack) ||
          typeof stack.item !== "string" ||
          !items.has(stack.item) ||
          seen.has(stack.item) ||
          !integer(stack.count, 100) ||
          stack.count === 0
        )
          return fail(
            `${machinePath}.${field}[${stackIndex}]`,
            "物品栈必须为已知、不重复的物品，数量为 1～100 的安全整数",
            object(stack)
              ? {
                  item_type: typeof stack.item,
                  item: typeof stack.item === "string" ? stack.item : null,
                  count:
                    typeof stack.count === "number"
                      ? stack.count
                      : typeof stack.count,
                }
              : undefined,
          );
        seen.add(stack.item);
        if (inv === m.fuel && !validFuels[stack.item])
          return fail(`${machinePath}.fuel`, "该设备不接受此燃料");
      }
    }
    if (b.configuration.recipe_id !== undefined) {
      const r =
        typeof b.configuration.recipe_id === "string" &&
        recipeDefinitions.get(b.configuration.recipe_id);
      if (!r || r.building_type !== b.building_type)
        return fail(
          `${buildingPath}.configuration.recipe_id`,
          "配方不存在或不属于此设备",
        );
    }
    if (m.belt !== undefined) {
      const belt = m.belt;
      const beltPath = `${machinePath}.belt`;
      if (!isBelt(b.building_type) || !object(belt))
        return fail(beltPath, "载荷必须属于传送带且为对象");
      const details = {
        building_type: b.building_type,
        id: typeof belt.id === "string" ? belt.id.slice(0, 128) : null,
        item: typeof belt.item === "string" ? belt.item.slice(0, 128) : null,
        count:
          belt.count === undefined
            ? 1
            : typeof belt.count === "number"
              ? belt.count
              : typeof belt.count,
        capacity: beltCapacity(b.building_type),
        progress:
          typeof belt.progress === "number"
            ? belt.progress
            : typeof belt.progress,
        max_progress: beltTicks(b.building_type),
        item_type: typeof belt.item,
      };
      if (!identifier(belt.id))
        return fail(`${beltPath}.id`, "载荷标识必须为 1～128 字符", details);
      if (payloads.has(belt.id))
        return fail(`${beltPath}.id`, "同厂传送带载荷标识重复", details);
      if (
        typeof belt.item !== "string" ||
        !items.has(belt.item) ||
        isFluid(belt.item)
      )
        return fail(`${beltPath}.item`, "载荷必须为已知固体物品", details);
      if (!integer(belt.progress, beltTicks(b.building_type)))
        return fail(`${beltPath}.progress`, "载荷进度超出带定义", details);
      if (
        belt.count !== undefined &&
        (!integer(belt.count, beltCapacity(b.building_type)) ||
          belt.count === 0)
      )
        return fail(`${beltPath}.count`, "载荷数量超出带容量", details);
      payloads.add(belt.id);
    }
  }
  if (buses !== 1 || Object.keys(sim.buildings).length !== ids.size)
    return fail(
      `${root}.simulation.buildings`,
      "必须恰有一个 WH，且机器状态与布局逐项对应",
    );
  if (sim.networks !== undefined) {
    if (!Array.isArray(sim.networks) || sim.networks.length > 3 * ids.size)
      return fail(`${root}.simulation.networks`, "网络列表类型或数量无效");
    for (const [networkIndex, n] of sim.networks.entries()) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        !n.id ||
        n.id.length > 160 ||
        !["shaft", "hydraulic", "electric"].includes(n.kind as string)
      )
        return fail(
          `${root}.simulation.networks[${networkIndex}]`,
          "网络标识或能源类型无效",
        );
      for (const field of [
        "producers",
        "consumers",
        "capacity_kw",
        "demand_kw",
        "supplied_kw",
        "loss_kw",
        "charge_kw",
        "discharge_kw",
        "stored_kj",
      ])
        if (
          !(field === "stored_kj" ? isStepValue : integer)(
            n[field],
            field === "producers" || field === "consumers"
              ? ids.size
              : 1000000000,
          )
        )
          return fail(
            `${root}.simulation.networks[${networkIndex}].${field}`,
            "网络统计不是安全整数或超过上限",
          );
    }
  }
  for (const [item, count] of Object.entries(sim.warehouse)) {
    if (!items.has(item) || !integer(count))
      return fail(
        `${root}.simulation.warehouse`,
        "仓库包含未知物品或非法数量",
        {
          item: item.slice(0, 128),
          count: typeof count === "number" ? String(count) : typeof count,
        },
      );
  }
  const p = sim.industry;
  const needsDiscovery = !object(p) || p.discovered_items === undefined;
  if (p !== undefined) {
    if (
      !object(p) ||
      !integer(p.stage, 6) ||
      p.stage < 1 ||
      !Array.isArray(p.milestones) ||
      p.milestones.length > 6 ||
      new Set(p.milestones).size !== p.milestones.length ||
      !object(p.crafted)
    )
      return fail(
        `${root}.simulation.industry`,
        "阶段 / 里程碑 / 累计制造记录的结构或范围无效",
      );
    for (const id of p.milestones)
      if (!catalog.stages?.some((s) => s.milestone_item === id))
        return fail(`${root}.simulation.industry.milestones`, "包含未知里程碑");
    for (const [id, n] of Object.entries(p.crafted))
      if (!items.has(id) || !integer(n))
        return fail(
          `${root}.simulation.industry.crafted`,
          "累计制造含未知物品或非法数量",
        );
    if (!validWorkReceipts(p.work_receipts, sim.tick as number))
      return fail(
        `${root}.simulation.industry.work_receipts`,
        "作业凭据类型 / 数量 / 时间无效",
      );
    if (!validDiscoveries(p.discovered_items))
      return fail(
        `${root}.simulation.industry.discovered_items`,
        "获得记录含未知 / 重复物品或结构无效",
      );
    if (!validQuestProgress(p.quests))
      return fail(
        `${root}.simulation.industry.quests`,
        "任务记录的类型 / ID / 计数 / 版本无效",
      );
    if (
      p.developer !== undefined &&
      (!object(p.developer) ||
        Object.keys(p.developer).some(
          (key) => key !== "warehouse_orders_always_available",
        ) ||
        typeof p.developer.warehouse_orders_always_available !== "boolean")
    )
      return fail(
        `${root}.simulation.industry.developer`,
        "开发者设置字段或类型无效",
      );
    if (
      p.stage !==
      expectedStage(
        p as unknown as NonNullable<Simulation["industry"]>,
        !object(p.quests) || p.quests.stage_quests_version === undefined,
      )
    )
      return fail(
        `${root}.simulation.industry.stage`,
        "阶段与终局领奖 / 历史里程碑不一致",
      );
    if (p.workshop !== undefined) {
      if (!object(p.workshop) || !validWorkshopCounts(p.workshop))
        return fail(
          `${root}.simulation.industry.workshop`,
          "手工队列结构或批数范围无效",
        );
      const unknown = Object.keys(p.workshop).find(
        (key) =>
          !["recipe_id", "progress", "remaining", "total", "order"].includes(
            key,
          ),
      );
      if (unknown !== undefined)
        return fail(
          `${root}.simulation.industry.workshop.${unknown.slice(0, 80)}`,
          "手工队列包含不支持的字段",
        );
      if (
        p.workshop.order !== undefined &&
        !validWorkshopOrder(
          p.workshop.order,
          p as unknown as NonNullable<Simulation["industry"]>,
        )
      )
        return fail(
          `${root}.simulation.industry.workshop.order`,
          "机械手订单结构 / 权限 / 工序 / 预留材料或交付数量校验失败",
        );
      const r =
        typeof p.workshop.recipe_id === "string" &&
        recipeDefinitions.get(p.workshop.recipe_id);
      if (
        !r ||
        !workshopMachineAvailable(p.crafted, r.building_type) ||
        (r.tier ?? 1) > p.stage ||
        // Keep the original duration as the legacy save envelope. A retained
        // progress beyond the manual duration settles only one batch next tick.
        !isStepValue(
          p.workshop.progress,
          Math.max(1, r.duration_ms / 1000) - STEP_SECONDS,
        )
      )
        return fail(
          `${root}.simulation.industry.workshop`,
          "队列配方 / 阶段 / 工作室权限或进度无效",
        );
    }
  } else if ((value.rules_version as number) >= 2)
    return fail(
      `${root}.simulation.industry`,
      "规则版本 2 / 3 必须包含行业状态",
    );
  // Transfer receipts are transient visuals, not persistent gameplay inputs.
  const factory = structuredClone(f) as LocalFactory;
  factory.simulation.transfers = [];
  factory.simulation.industry ??= initialIndustry();
  restoreQuestProgress(factory);
  if (
    !validUndergroundPairs(factory.buildings) ||
    factory.buildings.some(
      (b) =>
        isUnderground(b) &&
        (factory.simulation.industry!.stage < 2 ||
          factory.simulation.buildings[b.id].input.length > 0 ||
          factory.simulation.buildings[b.id].output.length > 0 ||
          (isUndergroundEntry(b) && factory.simulation.buildings[b.id].belt)),
    )
  )
    return fail(
      `${root}.buildings`,
      "地下端口必须是本厂同向 1～8 格的完整配对，入口不能持有载荷",
    );
  for (const type of [pickupType, intakeType]) {
    const count = factory.buildings.filter(
      (b) => b.building_type === type,
    ).length;
    if (
      count > ioLimit(factory.simulation.industry!.stage, type) ||
      (count > 0 && !ioUnlocked(factory.simulation))
    )
      return fail(
        `${root}.buildings`,
        "仓库终端超过阶段上限或任务奖励尚未领取",
      );
  }
  const sources = factory.buildings.filter(
    (b) => buildingDefinitions.get(b.building_type)?.role === "source",
  );
  if (sources.some((b) => b.y !== 10))
    return fail(`${root}.buildings`, "垃圾提取口必须位于地图顶部垃圾堆");
  if (f.districts !== undefined) {
    if (!Array.isArray(f.districts) || f.districts.length > 99)
      return fail(`${root}.districts`, "分厂必须是数组且最多 99 项");
    const districtIDs = new Set([factory.id]);
    factory.districts = f.districts.map((value, index) => {
      const childPath = `${root}.districts[${index}]`;
      if (
        !object(value) ||
        value.districts !== undefined ||
        value.active_district_id !== undefined ||
        value.robots !== undefined ||
        !object(value.simulation) ||
        (sharedWarehouse &&
          (!object(value.simulation.warehouse) ||
            Object.keys(value.simulation.warehouse).length > 0)) ||
        value.simulation.industry !== undefined ||
        value.simulation.tick !== sim.tick ||
        value.simulation.tick_rate !== sim.tick_rate
      )
        return fail(
          childPath,
          "分厂包含不允许的世界字段、非空独立仓库、行业状态或不同步 tick",
        );
      const child = validateSave(
        {
          format_version: 1,
          rules_version: 2,
          factory: {
            ...value,
            simulation: {
              ...value.simulation,
              industry: factory.simulation.industry,
            },
          },
        },
        owner,
        { ...context, path: childPath },
      );
      if (districtIDs.has(child.id)) return fail(childPath, "分厂 ID 重复");
      districtIDs.add(child.id);
      delete child.simulation.industry;
      return child;
    });
    const limit = [6, 12, 24, 40, 70, 100][
      factory.simulation.industry.stage - 1
    ];
    // A legacy single factory remains valid; new games start with six.
    if (
      factory.districts.length + 1 > limit ||
      typeof f.active_district_id !== "string" ||
      !districtIDs.has(f.active_district_id)
    )
      return fail(
        `${root}.active_district_id`,
        "厂区数超过阶段上限或当前厂区不存在",
      );
    factory.active_district_id = f.active_district_id;
  } else if (f.active_district_id !== undefined)
    return fail(
      `${root}.active_district_id`,
      "没有分厂列表时不允许设置当前分厂",
    );
  if (!sharedWarehouse) {
    // Upgrade only a cloned, completely validated world. Persist one ledger,
    // never a copy per district; another load of rules v3 cannot merge again.
    for (const child of factory.districts ?? []) {
      try {
        store(factory.simulation.warehouse, child.simulation.warehouse);
      } catch {
        return fail(
          `${root}.simulation.warehouse`,
          "旧分仓合并将溢出，原始库存保留",
        );
      }
      child.simulation.warehouse = {};
    }
  }
  if (!validRobotWorld(factory))
    return fail(
      `${root}.robots`,
      "机器人 / 站点 / 任务 / 路径 / 占格状态不符合规则",
    );
  if (needsDiscovery) restoreDiscoveries(factory);
  syncQuests(factory);
  return factory;
}

export type Edit =
  | {
      kind: "place_underground";
      id: string;
      exitID: string;
      entry: BuildingPlacement;
      exit: BuildingPlacement;
    }
  | {
      kind: "place";
      building_type: string;
      placement: BuildingPlacement;
      id: string;
    }
  | { kind: "move"; id: string; placement: BuildingPlacement }
  | { kind: "delete"; id: string }
  | { kind: "industry"; action: IndustryAction };

export function editFactory(current: LocalFactory, edit: Edit): LocalFactory {
  const f = structuredClone(current);
  if (f.revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("存档版本已达到上限");
  if (edit.kind === "industry") {
    applyIndustry(f, edit.action);
    syncQuests(f);
    f.revision++;
    return f;
  }
  if (edit.kind === "place_underground") {
    if (
      !edit.id ||
      !edit.exitID ||
      edit.id === edit.exitID ||
      edit.id.length > 128 ||
      edit.exitID.length > 128 ||
      !undergroundSpan(edit.entry, edit.exit)
    )
      throw new Error("出口必须在入口正前方 1～8 格");
    const d = validatePlacement(f, undergroundType, edit.id, edit.entry, true);
    validatePlacement(f, undergroundType, edit.exitID, edit.exit, true);
    store(f.simulation.warehouse, { [d.item!]: -1 });
    for (const [id, peer, role, p] of [
      [edit.id, edit.exitID, "entry", edit.entry],
      [edit.exitID, edit.id, "exit", edit.exit],
    ] as const) {
      f.buildings.push({
        id,
        factory_id: f.id,
        building_type: undergroundType,
        ...p,
        configuration: { underground_role: role, underground_peer: peer },
      });
      f.simulation.buildings[id] = newMachine();
    }
    f.revision++;
    return f;
  }
  if (edit.kind === "place" || edit.kind === "move") {
    const p = edit.placement;
    if (
      !Number.isInteger(p.x) ||
      !Number.isInteger(p.y) ||
      Math.abs(p.x) > 10 ||
      Math.abs(p.y) > 10 ||
      !rotations.includes(p.rotation)
    )
      throw new Error("建筑坐标或方向无效");
    if (
      f.buildings.some(
        (b) =>
          overlaps(b, {
            ...p,
            size:
              edit.kind === "move"
                ? (f.buildings.find((b) => b.id === edit.id)?.size ?? 1)
                : p.size,
          }) &&
          (edit.kind === "place" || b.id !== edit.id),
      )
    )
      throw new Error("目标格子已被占用");
  }
  if (edit.kind === "place") {
    const d = validatePlacement(f, edit.building_type, edit.id, edit.placement);
    if (d.item) store(f.simulation.warehouse, { [d.item]: -1 });
    f.buildings.push({
      id: edit.id,
      factory_id: f.id,
      building_type: d.id,
      ...edit.placement,
      configuration: {},
    });
    f.simulation.buildings[edit.id] = newMachine();
  } else {
    const b = f.buildings.find((b) => b.id === edit.id);
    if (!b) throw new Error("建筑不存在");
    if (
      edit.kind === "delete" &&
      ["bus", "warehouse_pickup", "warehouse_intake"].includes(b.building_type)
    )
      throw new Error("工厂仓库和仓库终端可以移动，但不能删除");
    if (b.building_type === "bus" && edit.kind === "move" && edit.placement.rotation !== 0)
      throw new Error("工厂仓库方向固定，不能旋转");
    if (b.building_type !== "bus" && buildingDefinitions.get(b.building_type)?.fixed)
      throw new Error("该固定设施不能移动、旋转或删除");
    if (edit.kind === "move") {
      if (
        buildingDefinitions.get(b.building_type)?.role === "source" &&
        edit.placement.y !== 10
      )
        throw new Error("垃圾提取口必须保持在地图顶部垃圾堆");
      const size = b.size ?? 1;
      if (
        (edit.placement.size !== undefined && edit.placement.size !== size) ||
        !inBounds({ ...edit.placement, size })
      )
        throw new Error("移动须保留尺寸且不得超出边界");
      const undergroundIssue = undergroundMoveIssue(
        b,
        edit.placement,
        f.buildings,
      );
      if (undergroundIssue) throw new Error(undergroundIssue);
      Object.assign(b, edit.placement);
    } else {
      if (isUnderground(b)) {
        const peer = undergroundPeer(b, f.buildings);
        if (!peer) throw new Error("地下端口配对不完整");
        for (const end of [b, peer]) {
          const load = f.simulation.buildings[end.id].belt;
          if (load)
            store(f.simulation.warehouse, { [load.item]: load.count ?? 1 });
          delete f.simulation.buildings[end.id];
        }
        store(f.simulation.warehouse, {
          [buildingDefinitions.get(undergroundType)!.item!]: 1,
        });
        const removed = new Set([b.id, peer.id]);
        f.buildings = f.buildings.filter((end) => !removed.has(end.id));
        f.simulation.transfers = (f.simulation.transfers ?? []).filter(
          (t) =>
            !removed.has(t.source.id) &&
            !removed.has(t.target.id) &&
            (!t.via || !removed.has(t.via.id)),
        );
        f.revision++;
        return f;
      }
      const m = f.simulation.buildings[b.id];
      const stacks = [
        ...m.input,
        ...m.output,
        ...(m.fuel ?? []),
        ...(m.fluid ? [m.fluid] : []),
        ...((m.medium ?? 0) > 0
          ? [{ item: itemID("液压工作液"), count: m.medium! }]
          : []),
        ...(m.belt ? [{ item: m.belt.item, count: m.belt.count ?? 1 }] : []),
      ];
      for (const stack of stacks) {
        const count = (f.simulation.warehouse[stack.item] ?? 0) + stack.count;
        if (!Number.isSafeInteger(count)) throw new Error("仓库数量超出上限");
        f.simulation.warehouse[stack.item] = count;
      }
      const definition = buildingDefinitions.get(b.building_type)!;
      if (definition.item)
        store(f.simulation.warehouse, { [definition.item]: 1 });
      f.buildings = f.buildings.filter((item) => item.id !== b.id);
      delete f.simulation.buildings[b.id];
    }
  }
  f.simulation.transfers = (f.simulation.transfers ?? []).filter(
    (t) =>
      t.source.id !== edit.id &&
      t.target.id !== edit.id &&
      t.via?.id !== edit.id,
  );
  f.revision++;
  return f;
}
