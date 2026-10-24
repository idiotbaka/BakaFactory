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
import { validDiscoveries, restoreDiscoveries } from "./discovery";
import { validWorkshopCounts, workshopMachineAvailable } from "./workshop";
import { restoreQuestProgress, syncQuests, validQuestProgress } from "./quests";
import { expectedStage } from "./progression";
import { validWorkshopOrder } from "./orders";
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
      tick_rate: 1,
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
export function validateSave(value: unknown, owner: string): LocalFactory {
  const fail = (): never => {
    throw new Error("存档损坏或版本不兼容；原存档已保留，请勿清除网站数据");
  };
  if (
    !object(value) ||
    value.format_version !== 1 ||
    ![1, 2, 3].includes(value.rules_version as number) ||
    !object(value.factory)
  )
    return fail();
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
    return fail();
  const sim = f.simulation;
  if (
    !integer(sim.tick) ||
    sim.tick_rate !== 1 ||
    !object(sim.buildings) ||
    !object(sim.warehouse) ||
    !Array.isArray(sim.transfers) ||
    sim.transfers.length > 3 * f.buildings.length
  )
    return fail();
  const items = new Set(catalog.items.map((i) => i.id));
  const types = new Set(catalog.buildings.map((b) => b.id));
  const ids = new Set<string>(),
    cells = new Set<string>(),
    payloads = new Set<string>();
  let buses = 0;
  for (const b of f.buildings) {
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
      return fail();
    const shape = b as unknown as BuildingInstance;
    if (
      !validSize(buildingDefinitions.get(shape.building_type)!, b.size) ||
      !inBounds(shape)
    )
      return fail();
    for (const p of footprintCells(shape)) {
      const cell = `${p.x},${p.y}`;
      if (cells.has(cell)) return fail();
      cells.add(cell);
    }
    ids.add(b.id);
    if (b.building_type === "bus") {
      buses++;
      if (b.x !== 0 || b.y !== 0 || b.rotation !== 0) return fail();
    }
    const m = sim.buildings[b.id];
    if (
      !object(m) ||
      !integer(m.progress, 100000) ||
      !integer(m.duration, 100000) ||
      !integer(m.cooldown, 60) ||
      typeof m.status !== "string"
    )
      return fail();
    const definition = buildingDefinitions.get(b.building_type)!;
    if (
      (m.batches_completed !== undefined && !integer(m.batches_completed)) ||
      !validIncident(m.incident, sim.tick as number)
    )
      return fail();
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
      if (m[field] !== undefined && !integer(m[field], max)) return fail();
    }
    if (
      (m.powered !== undefined && typeof m.powered !== "boolean") ||
      (m.network_id !== undefined &&
        (typeof m.network_id !== "string" || m.network_id.length > 160)) ||
      ((m.medium as number) > 0 && b.building_type !== "m21") ||
      ((m.charge_remainder as number) > 0 && definition.role !== "battery")
    )
      return fail();
    if (
      !validTransportConfig(b as unknown as BuildingInstance) ||
      (m.supplied_kw !== undefined && !integer(m.supplied_kw, 1000))
    )
      return fail();
    const validFuels = fuelValues(definition);
    if ((m.fluid_cursor as number) > 0 && definition.role !== "valve")
      return fail();
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
        return fail();
    }
    if ((m.energy_kj as number) > 0 && !Object.keys(validFuels).length)
      return fail();
    if (m.energy_kj !== undefined && !integer(m.energy_kj, 16000))
      return fail();
    if (m.fuel !== undefined && !Array.isArray(m.fuel)) return fail();
    for (const [inv, slots] of [
      [m.input, definition.input_slots],
      [m.output, definition.output_slots],
      [m.fuel ?? [], 3],
    ] as const) {
      if (!Array.isArray(inv) || inv.length > (slots ?? 4)) return fail();
      const seen = new Set<string>();
      for (const stack of inv) {
        if (
          !object(stack) ||
          typeof stack.item !== "string" ||
          !items.has(stack.item) ||
          seen.has(stack.item) ||
          !integer(stack.count, 100) ||
          stack.count === 0
        )
          return fail();
        seen.add(stack.item);
        if (inv === m.fuel && !validFuels[stack.item]) return fail();
      }
    }
    if (b.configuration.recipe_id !== undefined) {
      const r =
        typeof b.configuration.recipe_id === "string" &&
        recipeDefinitions.get(b.configuration.recipe_id);
      if (!r || r.building_type !== b.building_type) return fail();
    }
    if (m.belt !== undefined) {
      const belt = m.belt;
      if (
        !isBelt(b.building_type) ||
        !object(belt) ||
        !identifier(belt.id) ||
        payloads.has(belt.id) ||
        typeof belt.item !== "string" ||
        !items.has(belt.item) ||
        isFluid(belt.item) ||
        !integer(belt.progress, beltTicks(b.building_type)) ||
        (belt.count !== undefined &&
          (!integer(belt.count, beltCapacity(b.building_type)) ||
            belt.count === 0))
      )
        return fail();
      payloads.add(belt.id);
    }
  }
  if (buses !== 1 || Object.keys(sim.buildings).length !== ids.size)
    return fail();
  if (sim.networks !== undefined) {
    if (!Array.isArray(sim.networks) || sim.networks.length > 3 * ids.size)
      return fail();
    for (const n of sim.networks) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        !n.id ||
        n.id.length > 160 ||
        !["shaft", "hydraulic", "electric"].includes(n.kind as string)
      )
        return fail();
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
          !integer(
            n[field],
            field === "producers" || field === "consumers"
              ? ids.size
              : 1000000000,
          )
        )
          return fail();
    }
  }
  for (const [item, count] of Object.entries(sim.warehouse))
    if (!items.has(item) || !integer(count)) return fail();
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
      return fail();
    for (const id of p.milestones)
      if (!catalog.stages?.some((s) => s.milestone_item === id)) return fail();
    for (const [id, n] of Object.entries(p.crafted))
      if (!items.has(id) || !integer(n)) return fail();
    if (!validWorkReceipts(p.work_receipts, sim.tick as number)) return fail();
    if (!validDiscoveries(p.discovered_items)) return fail();
    if (!validQuestProgress(p.quests)) return fail();
    if (
      p.developer !== undefined &&
      (!object(p.developer) ||
        Object.keys(p.developer).some(
          (key) => key !== "warehouse_orders_always_available",
        ) ||
        typeof p.developer.warehouse_orders_always_available !== "boolean")
    )
      return fail();
    if (
      p.stage !==
      expectedStage(
        p as unknown as NonNullable<Simulation["industry"]>,
        !object(p.quests) || p.quests.stage_quests_version === undefined,
      )
    )
      return fail();
    if (p.workshop !== undefined) {
      if (
        !object(p.workshop) ||
        !validWorkshopCounts(p.workshop) ||
        Object.keys(p.workshop).some(
          (key) =>
            !["recipe_id", "progress", "remaining", "total", "order"].includes(
              key,
            ),
        )
      )
        return fail();
      if (
        p.workshop.order !== undefined &&
        !validWorkshopOrder(
          p.workshop.order,
          p as unknown as NonNullable<Simulation["industry"]>,
        )
      )
        return fail();
      const r =
        typeof p.workshop.recipe_id === "string" &&
        recipeDefinitions.get(p.workshop.recipe_id);
      if (
        !r ||
        !workshopMachineAvailable(p.crafted, r.building_type) ||
        (r.tier ?? 1) > p.stage ||
        // Keep the original duration as the legacy save envelope. A retained
        // progress beyond the manual duration settles only one batch next tick.
        !integer(p.workshop.progress, r.duration_ms / 1000 - 1)
      )
        return fail();
    }
  } else if ((value.rules_version as number) >= 2) return fail();
  // Transfer receipts are transient visuals, not persistent gameplay inputs.
  const factory = structuredClone(f) as LocalFactory;
  factory.simulation.transfers = [];
  factory.simulation.industry ??= initialIndustry();
  restoreQuestProgress(factory);
  const sources = factory.buildings.filter(
    (b) => buildingDefinitions.get(b.building_type)?.role === "source",
  );
  if (
    sources.some((b) => b.y !== 10) ||
    sources.length > [1, 2, 4, 8, 12, 16][factory.simulation.industry.stage - 1]
  )
    return fail();
  if (f.districts !== undefined) {
    if (!Array.isArray(f.districts) || f.districts.length > 99) return fail();
    const districtIDs = new Set([factory.id]);
    factory.districts = f.districts.map((value) => {
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
        value.simulation.tick !== sim.tick
      )
        return fail();
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
      );
      if (
        districtIDs.has(child.id) ||
        child.buildings.some(
          (b) => buildingDefinitions.get(b.building_type)?.role === "source",
        )
      )
        return fail();
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
      return fail();
    factory.active_district_id = f.active_district_id;
  } else if (f.active_district_id !== undefined) return fail();
  if (!sharedWarehouse) {
    // Upgrade only a cloned, completely validated world. Persist one ledger,
    // never a copy per district; another load of rules v3 cannot merge again.
    for (const child of factory.districts ?? []) {
      try {
        store(factory.simulation.warehouse, child.simulation.warehouse);
      } catch {
        return fail();
      }
      child.simulation.warehouse = {};
    }
  }
  if (!validRobotWorld(factory)) return fail();
  if (needsDiscovery) restoreDiscoveries(factory);
  syncQuests(factory);
  return factory;
}

export type Edit =
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
    if (catalog.buildings.find((d) => d.id === b.building_type)?.fixed)
      throw new Error("工厂仓库固定，不能移动、旋转或删除");
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
      Object.assign(b, edit.placement);
    } else {
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
