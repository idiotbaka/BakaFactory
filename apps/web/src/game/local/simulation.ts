import type { BuildingInstance, MachineState } from "../../api/client";
import { catalog, direction, isPort, type LocalFactory } from "./state";

type Inventory = MachineState["input"];
const count = (inv: Inventory, item: string) =>
  inv.find((s) => s.item === item)?.count ?? 0;
function add(inv: Inventory, item: string, n = 1) {
  const stack = inv.find((s) => s.item === item);
  if (stack ? stack.count + n > 100 : inv.length >= 4 || n > 100) return false;
  if (stack) stack.count += n;
  else inv.push({ item, count: n });
  return true;
}
function remove(inv: Inventory, item: string, n = 1) {
  const i = inv.findIndex((s) => s.item === item);
  if (i < 0 || inv[i].count < n) throw new Error("物流来源数量不足");
  inv[i].count -= n;
  if (!inv[i].count) inv.splice(i, 1);
}
const endpoint = (b: BuildingInstance) => ({
  id: b.id,
  building_type: b.building_type,
  x: b.x,
  y: b.y,
  rotation: b.rotation,
});
const recipes = new Map(catalog.recipes.map((r) => [r.building_type, r]));
const definitions = new Map(catalog.buildings.map((d) => [d.id, d]));
type Transfer = {
  source: string;
  target: string;
  item: string;
  port?: string;
  itemID: string;
};

