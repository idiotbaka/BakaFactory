import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { itemDefinitions } from "./catalog";
import { secondsToTicks } from "./simulationTime";

export type WarehouseActivity = components["schemas"]["WarehouseActivity"];
type Bucket = WarehouseActivity["buckets"][number];
type Flow = Bucket["factories"][string];
export const WAREHOUSE_WINDOW = secondsToTicks(60);
const limit = Number.MAX_SAFE_INTEGER;
const plus = (a: number, b: number) => Math.min(limit, a + b);

// The Worker executes synchronous transitions. Only ledgers explicitly bound
// inside a capture are observed; crafted/order inventories are never sampled.
let capture:
  | {
      ledgers: WeakMap<object, string>;
      factories: Bucket["factories"];
      touched: Set<string>;
    }
  | undefined;

export function bindWarehouse(
  warehouse: Record<string, number>,
  factory: string,
) {
  capture?.ledgers.set(warehouse, factory);
}

// Stage speculative robot proposals independently; exceptions discard samples.
export function warehouseAttempt(operation: () => void) {
  const parent = capture;
  if (!parent) return operation();
  const pending = {
    ledgers: parent.ledgers,
    factories: Object.create(null) as Bucket["factories"],
    touched: new Set<string>(),
  };
  capture = pending;
  try {
    operation();
    for (const [id, flow] of Object.entries(pending.factories)) {
      const target = (parent.factories[id] ??= { received: {}, withdrawn: {} });
      for (const direction of ["received", "withdrawn"] as const)
        for (const [item, n] of Object.entries(flow[direction]))
          target[direction][item] = plus(target[direction][item] ?? 0, n);
    }
    pending.touched.forEach((id) => parent.touched.add(id));
  } finally {
    capture = parent;
  }
}

export function recordWarehouseChange(
  warehouse: Record<string, number>,
  item: string,
  count: number,
  factory?: string,
) {
  const bound = capture?.ledgers.get(warehouse);
  if (!capture || !bound || !count) return;
  const id = factory ?? bound;
  const flow = (capture.factories[id] ??= { received: {}, withdrawn: {} });
  const quantities = count > 0 ? flow.received : flow.withdrawn;
  quantities[item] = plus(quantities[item] ?? 0, Math.abs(count));
  capture.touched.add(item);
}

export function captureWarehouse(
  current: LocalFactory,
  operation: () => LocalFactory,
): LocalFactory {
  if (capture) throw new Error("仓库统计转换不可嵌套");
  const pending = {
    ledgers: new WeakMap<object, string>(),
    factories: Object.create(null) as Bucket["factories"],
    touched: new Set<string>(),
  };
  capture = pending;
  try {
    const next = operation();
    const tick = next.simulation.tick;
    const previous = current.warehouse_activity;
    const buckets = (previous?.buckets ?? []).filter(
      (b) => b.tick > tick - WAREHOUSE_WINDOW,
    );
    const delta: Record<string, number> = {};
    for (const id of pending.touched) {
      const n =
        (next.simulation.warehouse[id] ?? 0) -
        (current.simulation.warehouse[id] ?? 0);
      if (n) delta[id] = n;
    }
    if (pending.touched.size) {
      const last = buckets.at(-1);
      const bucket: Bucket =
        last?.tick === tick
          ? {
              tick,
              delta: { ...last.delta },
              factories: Object.assign(Object.create(null), last.factories),
            }
          : { tick, delta: {}, factories: Object.create(null) };
      for (const [id, n] of Object.entries(delta)) {
        const total = (bucket.delta[id] ?? 0) + n;
        if (total) bucket.delta[id] = total;
        else delete bucket.delta[id];
      }
      for (const [id, flow] of Object.entries(pending.factories) as [
        string,
        Flow,
      ][]) {
        const old = bucket.factories[id];
        const merged: Flow = {
          received: { ...old?.received },
          withdrawn: { ...old?.withdrawn },
        };
        for (const direction of ["received", "withdrawn"] as const)
          for (const [item, n] of Object.entries(flow[direction]))
            merged[direction][item] = plus(merged[direction][item] ?? 0, n);
        bucket.factories[id] = merged;
      }
      if (last?.tick === tick) buckets[buckets.length - 1] = bucket;
      else buckets.push(bucket);
    }
    next.warehouse_activity = {
      started_tick: previous?.started_tick ?? current.simulation.tick,
      buckets,
    };
    return next;
  } finally {
    capture = undefined;
  }
}

export function warehouseSummary(
  activity: WarehouseActivity | undefined,
  tick: number,
  factory?: string,
) {
  const ready = !!activity && tick - activity.started_tick >= WAREHOUSE_WINDOW;
  const delta: Record<string, number> = {};
  const received: Record<string, number> = {};
  const withdrawn: Record<string, number> = {};
  for (const b of activity?.buckets ?? []) {
    if (b.tick <= tick - WAREHOUSE_WINDOW || b.tick > tick) continue;
    if (factory) {
      const flow = Object.hasOwn(b.factories, factory)
        ? b.factories[factory]
        : undefined;
      if (!flow) continue;
      for (const [id, n] of Object.entries(flow.received))
        received[id] = plus(received[id] ?? 0, n);
      for (const [id, n] of Object.entries(flow.withdrawn))
        withdrawn[id] = plus(withdrawn[id] ?? 0, n);
    } else {
      for (const [id, n] of Object.entries(b.delta))
        delta[id] = (delta[id] ?? 0) + n;
    }
  }
  return { ready, delta, received, withdrawn };
}

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
export function validWarehouseActivity(
  value: unknown,
  tick: number,
  factories: Set<string>,
) {
  if (value === undefined) return true;
  const keys = (v: Record<string, unknown>, names: string[]) =>
    Object.keys(v).length === names.length &&
    names.every((k) => Object.hasOwn(v, k));
  const counts = (v: unknown, signed = false) =>
    object(v) &&
    Object.entries(v).every(
      ([id, n]) =>
        itemDefinitions.has(id) &&
        Number.isSafeInteger(n) &&
        (signed
          ? Math.abs(n as number) <= limit && n !== 0
          : (n as number) > 0),
    );
  if (
    !object(value) ||
    !keys(value, ["started_tick", "buckets"]) ||
    !integer(value.started_tick) ||
    value.started_tick > tick ||
    !Array.isArray(value.buckets) ||
    value.buckets.length > WAREHOUSE_WINDOW
  )
    return false;
  let last = -1;
  for (const b of value.buckets) {
    if (
      !object(b) ||
      !keys(b, ["tick", "delta", "factories"]) ||
      !integer(b.tick) ||
      b.tick <= last ||
      b.tick < value.started_tick ||
      b.tick <= tick - WAREHOUSE_WINDOW ||
      b.tick > tick ||
      !counts(b.delta, true) ||
      !object(b.factories)
    )
      return false;
    for (const [id, flow] of Object.entries(b.factories))
      if (
        !factories.has(id) ||
        !object(flow) ||
        !keys(flow, ["received", "withdrawn"]) ||
        !counts(flow.received) ||
        !counts(flow.withdrawn)
      )
        return false;
    last = b.tick;
  }
  return true;
}
