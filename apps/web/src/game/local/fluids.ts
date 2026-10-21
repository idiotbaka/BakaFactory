import type { BuildingInstance } from "../../api/client";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  direction,
  isFluid,
  isFluidNode,
  itemID,
  selectedRecipe,
} from "./catalog";
import {
  acceptsFluid,
  fluidBranchFilter,
  fluidLimit,
  fluidRate,
  fluidTarget,
  splitWeights,
} from "./fluidConfig";
import { enabled, face, itemFilter, side } from "./transportConfig";
import { add, count, remove, type Inventory } from "./inventory";
import { fuelValues } from "./fuel";

type Source = { b: BuildingInstance; kind: "buffer" | "output" | "warehouse" };
type Destination = {
  b: BuildingInstance;
  kind: "buffer" | "input" | "fuel" | "medium" | "warehouse";
};
type Move = {
  source: Source;
  target: Destination;
  item: string;
  count: number;
};

export function activeFluidNode(f: LocalFactory, b: BuildingInstance) {
  const d = buildingDefinitions.get(b.building_type)!;
  return (
    enabled(b) &&
    fluidRate(b) > 0 &&
    (d.role !== "valve" || splitWeights(b).some((n) => n > 0)) &&
    (!d.energy || f.simulation.buildings[b.id].powered === true)
  );
}

