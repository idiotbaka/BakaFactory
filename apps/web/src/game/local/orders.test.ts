import { describe, expect, it } from "vitest";
import type { Catalog } from "../../api/client";
import { catalog, buildingDefinitions, itemID } from "./catalog";
import { createWorld, editWorld, stepWorld, actWorld } from "./world";
import { toSave, validateSave, type LocalFactory } from "./state";
import { planWorkshopOrder } from "./orders";
import { initialIndustry } from "./industry";
import { secondsToTicks } from "./simulationTime";

const user = {
  id: "orders",
  username: "orders",
  display_name: "机械手",
  created_at: "now",
  last_login_at: "now",
};
const ring = itemID("粗密封圈");
function root() {
  const f = createWorld(user, "订单");
  const p = f.simulation.industry!;
  p.stage = 2;
  p.milestones = ["i0060"];
  p.crafted.i0060 = 1;
  p.quests!.completed = ["p1_free_hands"];
  p.quests!.claimed = ["p1_free_hands"];
  for (const id of ["m03", "m04", "m08"])
    p.crafted[buildingDefinitions.get(id)!.item!] = 1;
  Object.assign(f.simulation.warehouse, { i0009: 4, i0029: 2 });
  return f;
}
function place(f: LocalFactory, item = ring, count = 5) {
  const plan = planWorkshopOrder(
    f.simulation.industry,
    f.simulation.warehouse,
    item,
    count,
  );
  return editWorld(f, {
    kind: "industry",
    action: { type: "order_workshop", item, count, signature: plan.signature },
  });
}
function advance(f: LocalFactory, n: number) {
  for (let i = 0; i < secondsToTicks(n); i++) f = stepWorld(f);
  return f;
}
const recipe = (
  id: string,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
): Catalog["recipes"][number] => ({
  id,
  name: id,
  building_type: "m01",
  tier: 1,
  duration_ms: 7000,
  inputs,
  outputs,
});

describe("bounded recursive workshop planning", () => {
  it("stops deep recursive plans within the explicit planning budget", () => {
    const ids = catalog.items.slice(0, 40).map((i) => i.id);
    const source = {
      ...catalog,
      recipes: ids
        .slice(0, -1)
        .map((id, i) => recipe(`depth-${i}`, { [ids[i + 1]]: 1 }, { [id]: 1 })),
    };
    expect(() =>
      planWorkshopOrder(initialIndustry(), {}, ids[0], 1, source),
    ).toThrow("复杂度上限");
  });
  it("rounds batches up, requests new production and leaves existing target stock untouched", () => {
    const f = root();
    f.simulation.warehouse[ring] = 100;
    const plan = planWorkshopOrder(
      f.simulation.industry,
      f.simulation.warehouse,
      ring,
      5,
    );
    expect(plan.steps).toEqual([{ recipe_id: "r1030", batches: 2 }]);
    expect(plan.consumed).toEqual({ i0009: 4, i0029: 2 });
    expect(plan.outputs).toEqual({ [ring]: 6 });
    expect(plan.duration).toBe(6);
    expect(plan.missing).toEqual({});
    expect(f.simulation.warehouse[ring]).toBe(100);
  });
  it("reuses upstream byproducts before touching matching warehouse stock", () => {
    const source = {
      ...catalog,
      recipes: [
        recipe("a", { i0001: 1 }, { i0016: 1, i0003: 1 }),
        recipe("b", { i0016: 1, i0003: 1 }, { [ring]: 3 }),
      ],
    };
    const plan = planWorkshopOrder(
      initialIndustry(),
      { i0001: 2, i0003: 50 },
      ring,
      5,
      source,
    );
    expect(plan.steps).toEqual([
      { recipe_id: "a", batches: 2 },
      { recipe_id: "b", batches: 2 },
    ]);
    expect(plan.consumed).toEqual({ i0001: 2 });
    expect(plan.outputs).toEqual({ [ring]: 6 });
    expect(plan.missing).toEqual({});
  });
  it("tries a feasible alternate after a cyclic source and reports real leaf shortages", () => {
    const source = {
      ...catalog,
      recipes: [
        recipe("cycle", { [ring]: 1 }, { i0016: 1 }),
        recipe("back", { i0016: 1 }, { [ring]: 1 }),
        recipe("valid", { i0001: 2 }, { i0016: 1 }),
      ],
    };
    const plan = planWorkshopOrder(
      initialIndustry(),
      { i0001: 2 },
      "i0016",
      1,
      source,
    );
    expect(plan.steps).toEqual([{ recipe_id: "valid", batches: 1 }]);
    expect(plan.missing).toEqual({});
    const missing = planWorkshopOrder(initialIndustry(), {}, ring, 5, {
      ...catalog,
      recipes: [recipe("simple", { i0001: 2 }, { [ring]: 3 })],
    });
    expect(missing.missing).toEqual({ i0001: 4 });
    expect(missing.consumed).toEqual({});
    expect(() =>
      planWorkshopOrder(initialIndustry(), {}, ring, 1001, source),
    ).toThrow("1～1000");
    expect(() => planWorkshopOrder(initialIndustry(), {}, "i0059", 1)).toThrow(
      "已解锁",
    );
  });
});