// Pure, deterministic single-second transition. No clock, DOM, network or disk.
// A future bounded catch-up runner can call this repeatedly without rendering.
export function step(current: LocalFactory): LocalFactory {
  if (
    current.simulation.tick >= Number.MAX_SAFE_INTEGER ||
    current.revision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("游戏时间已达到上限");
  const f: LocalFactory = {
    ...current,
    revision: current.revision + 1,
    simulation: structuredClone(current.simulation),
  };
  const s = f.simulation;
  s.tick++;
  s.transfers = (s.transfers ?? []).filter((t) => t.tick >= s.tick - 2);
  const ordered = [...f.buildings].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const byID = new Map(ordered.map((b) => [b.id, b]));
  const positions = new Map(ordered.map((b) => [`${b.x},${b.y}`, b]));
  for (const b of ordered) {
    const m = s.buildings[b.id];
    if (m.cooldown > 0) m.cooldown--;
    if (b.building_type === "bus") {
      m.status = "warehouse";
      continue;
    }
    if (b.building_type === "conveyor") {
      if (m.belt) {
        m.belt.progress = Math.min(1, m.belt.progress + 1);
        m.status = "blocked";
      } else m.status = "idle";
      continue;
    }
    if (isPort(b.building_type)) {
      m.status = m.cooldown > 0 ? "transferring" : "no_source";
      continue;
    }
    const r = recipes.get(b.building_type);
    if (!r) {
      m.status = "idle";
      continue;
    }
    m.duration = r.duration_ms / 1000;
    if (
      Object.entries(r.inputs).some(([item, n]) => count(m.input, item) < n)
    ) {
      m.status = "no_input";
      continue;
    }
    const output = structuredClone(m.output);
    if (
      Object.keys(r.outputs)
        .sort()
        .some((item) => !add(output, item, r.outputs[item]))
    ) {
      m.status = "output_full";
      continue;
    }
    m.progress++;
    m.status = "working";
    if (m.progress >= m.duration) {
      for (const [item, n] of Object.entries(r.inputs))
        remove(m.input, item, n);
      m.output = output;
      m.progress = 0;
    }
  }
  const sourceItem = (b?: BuildingInstance) => {
    if (!b) return "";
    const m = s.buildings[b.id];
    return b.building_type === "conveyor"
      ? m.belt && m.belt.progress >= 1
        ? m.belt.item
        : ""
      : recipes.has(b.building_type)
        ? (m.output[0]?.item ?? "")
        : "";
  };
  let candidates: Transfer[] = [];
  for (const b of ordered) {
    const [dx, dy] = direction(b.rotation);
    const target = positions.get(`${b.x + dx},${b.y + dy}`);
    if (b.building_type === "conveyor") {
      const item = sourceItem(b);
      if (
        item &&
        target &&
        ["conveyor", "bus"].includes(target.building_type)
      ) {
        const [tx, ty] = direction(target.rotation);
        if (
          target.building_type !== "conveyor" ||
          target.x + tx !== b.x ||
          target.y + ty !== b.y
        )
          candidates.push({
            source: b.id,
            target: target.id,
            item,
            itemID: "",
          });
      }
    } else if (isPort(b.building_type) && s.buildings[b.id].cooldown === 0) {
      const source = positions.get(`${b.x - dx},${b.y - dy}`),
        item = sourceItem(source);
      if (!item || !source) continue;
      s.buildings[b.id].status = "blocked";
      if (target && !isPort(target.building_type))
        candidates.push({
          source: source.id,
          target: target.id,
          item,
          port: b.id,
          itemID: "",
        });
    }
  }
  if (candidates.length) {
    const offset = s.tick % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }
  const chosen: Transfer[] = [],
    beltSources = new Map<string, number>(),
    beltTargets = new Set<string>();
  const reservedSource = new Map<string, Inventory>(),
    reservedInput = new Map<string, Inventory>(),
    warehouse = new Map<string, number>();
  for (const t of candidates) {
    const source = byID.get(t.source)!,
      target = byID.get(t.target)!;
    t.itemID =
      source.building_type === "conveyor"
        ? s.buildings[source.id].belt!.id
        : `${source.id}:${s.tick}:${target.id}`;
    if (source.building_type === "conveyor") {
      if (beltSources.has(source.id)) continue;
    } else if (
      count(
        reservedSource.get(source.id) ?? s.buildings[source.id].output,
        t.item,
      ) < 1
    )
      continue;
    if (target.building_type === "conveyor") {
      if (beltTargets.has(target.id)) continue;
    } else if (target.building_type === "bus") {
      if (
        (s.warehouse[t.item] ?? 0) >=
        Number.MAX_SAFE_INTEGER - (warehouse.get(t.item) ?? 0)
      )
        continue;
    } else {
      if (
        !definitions
          .get(target.building_type)
          ?.input_whitelist?.includes(t.item)
      ) {
        if (t.port) s.buildings[t.port].status = "rejected";
        continue;
      }
      const inv = structuredClone(
        reservedInput.get(target.id) ?? s.buildings[target.id].input,
      );
      if (!add(inv, t.item)) continue;
      reservedInput.set(target.id, inv);
    }
    if (source.building_type === "conveyor")
      beltSources.set(source.id, chosen.length);
    else {
      const inv = structuredClone(
        reservedSource.get(source.id) ?? s.buildings[source.id].output,
      );
      remove(inv, t.item);
      reservedSource.set(source.id, inv);
    }
    if (target.building_type === "conveyor") beltTargets.add(target.id);
    if (target.building_type === "bus")
      warehouse.set(t.item, (warehouse.get(t.item) ?? 0) + 1);
    chosen.push(t);
  }
  // Iterative dependency resolution handles full loops without recursive stack
  // growth. Every candidate depends on at most one occupied target belt.
  const result = new Map<number, boolean>();
  for (let start = 0; start < chosen.length; start++) {
    if (result.has(start)) continue;
    const path: number[] = [],
      visiting = new Set<number>();
    let index: number | undefined = start,
      success = true;
    while (index !== undefined) {
      if (result.has(index)) {
        success = result.get(index)!;
        break;
      }
      if (visiting.has(index)) break;
      visiting.add(index);
      path.push(index);
      const target = byID.get(chosen[index].target)!;
      if (target.building_type !== "conveyor" || !s.buildings[target.id].belt)
        break;
      index = beltSources.get(target.id);
      if (index === undefined) success = false;
    }
    for (const i of path) result.set(i, success);
  }
  for (let i = 0; i < chosen.length; i++) {
    if (!result.get(i)) continue;
    const t = chosen[i],
      source = byID.get(t.source)!,
      m = s.buildings[source.id];
    if (source.building_type === "conveyor") {
      delete m.belt;
      m.status = "idle";
    } else remove(m.output, t.item);
  }
  for (let i = 0; i < chosen.length; i++) {
    if (!result.get(i)) continue;
    const t = chosen[i],
      source = byID.get(t.source)!,
      target = byID.get(t.target)!,
      m = s.buildings[target.id];
    if (t.port || target.building_type === "bus")
      s.transfers.push({
        id: `transfer:${s.tick}:${t.source}:${t.target}:${t.port ?? ""}`,
        payload_id: t.itemID,
        item: t.item,
        tick: s.tick,
        source: endpoint(source),
        target: endpoint(target),
        ...(t.port ? { via: endpoint(byID.get(t.port)!) } : {}),
      });
    if (target.building_type === "conveyor") {
      m.belt = { id: t.itemID, item: t.item, progress: 0 };
      m.status = "transporting";
    } else if (target.building_type === "bus")
      s.warehouse[t.item] = (s.warehouse[t.item] ?? 0) + 1;
    else add(m.input, t.item);
    if (t.port) {
      s.buildings[t.port].cooldown = 1;
      s.buildings[t.port].status = "transferring";
    }
  }
  for (const b of ordered) {
    const r = recipes.get(b.building_type);
    if (!r) continue;
    const m = s.buildings[b.id];
    m.status = "working";
    if (
      Object.entries(r.inputs).some(([item, n]) => count(m.input, item) < n)
    ) {
      m.status = "no_input";
      continue;
    }
    const output = structuredClone(m.output);
    if (
      Object.keys(r.outputs)
        .sort()
        .some((item) => !add(output, item, r.outputs[item]))
    )
      m.status = "output_full";
  }
  return f;
}
