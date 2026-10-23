import { describe, expect, it } from "vitest";
import {
  catalog,
  buildingDefinitions,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { createLocalFactory, editFactory, toSave, validateSave } from "./state";
import { step } from "./simulation";
import { actWorld, createWorld, editWorld, stepWorld } from "./world";
import { discoverItems } from "./discovery";
import { syncQuests } from "./quests";
import { workshopDuration } from "./workshop";

const user = {
  id: "quests",
  username: "quests",
  display_name: "任务",
  created_at: "now",
  last_login_at: "now",
};
describe("open quests and atomic rewards", () => {
  it("counts only successful automatic receipt into an actual WH, including a remote district", () => {
    let root = createWorld(user, "仓库自动化");
    root = editWorld(root, { kind: "industry", action: { type: "scavenge" } });
    expect(root.simulation.industry!.quests!.automated_received).toBe(0);
    const child = root.districts![0];
    child.simulation.warehouse[buildingDefinitions.get("hand_belt")!.item!] = 1;
    root = actWorld(root, { type: "select_district", id: child.id });
    root = editWorld(root, {
      kind: "place",
      id: "delivery-belt",
      building_type: "hand_belt",
      placement: { x: -1, y: 0, rotation: 0 },
    });
    root.districts![0].simulation.buildings["delivery-belt"].belt = {
      id: "quest-payload",
      item: itemID("垃圾包"),
      count: 1,
      progress: 0,
    };
    root.districts![0].buildings[0].configuration.face_180 = {
      mode: "closed",
      filter: "",
    };
    for (let i = 0; i < 3; i++) root = stepWorld(root);
    expect(root.simulation.industry!.quests!.automated_received).toBe(0);
    root.districts![0].buildings[0].configuration.face_180 = {
      mode: "input",
      filter: "",
    };
    root = stepWorld(root);
    expect(root.simulation.industry!.quests!.automated_received).toBe(1);
    expect(root.simulation.industry!.quests!.completed).toContain(
      "p1_warehouse_delivery",
    );
    root = actWorld(root, { type: "claim_quest", id: "p1_warehouse_delivery" });
    expect(root.simulation.warehouse[itemID("手摇传送带")]).toBe(20);
    expect(root.simulation.warehouse[itemID("分拣料箱")]).toBe(6);
    expect(root.simulation.warehouse[itemID("初阶自动投料机")]).toBe(6);
    expect(
      root.districts![0].simulation.warehouse[itemID("手摇传送带")] ?? 0,
    ).toBe(0);
    expect(
      validateSave(toSave(root), user.id).simulation.industry!.quests!
        .automated_received,
    ).toBe(1);
  });
  it("preserves old P2 progress and unlocks orders without granting new logistics item rewards", () => {
    const root = createWorld(user, "旧 P2"),
      p = root.simulation.industry!;
    p.stage = 2;
    p.milestones = ["i0060"];
    p.crafted.i0060 = 1;
    delete p.quests!.automated_received;
    delete p.quests!.stage_quests_version;
    const restored = validateSave(toSave(root), user.id);
    expect(restored.simulation.industry!.stage).toBe(2);
    expect(restored.simulation.industry!.quests!.claimed).toContain(
      "p1_free_hands",
    );
    expect(restored.simulation.industry!.quests!.claimed).not.toContain(
      "p1_warehouse_delivery",
    );
    expect(restored.simulation.warehouse[itemID("手摇传送带")] ?? 0).toBe(0);
    expect(p.quests!.claimed).not.toContain("p1_free_hands");
    const modern = structuredClone(root);
    modern.simulation.industry!.quests!.automated_received = 0;
    expect(() => validateSave(toSave(modern), user.id)).toThrow();
  });
  it("recognizes real remote production through the one global ledger without waiting for collection", () => {
    let root = createWorld(user, "分厂制造");
    const child = root.districts![0];
    child.simulation.warehouse[buildingDefinitions.get("m08")!.item!] = 1;
    root = actWorld(root, { type: "select_district", id: child.id });
    root = editWorld(root, {
      kind: "place",
      id: "assembler",
      building_type: "m08",
      placement: { x: 2, y: 2, rotation: 0 },
    });
    const recipe = recipeDefinitions.get("r1033")!;
    const remote = root.districts![0];
    remote.buildings.find(
      (b) => b.id === "assembler",
    )!.configuration.recipe_id = recipe.id;
    remote.simulation.buildings.assembler.input = Object.entries(
      recipe.inputs,
    ).map(([item, count]) => ({ item, count }));
    for (let i = 0; i < recipe.duration_ms / 1000; i++) root = stepWorld(root);
    expect(root.simulation.industry!.quests!.completed).toContain("p1_belt");
    expect(root.simulation.warehouse[itemID("手摇传送带")]).toBeUndefined();
    expect(root.districts![0].simulation.industry).toBeUndefined();
    expect(
      root.districts![0].simulation.buildings.assembler.output,
    ).not.toHaveLength(0);
  });
  it("counts R1001 only on successful workshop completion, never start, cancel or map production", () => {
    let f = createLocalFactory(user, "任务");
    f.simulation.warehouse[itemID("垃圾包")] = 24;
    const start = editFactory(f, {
      kind: "industry",
      action: { type: "workshop", recipe: "r1001", batches: 2 },
    });
    const duration = workshopDuration(recipeDefinitions.get("r1001")!);
    let cancelled = start;
    for (let i = 1; i < duration; i++) cancelled = step(cancelled);
    expect(cancelled.simulation.industry!.quests!.completed).not.toContain(
      "p1_sort_waste",
    );
    cancelled = editFactory(cancelled, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(
      step(cancelled).simulation.industry!.quests!.workshop_batches.r1001,
    ).toBeUndefined();
    f = start;
    for (let i = 0; i < duration; i++) f = step(f);
    expect(f.simulation.industry!.quests!.completed).toContain("p1_sort_waste");
    expect(f.simulation.industry!.quests!.workshop_batches.r1001).toBe(1);
    f = editFactory(f, {
      kind: "industry",
      action: { type: "cancel_workshop" },
    });
    expect(f.simulation.industry!.quests!.workshop_batches.r1001).toBe(1);
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(12);

    let machine = createLocalFactory(user, "机器分拣");
    machine.simulation.warehouse[buildingDefinitions.get("m02")!.item!] = 1;
    machine = editFactory(machine, {
      kind: "place",
      id: "sorter",
      building_type: "m02",
      placement: { x: 2, y: 2, rotation: 0 },
    });
    machine.buildings.find((b) => b.id === "sorter")!.configuration.recipe_id =
      "r1001";
    machine.simulation.buildings.sorter.input = [
      { item: itemID("垃圾包"), count: 12 },
    ];
    for (let i = 0; i < recipeDefinitions.get("r1001")!.duration_ms / 1000; i++)
      machine = step(machine);
    expect(machine.simulation.buildings.sorter.batches_completed).toBe(1);
    expect(machine.simulation.industry!.quests!.completed).not.toContain(
      "p1_sort_waste",
    );
  });
  it("supports out-of-order acquisition, headquarters delivery, repeat rejection and save restoration", () => {
    let root = createWorld(user, "奖励");
    const belt = itemID("手摇传送带");
    discoverItems(root, [belt]);
    syncQuests(root);
    expect(root.simulation.industry!.quests!.completed).toEqual(["p1_belt"]);
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    const before = structuredClone(root);
    root = actWorld(root, { type: "claim_quest", id: "p1_belt" });
    expect(root.simulation.warehouse[belt]).toBe(15);
    expect(root.districts![0].simulation.warehouse[belt]).toBeUndefined();
    expect(before.simulation.warehouse[belt]).toBeUndefined();
    expect(root.simulation.industry!.crafted[belt]).toBeUndefined();
    const restored = validateSave(toSave(root), user.id);
    expect(restored.simulation.industry!.quests!.claimed).toEqual(["p1_belt"]);
    expect(() =>
      actWorld(restored, { type: "claim_quest", id: "p1_belt" }),
    ).toThrow("已经领取");
    expect(() =>
      actWorld(restored, { type: "claim_quest", id: "p1_sort_waste" }),
    ).toThrow("尚未达成");
    expect(() =>
      actWorld(restored, { type: "claim_quest", id: "unknown" }),
    ).toThrow();
  });
  it("rolls back every reward and claim when one reward overflows", () => {
    const root = createWorld(user, "上限");
    discoverItems(root, [buildingDefinitions.get("m06")!.item!]);
    syncQuests(root);
    const copper = itemID("废铜线"),
      iron = itemID("铁质碎片");
    root.simulation.warehouse[iron] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(root);
    expect(() =>
      actWorld(root, { type: "claim_quest", id: "p1_smelter" }),
    ).toThrow("上限");
    expect(root).toEqual(before);
    expect(root.simulation.warehouse[copper]).toBeUndefined();
    root.simulation.warehouse[iron] = 0;
    const next = actWorld(root, { type: "claim_quest", id: "p1_smelter" });
    expect(next.simulation.warehouse[copper]).toBe(20);
    expect(next.simulation.warehouse[iron]).toBe(40);
  });
  it("backfills obtained equipment but does not invent workshop history in older saves", () => {
    const f = createLocalFactory(user, "旧档"),
      p = f.simulation.industry!;
    delete p.quests;
    delete p.discovered_items;
    p.crafted[buildingDefinitions.get("m03")!.item!] = 1;
    const restored = validateSave(toSave(f), user.id);
    expect(restored.simulation.industry!.quests!.completed).toEqual([
      "p1_dismantler",
    ]);
    expect(restored.simulation.industry!.quests!.workshop_batches).toEqual({});
  });
  it("uses the authored nine-task order and actual feeder item and mechanism rewards", () => {
    expect(
      catalog.quests?.filter((q) => q.tier === 1).map((q) => q.id),
    ).toEqual([
      "p1_sort_waste",
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
      "p1_belt",
      "p1_feeder",
      "p1_warehouse_delivery",
      "p1_free_hands",
    ]);
    expect(
      catalog.quests?.filter((q) => q.tier === 1).map((q) => q.rewards),
    ).toEqual([
      { [itemID("简易支架")]: 10 },
      { [itemID("粗铁片")]: 20 },
      { [itemID("垃圾包")]: 120 },
      { [itemID("废铜线")]: 20, [itemID("铁质碎片")]: 40 },
      { [itemID("粗铁锭")]: 40, [itemID("简易齿轮")]: 40 },
      { [itemID("手摇传送带")]: 15 },
      { [buildingDefinitions.get("feeder")!.item!]: 5 },
      {
        [itemID("手摇传送带")]: 20,
        [itemID("分拣料箱")]: 6,
        [itemID("初阶自动投料机")]: 6,
      },
      {},
    ]);
  });
  it("rejects malformed ledgers and duplicate, unknown or uncompleted claims", () => {
    const f = createLocalFactory(user, "坏档");
    for (const automated_received of [
      null,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
    ]) {
      const save = structuredClone(toSave(f));
      Object.assign(save.factory.simulation!.industry!.quests!, {
        automated_received,
      });
      expect(() => validateSave(save, user.id)).toThrow();
    }
    for (const bad of [
      null,
      {},
      { completed: ["unknown"], claimed: [], workshop_batches: {} },
      { completed: ["p1_belt", "p1_belt"], claimed: [], workshop_batches: {} },
      { completed: [], claimed: ["p1_belt"], workshop_batches: {} },
      {
        completed: ["p1_belt"],
        claimed: ["p1_belt", "p1_belt"],
        workshop_batches: {},
      },
      { completed: [], claimed: [], workshop_batches: { unknown: 1 } },
      { completed: [], claimed: [], workshop_batches: { r1001: -1 } },
      {
        completed: [],
        claimed: [],
        workshop_batches: { r1001: Number.MAX_SAFE_INTEGER + 1 },
      },
    ]) {
      const save = structuredClone(toSave(f));
      Object.assign(save.factory.simulation!.industry!, { quests: bad });
      expect(() => validateSave(save, user.id)).toThrow();
    }
  });
});
