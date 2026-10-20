import definitions from "../../../../server/internal/catalog/definitions.json";
import type {
  BuildingInstance,
  BuildingPlacement,
  Catalog,
  FactoryDetail,
  MachineState,
  Simulation,
  User,
} from "../../api/client";
import type { components } from "../../api/schema";

export const catalog = definitions as unknown as Catalog;
export type LocalFactory = FactoryDetail & {
  revision: number;
  simulation: Simulation;
};
export type GameSave = components["schemas"]["GameSave"];
export type CloudSave = components["schemas"]["CloudSave"];
export const newMachine = (): MachineState => ({
  input: [],
  output: [],
  progress: 0,
  duration: 0,
  cooldown: 0,
  status: "idle",
});
export const isPort = (kind: string) =>
  kind === "item_output" || kind === "item_input";
export const direction = (rotation: number): [number, number] =>
  rotation === 90
    ? [0, -1]
    : rotation === 180
      ? [-1, 0]
      : rotation === 270
        ? [0, 1]
        : [1, 0];
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
    },
  };
}
export const toSave = (factory: LocalFactory): GameSave => ({
  format_version: 1,
  rules_version: 1,
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
    value.rules_version !== 1 ||
    !object(value.factory)
  )
    return fail();
  const f = value.factory;
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
    const cell = `${b.x},${b.y}`;
    if (cells.has(cell)) return fail();
    cells.add(cell);
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
      !integer(m.cooldown, 1) ||
      typeof m.status !== "string"
    )
      return fail();
    for (const inv of [m.input, m.output]) {
      if (!Array.isArray(inv) || inv.length > 4) return fail();
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
      }
    }
    if (m.belt !== undefined) {
      const belt = m.belt;
      if (
        b.building_type !== "conveyor" ||
        !object(belt) ||
        !identifier(belt.id) ||
        payloads.has(belt.id) ||
        typeof belt.item !== "string" ||
        !items.has(belt.item) ||
        !integer(belt.progress, 1)
      )
        return fail();
      payloads.add(belt.id);
    }
  }
  if (buses !== 1 || Object.keys(sim.buildings).length !== ids.size)
    return fail();
  for (const [item, count] of Object.entries(sim.warehouse))
    if (!items.has(item) || !integer(count)) return fail();
  // Transfer receipts are transient visuals, not persistent gameplay inputs.
  const factory = structuredClone(f) as LocalFactory;
  factory.simulation.transfers = [];
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
  | { kind: "delete"; id: string };

export function editFactory(current: LocalFactory, edit: Edit): LocalFactory {
  const f = structuredClone(current);
  if (f.revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("存档版本已达到上限");
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
          b.x === p.x &&
          b.y === p.y &&
          (edit.kind === "place" || b.id !== edit.id),
      )
    )
      throw new Error("目标格子已被占用");
  }
  if (edit.kind === "place") {
    const d = catalog.buildings.find((b) => b.id === edit.building_type);
    if (!d || d.fixed || f.buildings.some((b) => b.id === edit.id))
      throw new Error("无法建造该模组");
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
    if (edit.kind === "move") Object.assign(b, edit.placement);
    else {
      const m = f.simulation.buildings[b.id];
      const stacks = [
        ...m.input,
        ...m.output,
        ...(m.belt ? [{ item: m.belt.item, count: 1 }] : []),
      ];
      for (const stack of stacks) {
        const count = (f.simulation.warehouse[stack.item] ?? 0) + stack.count;
        if (!Number.isSafeInteger(count)) throw new Error("仓库数量超出上限");
        f.simulation.warehouse[stack.item] = count;
      }
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
