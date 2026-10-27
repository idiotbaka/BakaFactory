import { worldSecond as stepWorld } from "./testTime";
import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { recordCraft } from "./industry";
import {
  questAmount,
  questItemAmount,
  recordFactoryOutput,
  recordWarehouseDelivery,
  syncQuests,
} from "./quests";
import { finalQuestRequirement, questVisible } from "./questRules";
import { toSave, validateSave, type LocalFactory } from "./state";
import {
  actWorld,
  allDistricts,
  createWorld,
  editWorld,
  expansionCost,
} from "./world";

const user = {
  id: "p2-quests",
  username: "p2",
  display_name: "P2",
  created_at: "now",
  last_login_at: "now",
};
const definition = (id: string) => catalog.quests!.find((q) => q.id === id)!;
function start() {
  const f = createWorld(user, "P2 任务");
  const p = f.simulation.industry!;
  p.stage = 2;
  p.quests!.completed = ["p1_free_hands"];
  p.quests!.claimed = ["p1_free_hands"];
  p.crafted.i0060 = 1;
  p.milestones = ["i0060"];
  return f;
}
function place(f: LocalFactory, type: string, id: string, x: number, y = 0) {
  f.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
  return editWorld(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}
const advance = (f: LocalFactory, ticks: number) => {
  for (let i = 0; i < ticks; i++) f = stepWorld(f);
  return f;
};

describe("P2 production and logistics quests", () => {
  it("keeps first-build expansion rewards tied to real recipes and all rewards inside P1 / P2", () => {
    for (const q of catalog.quests!.filter((q) => q.tier === 2)) {
      for (const id of Object.keys(q.rewards))
        expect(
          catalog.items.find((i) => i.id === id)!.tier,
        ).toBeLessThanOrEqual(2);
      if (!q.id.startsWith("p2_first_")) continue;
      const recipe = catalog.recipes.find((r) => r.outputs[q.goal.target])!,
        batches = q.id === "p2_first_mechanical_belt" ? 6 : 2;
      expect(q.rewards).toEqual(
        Object.fromEntries(
          Object.entries(recipe.inputs).map(([id, n]) => [id, n * batches]),
        ),
      );
    }
  });
  it("requires every item to have both machine production and automated receipts, never current stock or manual craft", () => {
    const f = start(),
      p = f.simulation.industry!,
      q = definition("p2_iron"),
      iron = itemID("粗铁锭"),
      plate = itemID("基础铁板");
    f.simulation.warehouse[iron] = 1000;
    recordCraft(f, { [iron]: 100, [plate]: 100 });
    recordWarehouseDelivery(f, iron, 500); // Recirculating stock cannot invent production.
    syncQuests(f);
    expect(questAmount(p, q)).toBe(0);
    recordFactoryOutput(f, { [iron]: 100, [plate]: 100 });
    expect(questItemAmount(p, iron)).toBe(100);
    expect(questAmount(p, q)).toBe(0);
    recordWarehouseDelivery(f, plate, 99);
    expect(questAmount(p, q)).toBe(99);
    recordWarehouseDelivery(f, plate, 1);
    syncQuests(f);
    expect(p.quests!.completed).toContain(q.id);
    f.simulation.warehouse = {};
    expect(questAmount(p, q)).toBe(100);
    expect(
      validateSave(toSave(f), user.id).simulation.industry!.quests,
    ).toEqual(p.quests);
  });
  it("records a completed furnace batch in another factory, excludes manual collection and records only confirmed WH arrivals", () => {
    let f = start();
    f = actWorld(f, { type: "select_district", id: f.districts![0].id });
    f = place(f, "m05", "furnace", -2);
    const child = f.districts![0],
      r = recipeDefinitions.get("r1017")!,
      char = itemID("生物炭");
    child.buildings.find((b) => b.id === "furnace")!.configuration.recipe_id =
      r.id;
    child.simulation.buildings.furnace.input = Object.entries(r.inputs).map(
      ([item, count]) => ({ item, count }),
    );
    child.simulation.buildings.furnace.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    const before = structuredClone(f);
    f = advance(f, r.duration_ms / 1000);
    expect(before.districts![0].simulation.buildings.furnace.output).toEqual(
      [],
    );
    expect(f.simulation.industry!.quests!.factory_produced?.[char]).toBe(1);
    expect(questItemAmount(f.simulation.industry, char)).toBe(0);
    f = editWorld(f, {
      kind: "industry",
      action: { type: "collect", id: "furnace" },
    });
    expect(f.simulation.industry!.quests!.warehouse_received?.[char] ?? 0).toBe(
      0,
    );
    f = place(f, "hand_belt", "belt", -1);
    f.districts![0].simulation.buildings.belt.belt = {
      id: "char",
      item: char,
      count: 1,
      progress: 0,
    };
    f.districts![0].buildings[0].configuration.face_180 = {
      mode: "closed",
      filter: "",
    };
    f = advance(f, 4);
    expect(questItemAmount(f.simulation.industry, char)).toBe(0);
    f.districts![0].buildings[0].configuration.face_180 = {
      mode: "input",
      filter: "",
    };
    f = stepWorld(f);
    expect(questItemAmount(f.simulation.industry, char)).toBe(1);
    expect(f.districts![0].simulation.industry).toBeUndefined();
  });
  it("needs a paid complete shaft batch, not placement, a working tick or a fuel-starved network", () => {
    let f = place(
      place(place(start(), "m09", "gen", 2), "shaft", "shaft", 3),
      "m10",
      "machine",
      4,
    );
    const r = recipeDefinitions.get("r2002")!;
    f.buildings.find((b) => b.id === "machine")!.configuration.recipe_id = r.id;
    f.simulation.buildings.machine.input = Object.entries(r.inputs).map(
      ([item, count]) => ({ item, count }),
    );
    f = advance(f, 12);
    expect(
      f.simulation.industry!.quests!.factory_events?.shaft_craft ?? 0,
    ).toBe(0);
    f.simulation.buildings.gen.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    f = advance(f, r.duration_ms / 1000 - 1);
    expect(f.simulation.industry!.quests!.completed).not.toContain(
      "p2_shaft_work",
    );
    f = stepWorld(f);
    expect(f.simulation.industry!.quests!.factory_events?.shaft_craft).toBe(1);
    expect(f.simulation.industry!.quests!.completed).toContain("p2_shaft_work");
  });
  it("counts real steam vessel input via a pipe or manual fill and rejects failed / wrong fills atomically", () => {
    let f = place(place(start(), "pipe", "pipe", 2), "steam_tank", "steam", 3);
    const steam = itemID("高压蒸汽");
    f.simulation.buildings.pipe.fluid = { item: steam, count: 1 };
    f = stepWorld(f);
    expect(f.simulation.industry!.quests!.completed).toContain(
      "p2_steam_storage",
    );
    expect(f.simulation.buildings.steam.fluid).toEqual({
      item: steam,
      count: 1,
    });
    let manual = place(start(), "steam_tank", "steam", 3);
    manual.simulation.warehouse[steam] = 1;
    manual = editWorld(manual, {
      kind: "industry",
      action: { type: "fill_fluid", id: "steam", item: steam, count: 1 },
    });
    expect(manual.simulation.industry!.quests!.completed).toContain(
      "p2_steam_storage",
    );
    const before = structuredClone(manual);
    expect(() =>
      editWorld(manual, {
        kind: "industry",
        action: {
          type: "fill_fluid",
          id: "steam",
          item: itemID("净化水"),
          count: 1,
        },
      }),
    ).toThrow();
    expect(manual).toEqual(before);
  });
  it("counts real paid expansion to ten immediately and preserves counters and claims on reload", () => {
    let f = start();
    for (const [item, cost] of Object.entries(expansionCost()))
      f.simulation.warehouse[item] = -cost * 4;
    for (let i = 0; i < 3; i++)
      f = actWorld(f, { type: "expand_district", name: `分厂 ${i}` });
    expect(f.simulation.industry!.quests!.completed).not.toContain(
      "p2_expansion",
    );
    f = actWorld(f, { type: "expand_district", name: "第十厂" });
    expect(allDistricts(f)).toHaveLength(10);
    expect(f.simulation.industry!.quests!.completed).toContain("p2_expansion");
    const produced = { ...f.simulation.industry!.crafted };
    f = actWorld(f, { type: "claim_quest", id: "p2_expansion" });
    expect(f.simulation.warehouse[itemID("初阶传送带")]).toBe(36);
    expect(f.simulation.industry!.crafted).toEqual(produced);
    expect(() =>
      actWorld(f, { type: "claim_quest", id: "p2_expansion" }),
    ).toThrow();
    const restored = validateSave(toSave(f), user.id);
    expect(restored.simulation.industry!.quests).toEqual(
      f.simulation.industry!.quests,
    );
    expect(restored.simulation.industry!.stage).toBe(2);
  });
  it("gates the renamed final at ten of nineteen and does not retract a historically claimed P2 final", () => {
    let f = start();
    const p = f.simulation.industry!,
      final = definition("p2_industrial_license"),
      others = catalog.quests!.filter((q) => q.tier === 2 && !q.stage_final);
    recordCraft(f, { [final.goal.target]: 1 });
    p.quests!.completed.push(...others.slice(0, 9).map((q) => q.id));
    syncQuests(f);
    expect(finalQuestRequirement(p, final)).toEqual({
      completed: 9,
      required: 10,
      total: 19,
    });
    expect(questVisible(p, final)).toBe(false);
    expect(() => actWorld(f, { type: "claim_quest", id: final.id })).toThrow();
    p.quests!.completed.push(others[9].id);
    syncQuests(f);
    expect(p.quests!.completed).toContain(final.id);
    f = actWorld(f, { type: "claim_quest", id: final.id });
    expect(f.simulation.industry!.stage).toBe(3);
    f.simulation.industry!.quests!.completed = ["p1_free_hands", final.id];
    expect(validateSave(toSave(f), user.id).simulation.industry!.stage).toBe(3);
  });
  it("keeps old P2 counters empty rather than fabricating production, and rejects malformed optional counters", () => {
    const f = start(),
      char = itemID("生物炭");
    f.simulation.industry!.crafted[char] = 1000;
    f.simulation.warehouse[char] = 1000;
    const restored = validateSave(toSave(f), user.id);
    expect(questItemAmount(restored.simulation.industry, char)).toBe(0);
    for (const patch of [
      { factory_produced: null },
      { warehouse_received: [] },
      { factory_produced: { unknown: 1 } },
      { warehouse_received: { [char]: -1 } },
      { factory_events: { unknown: 1 } },
      { factory_events: { district_count: 101 } },
      { factory_events: { shaft_craft: 1.5 } },
      { warehouse_received: { [char]: Number.MAX_SAFE_INTEGER + 1 } },
    ]) {
      const bad = structuredClone(toSave(f));
      Object.assign(bad.factory.simulation!.industry!.quests!, patch);
      expect(() => validateSave(bad, user.id)).toThrow();
    }
  });
});
