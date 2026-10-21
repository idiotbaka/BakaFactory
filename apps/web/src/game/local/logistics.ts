import type {
  BuildingInstance,
  ItemTransfer,
  MachineState,
} from "../../api/client";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  beltCapacity,
  beltTicks,
  catalog,
  direction,
  isBelt,
  isChest,
  isFluid,
  isPort,
  selectedRecipe,
} from "./catalog";
import { add, count, remove, type Inventory } from "./inventory";
import {
  branchFilter,
  channel,
  enabled,
  face,
  interval,
  itemFilter,
  isSolidTransport,
  rotations,
  side,
} from "./transportConfig";
import { fuelValues } from "./fuel";

type Candidate = {
  source: BuildingInstance;
  target: BuildingInstance;
  via?: BuildingInstance;
  actor: string;
  item: string;
  limit: number;
};
type Move = Candidate & {
  quantity: number;
  payload: string;
  destination: "input" | "output" | "fuel" | "warehouse" | "belt";
};
const endpoint = (b: BuildingInstance) => ({
  id: b.id,
  building_type: b.building_type,
  x: b.x,
  y: b.y,
  rotation: b.rotation,
});
export const poweredTransport = (b: BuildingInstance, m: MachineState) => {
  const d = buildingDefinitions.get(b.building_type)!;
  return !d.energy || d.energy === "none" || m.powered === true;
};

export function advanceTransport(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation;
  for (const b of ordered) {
    const m = s.buildings[b.id],
      d = buildingDefinitions.get(b.building_type)!;
    if (m.cooldown > 0) m.cooldown--;
    if (b.building_type === "bus") {
      m.status = enabled(b) ? "warehouse" : "disabled";
      continue;
    }
    if (
      !isBelt(b.building_type) &&
      !isPort(b.building_type) &&
      !isChest(b.building_type) &&
      d.role !== "source"
    )
      continue;
    if (!enabled(b)) {
      m.status = "disabled";
      continue;
    }
    if (!poweredTransport(b, m)) {
      m.status = "no_energy";
      continue;
    }
    if (isBelt(b.building_type)) {
      m.duration = beltTicks(b.building_type);
      if (m.belt) {
        m.belt.progress = Math.min(m.duration, m.belt.progress + 1);
        m.status = m.belt.progress >= m.duration ? "blocked" : "transporting";
      } else m.status = "idle";
    } else if (isPort(b.building_type))
      m.status = m.cooldown > 0 ? "transferring" : "no_source";
    else if (isChest(b.building_type)) m.status = "storage";
    else if (d.role === "source") {
      m.duration = 10;
      const output = structuredClone(m.output);
      if (!add(output, catalog.root_item!, 12, d.output_slots)) {
        m.status = "output_full";
        continue;
      }
      m.progress++;
      m.status = "working";
      if (m.progress >= 10) {
        m.output = output;
        m.progress = 0;
      }
    }
  }
}

