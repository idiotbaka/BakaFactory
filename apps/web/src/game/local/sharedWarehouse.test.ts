import { describe, expect, it } from "vitest";
import { buildingDefinitions, itemID, recipeDefinitions } from "./catalog";
import {
  actWorld,
  allDistricts,
  createWorld,
  editWorld,
  projectFactory,
  stepWorld,
} from "./world";
import { toSave, validateSave, newMachine, type LocalFactory } from "./state";
import { worldFrame, applyWorldFrame } from "./worldFrame";
import { planWorkshopOrder } from "./orders";
import { workshopDuration } from "./workshop";

const user = {
  id: "shared-stock",
  username: "shared-stock",
  display_name: "总仓库",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板"),
  water = itemID("净化水");
function place(root: LocalFactory, id: string, type: string, x: number, y = 0) {
  const item = buildingDefinitions.get(type)!.item!;
  root.simulation.warehouse[item] = (root.simulation.warehouse[item] ?? 0) + 1;
  return editWorld(root, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}

describe("one shared warehouse across every WH", () => {
  it("scavenges, starts, observes and cancels one global manual queue across districts without duplicate ticks or refunds", () => {
    let root = createWorld(user, "共用工作室");
    const recipe = recipeDefinitions.get("r1001")!,
      [material, amount] = Object.entries(recipe.inputs)[0],
      districtA = root.districts![0].id,
      districtB = root.districts![1].id;
    root.simulation.warehouse[material] = amount * 2;
    root = actWorld(root, { type: "select_district", id: districtA });
    root = editWorld(root, { kind: "industry", action: { type: "scavenge" } });
    expect(root.simulation.warehouse[material]).toBe(amount * 2 + 1);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "workshop", recipe: recipe.id, batches: 2 },
    });
    expect(root.simulation.warehouse[material]).toBe(1);
    root = actWorld(root, { type: "select_district", id: districtB });
    expect(projectFactory(root).simulation.industry!.workshop!.remaining).toBe(
      2,
    );
    const before = structuredClone(root);
    expect(() =>
      editWorld(root, {
        kind: "industry",
        action: { type: "workshop", recipe: recipe.id },
      }),
    ).toThrow(/工作室正在加工/);
    expect(root).toEqual(before);
    for (let i = 0; i < workshopDuration(recipe); i++) root = stepWorld(root);
    expect(root.simulation.industry!.workshop!.remaining).toBe(1);
    expect(root.simulation.industry!.workshop!.progress).toBe(0);
    for (const [item, n] of Object.entries(recipe.outputs))
      expect(root.simulation.warehouse[item]).toBe(n);
    expect(
      root.districts!.every(
        (d) =>
          !d.simulation.industry && !Object.keys(d.simulation.warehouse).length,
      ),
    ).toBe(true);
    root = validateSave(toSave(root), user.id);
    expect(projectFactory(root).simulation.industry!.workshop!.remaining).toBe(
      1,
    );
    root = actWorld(root, { type: "select_district", id: root.id });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(root.simulation.warehouse[material]).toBe(amount + 1);
    expect(root.simulation.industry!.workshop).toBeUndefined();
    const returned = structuredClone(root.simulation.warehouse);
    root = actWorld(root, { type: "select_district", id: districtA });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    root = stepWorld(root);
    expect(root.simulation.warehouse).toEqual(returned);
  });
  it("merges legacy district stock once without touching machine buffers, identities, time or the input snapshot", () => {
    const root = createWorld(user, "旧分仓");
    root.simulation.warehouse[iron] = 20;
    root.districts![0].simulation.warehouse[iron] = 30;
    const child = root.districts![0];
    child.buildings.push({
      id: "legacy-box",
      factory_id: child.id,
      building_type: "chest",
      x: 3,
      y: 0,
      rotation: 0,
      configuration: {},
    });
    child.simulation.buildings["legacy-box"] = newMachine();
    child.simulation.buildings["legacy-box"].output = [
      { item: iron, count: 7 },
    ];
    root.districts![1].simulation.warehouse[water] = 25;
    root.districts![1].simulation.warehouse[itemID("粗铜丝")] = 0;
    root.active_district_id = root.districts![0].id;
    const save = { ...toSave(root), rules_version: 2 as const };
    const before = structuredClone(save);
    const loaded = validateSave(save, user.id);
    expect(save).toEqual(before);
    expect(loaded.simulation.warehouse[iron]).toBe(50);
    expect(
      loaded.districts![0].simulation.buildings["legacy-box"].output,
    ).toEqual([{ item: iron, count: 7 }]);
    expect(loaded.simulation.warehouse[water]).toBe(25);
    expect(
      loaded.districts!.every(
        (f) => Object.keys(f.simulation.warehouse).length === 0,
      ),
    ).toBe(true);
    expect(projectFactory(loaded).simulation.warehouse).toEqual(
      loaded.simulation.warehouse,
    );
    expect(
      loaded.districts!.map((f) => [f.id, f.buildings, f.simulation.tick]),
    ).toEqual(
      root.districts!.map((f) => [f.id, f.buildings, f.simulation.tick]),
    );
    expect(toSave(loaded).rules_version).toBe(3);
    expect(validateSave(toSave(loaded), user.id)).toEqual(loaded);
  });

  it("rejects duplicated v3 ledgers, future versions and an overflowing legacy sum without losing the original stock", () => {
    const root = createWorld(user, "上限");
    root.simulation.warehouse[iron] = Number.MAX_SAFE_INTEGER;
    root.districts![0].simulation.warehouse[iron] = 1;
    const before = structuredClone(root);
    expect(() => validateSave(toSave(root), user.id)).toThrow();
    expect(() =>
      validateSave({ ...toSave(root), rules_version: 2 }, user.id),
    ).toThrow();
    expect(() =>
      validateSave({ ...toSave(root), rules_version: 4 }, user.id),
    ).toThrow();
    expect(root).toEqual(before);
  });

  it("constructs, feeds, collects and dismantles in an empty district using only shared stock while caches remain local", () => {
    let root = createWorld(user, "分厂开工");
    const device = buildingDefinitions.get("m03")!.item!,
      wire = itemID("废铜线"),
      copper = itemID("粗铜丝");
    root.simulation.warehouse[device] = 1;
    root.simulation.warehouse[wire] = 2;
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    root = editWorld(root, {
      kind: "place",
      id: "dismantler",
      building_type: "m03",
      placement: { x: 3, y: 0, rotation: 0 },
    });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "dismantler", recipe: "r1007" },
    });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "feed_batch", id: "dismantler" },
    });
    expect(root.simulation.warehouse[wire]).toBe(0);
    expect(root.simulation.warehouse[device]).toBe(0);
    expect(root.districts![0].simulation.buildings.dismantler.input).toEqual([
      { item: wire, count: 2 },
    ]);
    for (let i = 0; i < recipeDefinitions.get("r1007")!.duration_ms / 1000; i++)
      root = stepWorld(root);
    expect(root.simulation.warehouse[copper] ?? 0).toBe(0);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "collect", id: "dismantler" },
    });
    expect(root.simulation.warehouse[copper]).toBe(2);
    const before = structuredClone(root);
    expect(() =>
      editWorld(root, {
        kind: "industry",
        action: { type: "feed_batch", id: "dismantler" },
      }),
    ).toThrow();
    expect(root).toEqual(before);
    root = editWorld(root, { kind: "delete", id: "dismantler" });
    expect(root.simulation.warehouse[device]).toBe(1);
    expect(projectFactory(root).simulation.warehouse[copper]).toBe(2);
    expect(root.districts![0].simulation.warehouse).toEqual({});
    expect(validateSave(toSave(root), user.id)).toEqual(root);
  });

  it("reserves the last unit across two WH outputs once and sends a single canonical stock ledger in delta snapshots", () => {
    let root = createWorld(user, "跨厂竞争");
    root = place(root, "root-belt", "hand_belt", 1);
    const childID = root.districts![0].id;
    root = actWorld(root, { type: "select_district", id: childID });
    root = place(root, "child-belt", "hand_belt", 1);
    root.buildings[0].configuration.face_0 = { mode: "output", filter: iron };
    root.districts![0].buildings[0].configuration.face_0 = {
      mode: "output",
      filter: iron,
    };
    root.simulation.warehouse[iron] = 1;
    const old = structuredClone(root),
      after = stepWorld(root);
    expect(root).toEqual(old);
    expect(after.simulation.warehouse[iron]).toBe(0);
    expect(
      allDistricts(after).reduce(
        (n, f) =>
          n +
          Object.values(f.simulation.buildings).reduce(
            (n, m) => n + (m.belt?.item === iron ? (m.belt.count ?? 1) : 0),
            0,
          ),
        0,
      ),
    ).toBe(1);
    expect(
      after.districts!.every(
        (f) => Object.keys(f.simulation.warehouse).length === 0,
      ),
    ).toBe(true);
    const merged = applyWorldFrame(
      root,
      structuredClone(worldFrame(root, after)),
    );
    expect(merged).toEqual(after);
    expect(projectFactory(merged).simulation.warehouse[iron]).toBe(0);
  });

  it("credits real fluid intake at a remote WH to the shared ledger and global receipt counter", () => {
    let root = createWorld(user, "流体入总仓");
    root.simulation.industry!.stage = 2;
    root.simulation.industry!.milestones = ["i0060"];
    root.simulation.industry!.quests!.completed = ["p1_free_hands"];
    root.simulation.industry!.quests!.claimed = ["p1_free_hands"];
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    root = place(root, "pipe", "pipe", -1);
    root.districts![0].simulation.buildings.pipe.fluid = {
      item: water,
      count: 2,
    };
    root = stepWorld(root);
    expect(root.simulation.warehouse[water]).toBe(2);
    expect(root.simulation.industry!.quests!.automated_received).toBe(2);
    expect(projectFactory(root).simulation.warehouse[water]).toBe(2);
    expect(root.districts![0].simulation.buildings.pipe.fluid).toBeUndefined();
  });

  it("places and cancels a paid order from a child without creating a second queue or refund", () => {
    let root = createWorld(user, "分厂下单");
    const p = root.simulation.industry!;
    p.stage = 2;
    p.milestones = ["i0060"];
    p.quests!.completed = ["p1_free_hands"];
    p.quests!.claimed = ["p1_free_hands"];
    const rubber = itemID("橡胶碎屑"),
      plastic = itemID("塑料碎粒"),
      ring = itemID("粗密封圈");
    Object.assign(root.simulation.warehouse, { [rubber]: 4, [plastic]: 2 });
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    const plan = planWorkshopOrder(p, root.simulation.warehouse, ring, 5);
    root = editWorld(root, {
      kind: "industry",
      action: {
        type: "order_workshop",
        item: ring,
        count: 5,
        signature: plan.signature,
      },
    });
    expect(root.simulation.warehouse[rubber]).toBe(0);
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![1].id,
    });
    expect(
      projectFactory(root).simulation.industry!.workshop!.order,
    ).toBeDefined();
    const occupied = structuredClone(root);
    expect(() =>
      editWorld(root, {
        kind: "industry",
        action: { type: "workshop", recipe: "r1001" },
      }),
    ).toThrow(/工作室正在加工/);
    expect(root).toEqual(occupied);
    for (let i = 0; i < 3; i++) root = stepWorld(root);
    expect(projectFactory(root).simulation.industry!.workshop!.remaining).toBe(
      1,
    );
    root = editWorld(root, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(root.simulation.warehouse[ring]).toBe(3);
    expect(root.simulation.warehouse[rubber]).toBe(2);
    expect(root.simulation.warehouse[plastic]).toBe(1);
    const before = structuredClone(root.simulation.warehouse);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(root.simulation.warehouse).toEqual(before);
  });
});