describe("paid order queue and conservation", () => {
  it("enables development orders in P1 without claiming rewards or advancing a manufactured milestone", () => {
    const original = createWorld(user, "P1 开发");
    Object.assign(original.simulation.warehouse, { i0009: 4, i0029: 2 });
    original.simulation.industry!.milestones = ["i0060"];
    original.simulation.industry!.crafted.i0060 = 1;
    expect(() => place(original)).toThrow("领取");
    let f = actWorld(original, {
      type: "developer_settings",
      warehouse_orders_always_available: true,
    });
    expect(original.simulation.industry!.developer).toBeUndefined();
    expect(f.simulation.industry!.quests!.claimed).toEqual([]);
    f = place(f);
    expect(
      validateSave(toSave(f), user.id).simulation.industry!.workshop,
    ).toEqual(f.simulation.industry!.workshop);
    const before = structuredClone(f);
    expect(() =>
      actWorld(f, {
        type: "developer_settings",
        warehouse_orders_always_available: false,
      }),
    ).toThrow("完成或取消");
    expect(f).toEqual(before);
    f = advance(f, 6);
    expect(f.simulation.warehouse[ring]).toBe(6);
    expect(f.simulation.industry!.stage).toBe(1);
    expect(f.simulation.industry!.quests!.claimed).toEqual([]);
    f = actWorld(f, {
      type: "developer_settings",
      warehouse_orders_always_available: false,
    });
    expect(() => place(f)).toThrow("领取");
    expect(
      validateSave(toSave(f), user.id).simulation.industry!.developer!
        .warehouse_orders_always_available,
    ).toBe(false);
  });
  it("validates optional development settings and preserves queue materials on cancellation", () => {
    const base = createWorld(user, "开发取消");
    Object.assign(base.simulation.warehouse, { i0009: 4, i0029: 2 });
    let f = place(
      actWorld(base, {
        type: "developer_settings",
        warehouse_orders_always_available: true,
      }),
    );
    f = advance(f, 3);
    f = editWorld(f, { kind: "industry", action: { type: "cancel_workshop" } });
    f = actWorld(f, {
      type: "developer_settings",
      warehouse_orders_always_available: false,
    });
    expect(f.simulation.warehouse[ring]).toBe(3);
    expect(f.simulation.warehouse.i0009).toBe(2);
    for (const developer of [
      null,
      {},
      [],
      { warehouse_orders_always_available: "true" },
      { warehouse_orders_always_available: true, extra: true },
    ]) {
      const invalid = structuredClone(toSave(base));
      Object.assign(invalid.factory.simulation!.industry!, { developer });
      expect(() => validateSave(invalid, user.id)).toThrow();
    }
  });
  it("reserves once, excludes manual work, preserves private intermediates through reload and delivers all rounded outputs", () => {
    const original = root();
    let f = place(original);
    expect(original.simulation.warehouse.i0009).toBe(4);
    expect(f.simulation.warehouse.i0009).toBe(0);
    expect(f.simulation.industry!.workshop!.order!.inventory.i0009).toBe(4);
    expect(() => place(f)).toThrow("队列");
    expect(() =>
      editWorld(f, {
        kind: "industry",
        action: { type: "workshop", recipe: "r1001" },
      }),
    ).toThrow("加工");
    f = advance(f, 3);
    expect(f.simulation.warehouse[ring] ?? 0).toBe(0);
    expect(f.simulation.industry!.workshop!.order!.inventory[ring]).toBe(3);
    expect(f.simulation.industry!.workshop!.remaining).toBe(1);
    const reloaded = validateSave(toSave(f), user.id);
    expect(advance(reloaded, 3)).toEqual(advance(f, 3));
    f = advance(reloaded, 3);
    expect(f.simulation.industry!.workshop).toBeUndefined();
    expect(f.simulation.warehouse[ring]).toBe(6);
    expect(f.simulation.industry!.crafted[ring]).toBe(6);
    expect(f.simulation.industry!.quests!.workshop_batches.r1030).toBe(2);
  });
  it("cancels before and after real work without returning both used materials and their products", () => {
    const f = root();
    const early = editWorld(place(f), {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(early.simulation.warehouse.i0009).toBe(4);
    expect(early.simulation.warehouse.i0029).toBe(2);
    let later = advance(place(f), 4);
    later = editWorld(later, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(later.simulation.warehouse.i0009).toBe(2);
    expect(later.simulation.warehouse.i0029).toBe(1);
    expect(later.simulation.warehouse[ring]).toBe(3);
    const repeat = editWorld(later, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(repeat.simulation.warehouse).toEqual(later.simulation.warehouse);
  });
  it("commits no reservation for stale plans, shortages or locked accounts and accepts shared-stock orders from a child", () => {
    const f = root(),
      before = structuredClone(f);
    expect(() =>
      editWorld(f, {
        kind: "industry",
        action: {
          type: "order_workshop",
          item: ring,
          count: 5,
          signature: "stale",
        },
      }),
    ).toThrow("再确认");
    expect(f).toEqual(before);
    f.simulation.warehouse.i0009 = 0;
    expect(() => place(f)).toThrow("材料");
    const locked = root();
    locked.simulation.industry!.quests!.claimed = [];
    expect(() => place(locked)).toThrow("领取");
    let remote = root();
    remote = actWorld(remote, {
      type: "select_district",
      id: remote.districts![0].id,
    });
    remote = place(remote);
    expect(remote.simulation.industry!.workshop?.order?.requested).toBe(5);
    expect(remote.simulation.warehouse.i0009).toBe(0);
    expect(remote.districts![0].simulation.warehouse).toEqual({});
  });
  it("executes a multi-recipe dependency chain and retains the surplus intermediate parts", () => {
    const f = root(),
      belt = itemID("初阶传送带");
    Object.assign(f.simulation.warehouse, { i0045: 4, i0049: 4 });
    const plan = planWorkshopOrder(
      f.simulation.industry,
      f.simulation.warehouse,
      belt,
      3,
    );
    expect(plan.steps.map((s) => s.recipe_id)).toEqual(["r1030", "r1033"]);
    expect(plan.outputs).toEqual({ i0050: 2, i0053: 4 });
    const done = advance(place(f, belt, 3), plan.duration);
    expect(done.simulation.industry!.workshop).toBeUndefined();
    expect(done.simulation.warehouse[ring]).toBe(2);
    expect(done.simulation.warehouse[belt]).toBe(4);
    expect(done.simulation.warehouse.i0009).toBe(0);
  });
  it("retains the queue on final output or cancellation overflow, and validates the remaining paid chain", () => {
    const f = advance(place(root()), 3);
    f.simulation.warehouse[ring] = Number.MAX_SAFE_INTEGER;
    const blocked = advance(f, 10);
    expect(blocked.simulation.industry!.workshop).toEqual(
      f.simulation.industry!.workshop,
    );
    expect(() =>
      editWorld(f, { kind: "industry", action: { type: "cancel_workshop" } }),
    ).toThrow("上限");
    f.simulation.warehouse[ring] = 0;
    for (const modify of [
      (o: NonNullable<LocalFactory["simulation"]["industry"]>["workshop"]) => {
        o!.order!.inventory.i0009 = 0;
      },
      (o: NonNullable<LocalFactory["simulation"]["industry"]>["workshop"]) => {
        o!.order!.step_index = 999;
      },
      (o: NonNullable<LocalFactory["simulation"]["industry"]>["workshop"]) => {
        o!.order!.inventory.unknown = 10;
      },
    ]) {
      const bad = structuredClone(f);
      modify(bad.simulation.industry!.workshop);
      expect(() => validateSave(toSave(bad), user.id)).toThrow();
    }
    expect(
      advance(validateSave(toSave(f), user.id), 3).simulation.warehouse[ring],
    ).toBe(6);
  });
});