// All candidates read pre-transfer stock. Reservations are conservative when
// an inventory is simultaneously receiving; no downstream item can move twice.
export function transferSolids(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation;
  s.transfers ??= [];
  const positions = new Map(ordered.map((b) => [`${b.x},${b.y}`, b]));
  const adjacent = (b: BuildingInstance, r: number, offset = 1) => {
    const [dx, dy] = direction(r);
    return positions.get(`${b.x + dx * offset},${b.y + dy * offset}`);
  };
  const usable = (b: BuildingInstance) =>
    (!isSolidTransport(b.building_type) || enabled(b)) &&
    ((!isBelt(b.building_type) && !isPort(b.building_type)) ||
      poweredTransport(b, s.buildings[b.id]));
  const sourceItem = (
    b: BuildingInstance,
    anchor: BuildingInstance,
    filter = "",
  ) => {
    if (!usable(b)) return "";
    const m = s.buildings[b.id];
    if (b.building_type === "bus") {
      const r = side(b, anchor),
        output = r === undefined ? undefined : face(b, r);
      return output?.mode === "output" &&
        output.filter &&
        (!filter || filter === output.filter) &&
        (s.warehouse[output.filter] ?? 0) > 0 &&
        !isFluid(output.filter)
        ? output.filter
        : "";
    }
    if (isBelt(b.building_type))
      return m.belt &&
        m.belt.progress >= beltTicks(b.building_type) &&
        (!filter || m.belt.item === filter) &&
        !isFluid(m.belt.item)
        ? m.belt.item
        : "";
    return (
      m.output.find(
        (stack) => !isFluid(stack.item) && (!filter || stack.item === filter),
      )?.item ?? ""
    );
  };
  let candidates: Candidate[] = [];
  for (const b of ordered) {
    if (!usable(b)) continue;
    const m = s.buildings[b.id],
      d = buildingDefinitions.get(b.building_type)!;
    if (isBelt(b.building_type)) {
      const target = adjacent(b, b.rotation),
        item = sourceItem(b, b, itemFilter(b));
      if (
        !target ||
        !item ||
        (!["bus", "chest"].includes(target.building_type) &&
          !isBelt(target.building_type) &&
          !isChest(target.building_type))
      )
        continue;
      if (
        isBelt(target.building_type) &&
        adjacent(target, target.rotation)?.id === b.id
      )
        continue;
      candidates.push({
        source: b,
        target,
        actor: b.id,
        item,
        limit: beltCapacity(b.building_type),
      });
    } else if (isPort(b.building_type) && !m.cooldown) {
      const source = adjacent(b, b.rotation, -1);
      if (!source || isPort(source.building_type)) continue;
      const branches =
        d.role === "splitter"
          ? [b.rotation, (b.rotation + 90) % 360, (b.rotation + 270) % 360]
          : [b.rotation];
      const offset = s.tick % branches.length;
      const rotated = [...branches.slice(offset), ...branches.slice(0, offset)];
      for (const r of rotated) {
        const target = adjacent(b, r),
          item = sourceItem(
            source,
            b,
            d.role === "splitter" ? branchFilter(b, r) : itemFilter(b),
          );
        if (!target || !item || isPort(target.building_type)) continue;
        m.status = "blocked";
        candidates.push({
          source,
          target,
          via: b,
          actor: b.id,
          item,
          limit: d.batch_size ?? 1,
        });
      }
    } else if (b.building_type === "bus" && !m.cooldown) {
      for (const r of rotations) {
        const target = adjacent(b, r),
          output = face(b, r);
        if (
          !target ||
          output.mode !== "output" ||
          isPort(target.building_type) ||
          isFluid(output.filter) ||
          !(s.warehouse[output.filter] ?? 0)
        )
          continue;
        candidates.push({
          source: b,
          target,
          actor: `${b.id}:${r}`,
          item: output.filter,
          limit: 1,
        });
      }
    }
  }
  if (candidates.length) {
    const offset = s.tick % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }
  const chosen: Move[] = [],
    beltSources = new Map<string, number>(),
    beltTargets = new Set<string>(),
    actors = new Set<string>();
  const sources = new Map<string, Inventory>(),
    inputs = new Map<string, Inventory>(),
    outgoing = new Map<string, number>(),
    incoming = new Map<string, number>();
  const payloads = new Set(
    Object.values(s.buildings).flatMap((m) => (m.belt ? [m.belt.id] : [])),
  );
  for (const c of candidates) {
    const { source, target, item } = c,
      sourceState = s.buildings[source.id],
      targetState = s.buildings[target.id],
      targetDef = buildingDefinitions.get(target.building_type)!;
    const validTarget =
      isBelt(target.building_type) ||
      isChest(target.building_type) ||
      target.building_type === "bus" ||
      (targetDef.category === "machine" && !isPort(target.building_type));
    if (
      actors.has(c.actor) ||
      !usable(target) ||
      (isBelt(source.building_type) && beltSources.has(source.id)) ||
      !validTarget
    )
      continue;
    const sourceCount = isBelt(source.building_type)
      ? (sourceState.belt?.count ?? 1)
      : source.building_type === "bus"
        ? (s.warehouse[item] ?? 0) - (outgoing.get(item) ?? 0)
        : count(sources.get(source.id) ?? sourceState.output, item);
    let n = Math.min(sourceCount, c.limit),
      destination: Move["destination"],
      inv: Inventory | undefined;
    if (isBelt(target.building_type)) {
      if (beltTargets.has(target.id)) continue;
      n = Math.min(n, beltCapacity(target.building_type));
      destination = "belt";
      if (itemFilter(target) && itemFilter(target) !== item) continue;
    } else if (target.building_type === "bus") {
      const r = side(target, c.via ?? source),
        intake = r === undefined ? undefined : face(target, r);
      if (
        !intake ||
        intake.mode !== "input" ||
        (intake.filter && intake.filter !== item)
      )
        continue;
      destination = "warehouse";
      n = Math.min(
        n,
        Number.MAX_SAFE_INTEGER -
          (s.warehouse[item] ?? 0) -
          (incoming.get(item) ?? 0),
      );
    } else {
      destination = isChest(target.building_type)
        ? "output"
        : c.via && channel(c.via) === "fuel"
          ? "fuel"
          : "input";
      const accepts =
        destination === "output"
          ? !itemFilter(target) || itemFilter(target) === item
          : destination === "fuel"
            ? !!fuelValues(targetDef)[item]
            : !!selectedRecipe(target)?.inputs[item];
      if (!accepts) {
        if (c.via) s.buildings[c.via.id].status = "rejected";
        continue;
      }
      const key = `${target.id}:${destination}`;
      inv = structuredClone(inputs.get(key) ?? targetState[destination] ?? []);
      const slots =
        destination === "fuel"
          ? 3
          : destination === "output"
            ? targetDef.output_slots
            : targetDef.input_slots;
      if (
        !inv.some((stack) => stack.item === item) &&
        inv.length >= (slots ?? 4)
      )
        continue;
      n = Math.min(n, 100 - count(inv, item));
    }
    if (n < 1) continue;
    if (inv) {
      add(inv, item, n);
      inputs.set(`${target.id}:${destination}`, inv);
    }
    if (isBelt(source.building_type)) beltSources.set(source.id, chosen.length);
    else if (source.building_type === "bus")
      outgoing.set(item, (outgoing.get(item) ?? 0) + n);
    else {
      const inv = structuredClone(sources.get(source.id) ?? sourceState.output);
      remove(inv, item, n);
      sources.set(source.id, inv);
    }
    if (destination === "belt") beltTargets.add(target.id);
    if (destination === "warehouse")
      incoming.set(item, (incoming.get(item) ?? 0) + n);
    actors.add(c.actor);
    let payload =
      sourceState.belt && n === (sourceState.belt.count ?? 1)
        ? sourceState.belt.id
        : `payload:${s.tick}:${chosen.length}`;
    if (payload !== sourceState.belt?.id) {
      let collision = 0;
      const base = payload;
      while (payloads.has(payload)) payload = `${base}:${++collision}`;
      payloads.add(payload);
    }
    chosen.push({ ...c, quantity: n, payload, destination });
  }
  // A receiving belt must be completely vacated in this same batch. Partial
  // withdrawals cannot free its cell; full closed loops still move atomically.
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
      const target = chosen[index].target,
        old = s.buildings[target.id].belt;
      if (!isBelt(target.building_type) || !old) break;
      index = beltSources.get(target.id);
      if (index === undefined || chosen[index].quantity !== (old.count ?? 1)) {
        success = false;
        break;
      }
    }
    for (const i of path) result.set(i, success);
  }
  for (let i = 0; i < chosen.length; i++) {
    if (!result.get(i)) continue;
    const t = chosen[i],
      m = s.buildings[t.source.id];
    if (isBelt(t.source.building_type)) {
      const left = (m.belt!.count ?? 1) - t.quantity;
      if (left) m.belt!.count = left;
      else {
        delete m.belt;
        m.status = "idle";
      }
    } else if (t.source.building_type === "bus")
      s.warehouse[t.item] -= t.quantity;
    else remove(m.output, t.item, t.quantity);
  }
  for (let i = 0; i < chosen.length; i++) {
    if (!result.get(i)) continue;
    const t = chosen[i],
      m = s.buildings[t.target.id];
    if (
      t.via ||
      t.source.building_type === "bus" ||
      t.target.building_type === "bus"
    ) {
      const event: ItemTransfer = {
        id: `transfer:${s.tick}:${i}`,
        payload_id: t.payload,
        item: t.item,
        count: t.quantity,
        tick: s.tick,
        source: endpoint(t.source),
        target: endpoint(t.target),
        ...(t.via ? { via: endpoint(t.via) } : {}),
      };
      s.transfers.push(event);
    }
    if (t.destination === "belt") {
      m.belt = { id: t.payload, item: t.item, count: t.quantity, progress: 0 };
      m.status = "transporting";
    } else if (t.destination === "warehouse")
      s.warehouse[t.item] = (s.warehouse[t.item] ?? 0) + t.quantity;
    else {
      m[t.destination] ??= [];
      add(m[t.destination]!, t.item, t.quantity);
    }
    if (t.via) {
      const actor = s.buildings[t.via.id];
      actor.cooldown = interval(t.via);
      actor.status = "transferring";
    }
  }
  // O(entities), with at most one visual event per actor/face; receipts are a
  // bounded cosmetic log, not an inventory or throughput source.
  s.transfers = s.transfers.slice(-3 * ordered.length);
}
