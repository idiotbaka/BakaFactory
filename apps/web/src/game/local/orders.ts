import type { Catalog } from "../../api/client";
import type { components } from "../../api/schema";
import { catalog, itemDefinitions, recipeDefinitions } from "./catalog";
import { workshopDuration, workshopMachineAvailable } from "./workshop";
import { ordersUnlocked } from "./progression";
import type { WorkshopOrder } from "./orderInventory";

type Industry = components["schemas"]["IndustryState"];
type Step = WorkshopOrder["steps"][number];
export const orderLimits = {
  quantity: 1000,
  steps: 256,
  batches: 10000,
  depth: 32,
  visits: 3000,
};
export type OrderPlan = {
  item: string;
  requested: number;
  steps: Step[];
  consumed: Record<string, number>;
  outputs: Record<string, number>;
  missing: Record<string, number>;
  duration: number;
  signature: string;
  limited: boolean;
};
export function orderRecipes(
  p: Industry | undefined,
  source: Catalog = catalog,
) {
  return source.recipes.filter(
    (r) =>
      workshopMachineAvailable(p?.crafted, r.building_type) &&
      (r.tier ?? 1) <= (p?.stage ?? 1) &&
      (!r.gate || p?.milestones.includes(r.gate)) &&
      !r.conditions?.length,
  );
}
type State = {
  stock: Record<string, number>;
  pool: Record<string, number>;
  consumed: Record<string, number>;
  missing: Record<string, number>;
  steps: Step[];
  batches: number;
};
const clean = (values: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const add = (values: Record<string, number>, id: string, n: number) => {
  const next = (values[id] ?? 0) + n;
  if (!Number.isSafeInteger(next) || next < 0)
    throw new Error("订单物料数量超出安全上限");
  values[id] = next;
};
export function planWorkshopOrder(
  p: Industry | undefined,
  warehouse: Record<string, number>,
  item: string,
  requested: number,
  source: Catalog = catalog,
): OrderPlan {
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > orderLimits.quantity
  )
    throw new Error(`下单数量须为 1～${orderLimits.quantity} 的整数`);
  const recipes = orderRecipes(p, source);
  if (!recipes.some((r) => !!r.outputs[item]))
    throw new Error("该物品当前没有已解锁的工作室配方");
  const sources = new Map(
    source.items.map((i) => [i.id, recipes.filter((r) => !!r.outputs[i.id])]),
  );
  let visits = 0;
  const exhausted = new Error(
    "订单规划超过复杂度上限，请先准备中间材料或减少数量",
  );
  function* ingredients(
    state: State,
    entries: [string, number][],
    index: number,
    path: Set<string>,
  ): Generator<State> {
    if (index === entries.length) {
      yield state;
      return;
    }
    const [id, n] = entries[index];
    for (const next of need(state, id, n, path))
      yield* ingredients(next, entries, index + 1, path);
  }
  function* need(
    previous: State,
    id: string,
    quantity: number,
    path: Set<string>,
  ): Generator<State> {
    if (++visits > orderLimits.visits || path.size > orderLimits.depth)
      throw exhausted;
    const state = structuredClone(previous);
    const pooled = Math.min(state.pool[id] ?? 0, quantity);
    state.pool[id] = (state.pool[id] ?? 0) - pooled;
    quantity -= pooled;
    const stored = Math.min(state.stock[id] ?? 0, quantity);
    state.stock[id] = (state.stock[id] ?? 0) - stored;
    add(state.consumed, id, stored);
    quantity -= stored;
    if (!quantity) {
      yield state;
      return;
    }
    const candidates = path.has(id) ? [] : (sources.get(id) ?? []);
    if (!candidates.length) {
      add(state.missing, id, quantity);
      yield state;
      return;
    }
    const chain = new Set([...path, id]);
    for (const recipe of candidates) {
      const batches = Math.ceil(quantity / recipe.outputs[id]);
      if (
        !Number.isSafeInteger(batches) ||
        state.batches + batches > orderLimits.batches
      )
        continue;
      const inputs = Object.entries(recipe.inputs).map(
        ([key, n]) => [key, n * batches] as [string, number],
      );
      if (inputs.some(([, n]) => !Number.isSafeInteger(n))) continue;
      for (const prepared of ingredients(state, inputs, 0, chain)) {
        const next = structuredClone(prepared);
        if (
          next.batches + batches > orderLimits.batches ||
          next.steps.length + Math.ceil(batches / 100) > orderLimits.steps
        )
          throw exhausted;
        for (const [output, n] of Object.entries(recipe.outputs))
          add(next.pool, output, n * batches);
        next.pool[id] -= quantity;
        next.batches += batches;
        for (let left = batches; left > 0; left -= 100)
          next.steps.push({
            recipe_id: recipe.id,
            batches: Math.min(left, 100),
          });
        yield next;
      }
    }
  }
  const initial: State = {
    stock: { ...warehouse, [item]: 0 },
    pool: {},
    consumed: {},
    missing: {},
    steps: [],
    batches: 0,
  };
  let best: State | undefined,
    limited = false;
  const shortage = (s: State) =>
    Object.values(s.missing).reduce((a, n) => a + n, 0);
  try {
    for (const candidate of need(initial, item, requested, new Set())) {
      if (!best || shortage(candidate) < shortage(best)) best = candidate;
      if (!shortage(candidate)) break;
    }
  } catch (error) {
    if (error !== exhausted || !best) throw error;
    limited = true;
  }
  if (!best || !best.steps.length) throw exhausted;
  const outputs = clean({
    ...best.pool,
    [item]: (best.pool[item] ?? 0) + requested,
  });
  const consumed = clean(best.consumed),
    missing = clean(best.missing);
  const canonical = JSON.stringify([
    item,
    requested,
    best.steps,
    consumed,
    outputs,
    missing,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++)
    hash = Math.imul(hash ^ canonical.charCodeAt(i), 16777619);
  return {
    item,
    requested,
    steps: best.steps,
    consumed,
    outputs,
    missing,
    limited,
    signature: (hash >>> 0).toString(16),
    duration: best.steps.reduce(
      (n, s) =>
        n +
        workshopDuration(recipes.find((r) => r.id === s.recipe_id)!) *
          s.batches,
      0,
    ),
  };
}

// Validate a persisted order by replaying only its unfinished transformations
// against the real private buffer, without producing or mutating any inventory.
export function validWorkshopOrder(value: unknown, p: Industry) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as WorkshopOrder;
  if (
    Object.keys(o).some(
      (k) =>
        !["item", "requested", "steps", "step_index", "inventory"].includes(k),
    ) ||
    !ordersUnlocked(p) ||
    !itemDefinitions.has(o.item) ||
    !Number.isSafeInteger(o.requested) ||
    o.requested < 1 ||
    o.requested > orderLimits.quantity ||
    !Array.isArray(o.steps) ||
    !o.steps.length ||
    o.steps.length > orderLimits.steps ||
    !Number.isInteger(o.step_index) ||
    o.step_index < 0 ||
    o.step_index >= o.steps.length ||
    !o.inventory ||
    typeof o.inventory !== "object" ||
    Array.isArray(o.inventory) ||
    Object.keys(o.inventory).length > itemDefinitions.size ||
    Object.entries(o.inventory).some(
      ([id, n]) =>
        !itemDefinitions.has(id) || !Number.isSafeInteger(n) || n < 0,
    )
  )
    return false;
  const job = p.workshop!,
    current = o.steps[o.step_index];
  const allowed = new Set(orderRecipes(p).map((r) => r.id));
  if (
    !current ||
    job.recipe_id !== current.recipe_id ||
    job.total !== current.batches ||
    !Number.isInteger(job.remaining) ||
    job.remaining! < 1 ||
    job.remaining! > job.total
  )
    return false;
  let total = 0;
  const stock = { ...o.inventory };
  for (let i = 0; i < o.steps.length; i++) {
    const step = o.steps[i];
    if (
      !step ||
      typeof step !== "object" ||
      Object.keys(step).some((k) => !["recipe_id", "batches"].includes(k)) ||
      !allowed.has(step.recipe_id) ||
      !Number.isInteger(step.batches) ||
      step.batches < 1 ||
      step.batches > 100
    )
      return false;
    total += step.batches;
    if (total > orderLimits.batches) return false;
    if (i < o.step_index) continue;
    const r = recipeDefinitions.get(step.recipe_id)!;
    const batches = i === o.step_index ? job.remaining! : step.batches;
    for (const [id, n] of Object.entries(r.inputs)) {
      if ((stock[id] ?? 0) < n * batches) return false;
      stock[id] -= n * batches;
    }
    for (const [id, n] of Object.entries(r.outputs)) {
      const count = (stock[id] ?? 0) + n * batches;
      if (!Number.isSafeInteger(count)) return false;
      stock[id] = count;
    }
  }
  return (stock[o.item] ?? 0) >= o.requested;
}