// A directional, integer-volume model. All reservations use pre-transfer
// contents: newly received fluid cannot cross another cell during this tick.
// Capacity is conservative (planned drainage is not counted as free space),
// so completely full closed loops rest until a real consumer makes room.
export function transferFluids(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation,
    positions = new Map(ordered.map((b) => [`${b.x},${b.y}`, b]));
  const adjacent = (b: BuildingInstance, r: number, offset = 1) => {
    const [dx, dy] = direction(r);
    return positions.get(`${b.x + dx * offset},${b.y + dy * offset}`);
  };
  const errors = new Map<string, string>(),
    rank: Record<string, number> = {
      no_connection: 1,
      blocked: 2,
      rejected: 3,
      mixed: 4,
    };
  const nodes = ordered.filter((b) => isFluidNode(b.building_type));
  for (const b of ordered) {
    const m = s.buildings[b.id];
    if (isFluidNode(b.building_type) || m.flow_in !== undefined) m.flow_in = 0;
    if (isFluidNode(b.building_type) || m.flow_out !== undefined)
      m.flow_out = 0;
    if (!isFluidNode(b.building_type)) continue;
    m.status = !enabled(b)
      ? "disabled"
      : !fluidRate(b) ||
          (buildingDefinitions.get(b.building_type)?.role === "valve" &&
            !splitWeights(b).some((n) => n > 0))
        ? "flow_closed"
        : !activeFluidNode(f, b)
          ? "no_energy"
          : m.fluid
            ? "fluid_stored"
            : "dry";
  }
  const mark = (b: BuildingInstance, status: string) => {
    if (!isFluidNode(b.building_type) || !activeFluidNode(f, b)) return;
    if ((rank[status] ?? 0) > (rank[errors.get(b.id) ?? ""] ?? 0))
      errors.set(b.id, status);
  };
  const reservedOut = new Map<string, number>(),
    reservedIn = new Map<string, number>(),
    bufferKinds = new Map<string, string>();
  const sourceUsed = new Map<string, number>(),
    targetUsed = new Map<string, number>(),
    inventoryTargets = new Map<string, Inventory>(),
    moves = new Map<string, Move>();
  const sourceKey = (source: Source, item: string) =>
    `${source.b.id}:${source.kind}:${item}`;
  const available = (source: Source, item: string) => {
    const m = s.buildings[source.b.id];
    const stock =
      source.kind === "warehouse"
        ? (s.warehouse[item] ?? 0)
        : source.kind === "buffer"
          ? m.fluid?.item === item
            ? m.fluid.count
            : 0
          : count(m.output, item);
    return Math.max(0, stock - (reservedOut.get(sourceKey(source, item)) ?? 0));
  };
  const destination = (
    actor: BuildingInstance,
    target: BuildingInstance,
    item: string,
  ): Destination | undefined => {
    if (isFluidNode(target.building_type)) return { b: target, kind: "buffer" };
    if (target.building_type === "bus") {
      const r = side(target, actor),
        intake = r === undefined ? undefined : face(target, r);
      if (
        enabled(target) &&
        intake?.mode === "input" &&
        (!intake.filter || intake.filter === item)
      )
        return { b: target, kind: "warehouse" };
      return;
    }
    if (buildingDefinitions.get(target.building_type)?.category !== "machine")
      return;
    const mode = fluidTarget(actor),
      input = !!selectedRecipe(target)?.inputs[item],
      fuel = !!fuelValues(buildingDefinitions.get(target.building_type)!)[item],
      medium = target.building_type === "m21" && item === itemID("液压工作液");
    if ((mode === "input" && input) || (mode === "auto" && input))
      return { b: target, kind: "input" };
    if ((mode === "fuel" && fuel) || (mode === "auto" && fuel))
      return { b: target, kind: "fuel" };
    if ((mode === "medium" && medium) || (mode === "auto" && medium))
      return { b: target, kind: "medium" };
  };
  const reserve = (
    actor: BuildingInstance,
    source: Source,
    target: Destination,
    item: string,
    wanted: number,
  ) => {
    const dst = s.buildings[target.b.id],
      dstDef = buildingDefinitions.get(target.b.building_type)!;
    const fail = (reason: string) => {
      mark(actor, reason);
      mark(target.b, reason);
      return 0;
    };
    let n = Math.min(wanted, available(source, item));
    if (source.kind === "buffer")
      n = Math.min(n, fluidRate(source.b) - (sourceUsed.get(source.b.id) ?? 0));
    let inv: Inventory | undefined,
      key = `${target.b.id}:${target.kind}:${item}`;
    const requestedLimit = fluidLimit(actor);
    if (target.kind === "buffer") {
      if (!activeFluidNode(f, target.b)) return fail("blocked");
      if (
        !acceptsFluid(target.b.building_type, item) ||
        (itemFilter(target.b) && itemFilter(target.b) !== item)
      )
        return fail("rejected");
      if (
        source.kind === "buffer" &&
        adjacent(target.b, target.b.rotation)?.id === source.b.id
      )
        return fail("rejected");
      const oldKind = dst.fluid?.item ?? bufferKinds.get(target.b.id);
      if (oldKind && oldKind !== item) return fail("mixed");
      const cap = Math.min(
        dstDef.fluid_capacity ?? 0,
        requestedLimit || Number.MAX_SAFE_INTEGER,
      );
      n = Math.min(
        n,
        cap - (dst.fluid?.count ?? 0) - (reservedIn.get(key) ?? 0),
        fluidRate(target.b) - (targetUsed.get(target.b.id) ?? 0),
      );
    } else if (target.kind === "warehouse") {
      n = Math.min(
        n,
        Math.min(
          Number.MAX_SAFE_INTEGER,
          requestedLimit || Number.MAX_SAFE_INTEGER,
        ) -
          (s.warehouse[item] ?? 0) -
          (reservedIn.get(key) ?? 0),
      );
    } else if (target.kind === "medium") {
      n = Math.min(
        n,
        Math.min(10, requestedLimit || 1) -
          (dst.medium ?? 0) -
          (reservedIn.get(key) ?? 0),
      );
    } else {
      key = `${target.b.id}:${target.kind}`;
      inv =
        inventoryTargets.get(key) ?? structuredClone(dst[target.kind] ?? []);
      const slots = target.kind === "fuel" ? 3 : (dstDef.input_slots ?? 12);
      if (!inv.some((v) => v.item === item) && inv.length >= slots)
        return fail("blocked");
      n = Math.min(n, Math.min(100, requestedLimit || 100) - count(inv, item));
    }
    if (n < 1) return available(source, item) ? fail("blocked") : 0;
    if (inv) {
      if (!add(inv, item, n)) return fail("blocked");
      inventoryTargets.set(key, inv);
    } else reservedIn.set(key, (reservedIn.get(key) ?? 0) + n);
    if (target.kind === "buffer") {
      targetUsed.set(target.b.id, (targetUsed.get(target.b.id) ?? 0) + n);
      bufferKinds.set(target.b.id, item);
    }
    if (source.kind === "buffer")
      sourceUsed.set(source.b.id, (sourceUsed.get(source.b.id) ?? 0) + n);
    reservedOut.set(
      sourceKey(source, item),
      (reservedOut.get(sourceKey(source, item)) ?? 0) + n,
    );
    const moveKey = `${sourceKey(source, item)}:${target.b.id}:${target.kind}`,
      old = moves.get(moveKey);
    if (old) old.count += n;
    else moves.set(moveKey, { source, target, item, count: n });
    return n;
  };
  const actions = nodes.flatMap((b) => [
    { b, kind: "push" as const },
    { b, kind: "pull" as const },
  ]);
  const offset = actions.length ? s.tick % actions.length : 0;
  for (const { b, kind } of [
    ...actions.slice(offset),
    ...actions.slice(0, offset),
  ]) {
    if (!activeFluidNode(f, b)) continue;
    const m = s.buildings[b.id],
      d = buildingDefinitions.get(b.building_type)!;
    if (kind === "pull") {
      const origin = adjacent(b, b.rotation, -1);
      if (!origin || isFluidNode(origin.building_type)) continue;
      const preferred =
        itemFilter(b) || m.fluid?.item || bufferKinds.get(b.id) || "";
      let source: Source,
        item: string,
        rate = fluidRate(b) - (targetUsed.get(b.id) ?? 0);
      if (origin.building_type === "bus") {
        const r = side(origin, b),
          output = r === undefined ? undefined : face(origin, r);
        if (
          !enabled(origin) ||
          output?.mode !== "output" ||
          !isFluid(output.filter) ||
          (preferred && preferred !== output.filter)
        )
          continue;
        source = { b: origin, kind: "warehouse" };
        item = output.filter;
        rate = Math.min(1, rate);
      } else {
        if (
          buildingDefinitions.get(origin.building_type)?.category !== "machine"
        )
          continue;
        source = { b: origin, kind: "output" };
        item =
          s.buildings[origin.id].output.find(
            (stack) =>
              isFluid(stack.item) &&
              acceptsFluid(b.building_type, stack.item) &&
              (!preferred || stack.item === preferred) &&
              available(source, stack.item) > 0,
          )?.item ?? "";
      }
      if (item && rate > 0)
        reserve(b, source, { b, kind: "buffer" }, item, rate);
    } else if (m.fluid) {
      const source: Source = { b, kind: "buffer" },
        item = m.fluid.item;
      if (d.role === "valve") {
        const branches = [
          b.rotation,
          (b.rotation + 90) % 360,
          (b.rotation + 270) % 360,
        ];
        const slots = branches.flatMap((r, i) => {
          const target = adjacent(b, r),
            filter = fluidBranchFilter(b, r);
          return target && (!filter || filter === item)
            ? Array.from({ length: splitWeights(b)[i] }, () => target)
            : [];
        });
        if (!slots.length) {
          mark(b, "no_connection");
          continue;
        }
        let cursor = (m.fluid_cursor ?? 0) % slots.length;
        for (let i = 0; i < fluidRate(b) && available(source, item) > 0; i++) {
          const dst = destination(b, slots[cursor], item);
          if (!dst) {
            mark(b, "rejected");
            break;
          }
          if (!reserve(b, source, dst, item, 1)) break;
          cursor = (cursor + 1) % slots.length;
        }
        m.fluid_cursor = cursor;
      } else {
        const target = adjacent(b, b.rotation);
        if (!target) {
          mark(b, "no_connection");
          continue;
        }
        const dst = destination(b, target, item);
        if (!dst) {
          mark(b, "rejected");
          continue;
        }
        reserve(b, source, dst, item, fluidRate(b));
      }
    }
  }
  for (const { source, item, count: n } of moves.values()) {
    const m = s.buildings[source.b.id];
    if (source.kind === "warehouse") s.warehouse[item] -= n;
    else if (source.kind === "output") remove(m.output, item, n);
    else {
      m.fluid!.count -= n;
      if (!m.fluid!.count) delete m.fluid;
    }
    m.flow_out = (m.flow_out ?? 0) + n;
  }
  for (const { target, item, count: n } of moves.values()) {
    const m = s.buildings[target.b.id];
    if (target.kind === "warehouse")
      s.warehouse[item] = (s.warehouse[item] ?? 0) + n;
    else if (target.kind === "medium") m.medium = (m.medium ?? 0) + n;
    else if (target.kind === "buffer")
      m.fluid = { item, count: (m.fluid?.count ?? 0) + n };
    else {
      m[target.kind] ??= [];
      if (!add(m[target.kind]!, item, n))
        throw new Error("流体预留与提交不一致");
    }
    m.flow_in = (m.flow_in ?? 0) + n;
  }
  for (const b of nodes) {
    if (!activeFluidNode(f, b)) continue;
    const m = s.buildings[b.id];
    m.status =
      errors.get(b.id) ??
      ((m.flow_in ?? 0) + (m.flow_out ?? 0) > 0
        ? "flowing"
        : m.fluid &&
            m.fluid.count >=
              (buildingDefinitions.get(b.building_type)?.fluid_capacity ?? 0)
          ? "fluid_full"
          : m.fluid
            ? "fluid_stored"
            : "dry");
  }
}
