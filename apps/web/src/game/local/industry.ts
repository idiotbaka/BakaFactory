import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  catalog,
  itemDefinitions,
  recipeDefinitions,
  selectedRecipe,
} from "./catalog";
import { add, count, store } from "./inventory";
import { fuelValues } from "./fuel";
import { applyTransportAction, type TransportAction } from "./transportActions";
import { applyUtilityAction, type UtilityAction } from "./utilityActions";
import { recipeAvailable } from "./production";
import { applyFluidAction, type FluidAction } from "./fluidActions";
import { discoverItems } from "./discovery";
import { newQuestProgress, recordWorkshopBatch } from "./quests";
import { machineBatchLimit, validFeedBatches } from "./machineFeed";
import { expectedStage, ordersUnlocked } from "./progression";
import { planWorkshopOrder } from "./orders";
import { nextOrderInventory } from "./orderInventory";
import {
  workshopBatchLimit,
  workshopOutputFits,
  workshopMachineAvailable,
  workshopDuration,
} from "./workshop";
export { recipeAvailable, canProcess } from "./production";

export type IndustryState = components["schemas"]["IndustryState"];
export const initialIndustry = (): IndustryState => ({
  quests: newQuestProgress(),
  stage: 1,
  milestones: [],
  crafted: {},
  discovered_items: [],
});
export const stageOf = (f: LocalFactory) => f.simulation.industry?.stage ?? 1;
export function recordCraft(f: LocalFactory, outputs: Record<string, number>) {
  const p = (f.simulation.industry ??= initialIndustry());
  store(p.crafted, outputs);
  discoverItems(f, Object.keys(outputs));
  for (const s of catalog.stages ?? []) {
    if (p.crafted[s.milestone_item] && !p.milestones.includes(s.milestone_item))
      p.milestones.push(s.milestone_item);
  }
  p.stage = expectedStage(p);
}
export type IndustryAction =
  | FluidAction
  | UtilityAction
  | TransportAction
  | { type: "scavenge" }
  | { type: "workshop"; recipe: string; batches?: number }
  | { type: "order_workshop"; item: string; count: number; signature: string }
  | { type: "cancel_workshop" }
  | { type: "recipe"; id: string; recipe: string }
  | { type: "feed"; id: string; item: string; count: number }
  | { type: "feed_batch"; id: string; batches?: number }
  | { type: "collect_input"; id: string }
  | { type: "fuel"; id: string; item: string; count: number }
  | { type: "collect"; id: string };

// Called only on the cloned state inside the Worker's atomic edit boundary.
export function applyIndustry(f: LocalFactory, action: IndustryAction) {
  const p = (f.simulation.industry ??= initialIndustry()),
    warehouse = f.simulation.warehouse;
  if (action.type === "scavenge") {
    store(warehouse, { [catalog.root_item!]: 1 });
    discoverItems(f, [catalog.root_item!]);
    return;
  }
  if (action.type === "workshop") {
    if (p.workshop) throw new Error("工作室正在加工，请完成或取消当前任务");
    const r = recipeDefinitions.get(action.recipe);
    if (
      !r ||
      !workshopMachineAvailable(p.crafted, r.building_type) ||
      !recipeAvailable(f, r.id)
    )
      throw new Error("工作室尚不能加工该配方");
    const batches = action.batches === undefined ? 1 : action.batches;
    if (!Number.isSafeInteger(batches) || batches < 1 || batches > 100)
      throw new Error("加工批数需为 1～100 的整数");
    if (batches > workshopBatchLimit(r, warehouse))
      throw new Error("原料不足，批数不能超过当前可加工数");
    store(
      warehouse,
      Object.fromEntries(
        Object.entries(r.inputs).map(([id, n]) => [id, -n * batches]),
      ),
    );
    p.workshop = {
      recipe_id: r.id,
      progress: 0,
      remaining: batches,
      total: batches,
    };
    return;
  }
  if (action.type === "order_workshop") {
    if (!ordersUnlocked(p))
      throw new Error("请先领取“是时候解放双手了”的任务奖励");
    if (p.workshop) throw new Error("手工队列正在加工，请先完成或取消当前任务");
    const plan = planWorkshopOrder(p, warehouse, action.item, action.count);
    if (plan.limited || Object.keys(plan.missing).length)
      throw new Error("订单材料不足或规划超出上限，请先准备材料");
    if (action.signature !== plan.signature)
      throw new Error("仓库或解锁状态已变化，请查看更新后的计划再确认");
    store(
      warehouse,
      Object.fromEntries(
        Object.entries(plan.consumed).map(([id, n]) => [id, -n]),
      ),
    );
    const first = plan.steps[0];
    p.workshop = {
      recipe_id: first.recipe_id,
      progress: 0,
      total: first.batches,
      remaining: first.batches,
      order: {
        item: plan.item,
        requested: plan.requested,
        steps: plan.steps,
        step_index: 0,
        inventory: { ...plan.consumed },
      },
    };
    return;
  }
  if (action.type === "cancel_workshop") {
    if (!p.workshop) return;
    if (p.workshop.order) {
      store(warehouse, p.workshop.order.inventory);
      delete p.workshop;
      return;
    }
    store(
      warehouse,
      Object.fromEntries(
        Object.entries(recipeDefinitions.get(p.workshop.recipe_id)!.inputs).map(
          ([id, n]) => [id, n * (p.workshop!.remaining ?? 1)],
        ),
      ),
    );
    delete p.workshop;
    return;
  }
  if (["transport", "bus_face", "branch", "deposit"].includes(action.type)) {
    applyTransportAction(f, action as TransportAction);
    return;
  }
  if (
    ["fluid_config", "fluid_branch", "fill_fluid", "drain_fluid"].includes(
      action.type,
    )
  ) {
    applyFluidAction(f, action as FluidAction);
    return;
  }
  const b = f.buildings.find((b) => b.id === action.id);
  if (["power_config", "prime", "drain_medium"].includes(action.type)) {
    applyUtilityAction(f, action as UtilityAction);
    return;
  }
  if (!b) throw new Error("设备不存在");
  const m = f.simulation.buildings[b.id],
    d = buildingDefinitions.get(b.building_type)!;
  if (action.type === "recipe") {
    const r = recipeDefinitions.get(action.recipe);
    if (!r || r.building_type !== b.building_type || !recipeAvailable(f, r.id))
      throw new Error("配方不属于该设备或尚未解锁");
    if (b.configuration.recipe_id === r.id) return;
    b.configuration.recipe_id = r.id;
    m.progress = 0;
    m.work_energy_kj = 0;
    m.duration = r.duration_ms / 1000;
    m.status = "idle";
  } else if (action.type === "fuel") {
    if (
      !fuelValues(d)[action.item] ||
      !Number.isSafeInteger(action.count) ||
      action.count < 1 ||
      action.count > 100
    )
      throw new Error("该设备不接受这种燃料或数量无效");
    m.fuel ??= [];
    if (!add(m.fuel, action.item, action.count, 3))
      throw new Error("燃料缓存已满");
    store(warehouse, { [action.item]: -action.count });
  } else if (action.type === "feed_batch") {
    const r = selectedRecipe(b);
    if (!r) throw new Error("请先选择配方");
    const requested = action.batches === undefined ? 1 : action.batches;
    if (!validFeedBatches(requested)) throw new Error("补料批数须为正整数");
    const batches = Math.min(
      requested,
      machineBatchLimit(
        r,
        m.input,
        warehouse,
        d.input_slots ?? 4,
        d.stack_limit,
      ),
    );
    if (batches < 1) throw new Error("仓库原料不足或输入缓存无法容纳一批");
    for (const [id, n] of Object.entries(r.inputs)) {
      const missing = Math.max(0, n * batches - count(m.input, id));
      if (missing && !add(m.input, id, missing, d.input_slots))
        throw new Error("输入缓存已满");
      if (missing) store(warehouse, { [id]: -missing });
    }
  } else if (action.type === "collect_input") {
    store(warehouse, Object.fromEntries(m.input.map((s) => [s.item, s.count])));
    m.input = [];
    m.progress = 0;
  } else if (action.type === "feed") {
    const r = selectedRecipe(b);
    if (
      !itemDefinitions.has(action.item) ||
      !Number.isSafeInteger(action.count) ||
      action.count < 1 ||
      action.count > 100
    )
      throw new Error("投料数量需为 1～100 的整数");
    if (!r?.inputs[action.item]) throw new Error("所选配方不接受该物品");
    if (!add(m.input, action.item, action.count, d.input_slots))
      throw new Error("输入缓存已满");
    store(warehouse, { [action.item]: -action.count });
  } else {
    const output = Object.fromEntries(m.output.map((s) => [s.item, s.count]));
    store(warehouse, output);
    m.output = [];
  }
}
export function stepWorkshop(f: LocalFactory) {
  const p = f.simulation.industry,
    job = p?.workshop;
  if (!job) return;
  const r = recipeDefinitions.get(job.recipe_id)!;
  const duration = workshopDuration(r);
  // Output overflow is backpressure; do not lose a reserved batch on a tick.
  if (!workshopOutputFits(p, f.simulation.warehouse)) return;
  job.progress++;
  if (job.progress >= duration) {
    if (job.order) {
      const order = job.order;
      const inventory = nextOrderInventory(order, r)!;
      recordWorkshopBatch(f, r.id);
      recordCraft(f, r.outputs);
      if (job.remaining! > 1) {
        order.inventory = inventory;
        job.remaining = job.remaining! - 1;
        job.progress = 0;
      } else if (order.step_index + 1 < order.steps.length) {
        order.inventory = inventory;
        const next = order.steps[++order.step_index];
        job.recipe_id = next.recipe_id;
        job.total = next.batches;
        job.remaining = next.batches;
        job.progress = 0;
      } else {
        store(f.simulation.warehouse, inventory);
        delete p.workshop;
      }
      return;
    }
    store(f.simulation.warehouse, r.outputs);
    recordWorkshopBatch(f, r.id);
    recordCraft(f, r.outputs);
    if ((job.remaining ?? 1) > 1) {
      job.remaining = (job.remaining ?? 1) - 1;
      job.progress = 0;
    } else delete p.workshop;
  }
}
