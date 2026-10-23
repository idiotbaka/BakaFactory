import { describe, expect, it } from "vitest";
import { catalog, itemID, recipeDefinitions } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import type { IndustryAction } from "./industry";
import { step } from "./simulation";
import { workshopDuration, workshopMachineAvailable } from "./workshop";
import { claimQuest } from "./quests";

const user = {
  id: "recycler",
  username: "recycler",
  display_name: "回收员",
  created_at: "now",
  last_login_at: "now",
};
const start = () => createLocalFactory(user, "回收厂");
const act = (f: LocalFactory, action: IndustryAction) =>
  editFactory(f, { kind: "industry", action });
const advance = (f: LocalFactory, seconds: number) => {
  for (let i = 0; i < seconds; i++) f = step(f);
  return f;
};
const install = (f: LocalFactory, type: string) => {
  const d = catalog.buildings.find((b) => b.id === type)!;
  f.simulation.warehouse[d.item!] = 1;
  return editFactory(f, {
    kind: "place",
    id: type,
    building_type: type,
    placement: { x: 1, y: 0, rotation: 0 },
  });
};

describe("recycling gameplay", () => {
  it("finishes an odd-duration manual batch in three ticks while the installed machine still needs seven", () => {
    const r = recipeDefinitions.get("r1002")!;
    expect(r.duration_ms).toBe(7000);
    let manual = start();
    Object.assign(
      manual.simulation.warehouse,
      Object.fromEntries(
        Object.entries(r.inputs).map(([id, n]) => [id, n * 2]),
      ),
    );
    manual = act(manual, { type: "workshop", recipe: r.id, batches: 2 });
    manual = advance(manual, 2);
    expect(manual.simulation.industry!.workshop).toMatchObject({
      remaining: 2,
      progress: 2,
    });
    for (const id of Object.keys(r.outputs))
      expect(manual.simulation.warehouse[id] ?? 0).toBe(0);
    manual = step(manual);
    expect(manual.simulation.industry!.workshop).toMatchObject({
      remaining: 1,
      progress: 0,
    });
    manual = act(validateSave(toSave(manual), user.id), {
      type: "cancel_workshop",
    });
    for (const [id, n] of Object.entries(r.inputs))
      expect(manual.simulation.warehouse[id]).toBe(n);
    for (const [id, n] of Object.entries(r.outputs))
      expect(manual.simulation.warehouse[id]).toBe(n);

    let machine = act(install(start(), "m02"), {
      type: "recipe",
      id: "m02",
      recipe: r.id,
    });
    Object.assign(machine.simulation.warehouse, r.inputs);
    machine = act(machine, { type: "feed_batch", id: "m02" });
    machine = advance(machine, 3);
    expect(machine.simulation.buildings.m02.output).toEqual([]);
    expect(machine.simulation.buildings.m02.progress).toBe(3);
    machine = advance(machine, 4);
    for (const [id, n] of Object.entries(r.outputs))
      expect(
        machine.simulation.buildings.m02.output.find(
          (stack) => stack.item === id,
        )?.count,
      ).toBe(n);
  });
  it("retains pre-bonus save progress, pauses on output overflow and settles only one legacy batch on resumption", () => {
    const r = recipeDefinitions.get("r1001")!,
      trash = itemID("垃圾包"),
      product = Object.keys(r.outputs)[0];
    let f = start();
    f.simulation.warehouse[trash] = 24;
    f = act(f, { type: "workshop", recipe: r.id, batches: 2 });
    f.simulation.industry!.workshop!.progress = 9;
    f = validateSave(toSave(f), user.id);
    expect(f.simulation.industry!.workshop!.progress).toBe(9);
    f.simulation.warehouse[product] = Number.MAX_SAFE_INTEGER;
    f = step(f);
    expect(f.simulation.industry!.workshop).toMatchObject({
      progress: 9,
      remaining: 2,
    });
    f.simulation.warehouse[product] = 0;
    f = step(f);
    expect(f.simulation.industry!.workshop).toMatchObject({
      progress: 0,
      remaining: 1,
    });
    expect(f.simulation.warehouse[product]).toBe(r.outputs[product]);
    expect(f.simulation.industry!.quests!.workshop_batches.r1001).toBe(1);
    f = act(f, { type: "cancel_workshop" });
    expect(f.simulation.warehouse[trash]).toBe(12);
  });
  it("unlocks M03 / M04 / M08 manual recipes only after actual equipment manufacture and keeps them through installation and reload", () => {
    for (const [machine, manufacturing, processing] of [
      ["m03", "r1006", "r1007"],
      ["m04", "r1011", "r1012"],
      ["m08", "r1032", "r1033"],
    ]) {
      let f = start();
      const device = catalog.buildings.find((b) => b.id === machine)!.item!,
        make = recipeDefinitions.get(manufacturing)!,
        process = recipeDefinitions.get(processing)!;
      f.simulation.warehouse[device] = 1;
      Object.assign(f.simulation.warehouse, process.inputs);
      f = editFactory(f, {
        kind: "place",
        id: machine,
        building_type: machine,
        placement: { x: 1, y: 0, rotation: 0 },
      });
      expect(
        workshopMachineAvailable(f.simulation.industry!.crafted, machine),
      ).toBe(false);
      const before = structuredClone(f);
      expect(() => act(f, { type: "workshop", recipe: processing })).toThrow(
        "工作室尚不能加工",
      );
      expect(f).toEqual(before);
      Object.assign(f.simulation.warehouse, make.inputs);
      f = act(f, { type: "workshop", recipe: manufacturing });
      f = advance(f, workshopDuration(make));
      expect(
        workshopMachineAvailable(f.simulation.industry!.crafted, machine),
      ).toBe(true);
      f.simulation.warehouse[device] = 0;
      f = validateSave(toSave(f), user.id);
      Object.assign(
        f.simulation.warehouse,
        Object.fromEntries(
          Object.entries(process.inputs).map(([id, n]) => [id, n * 2]),
        ),
      );
      f = act(f, { type: "workshop", recipe: processing, batches: 2 });
      f = advance(f, workshopDuration(process));
      expect(f.simulation.industry!.workshop?.remaining).toBe(1);
      f = validateSave(toSave(f), user.id);
      f = act(f, { type: "cancel_workshop" });
      for (const [id, n] of Object.entries(process.inputs))
        expect(f.simulation.warehouse[id]).toBe(n);
      for (const [id, n] of Object.entries(process.outputs))
        expect(f.simulation.warehouse[id]).toBe(n);
      expect(
        workshopMachineAvailable(f.simulation.industry!.crafted, "m05"),
      ).toBe(false);
    }
  });
  it("rejects a forged locked optional-workbench queue when loading a save", () => {
    const f = start();
    for (const recipe of ["r1007", "r1033"]) {
      f.simulation.industry!.workshop = {
        recipe_id: recipe,
        progress: 0,
        total: 1,
        remaining: 1,
      };
      expect(() => validateSave(toSave(f), user.id)).toThrow();
    }
  });
  it("reserves a batch queue once, completes one batch at a time, restores it and refunds only unfinished inputs", () => {
    let f = start();
    const r = recipeDefinitions.get("r1001")!,
      trash = itemID("垃圾包"),
      before = structuredClone(f);
    f.simulation.warehouse[trash] = 36;
    f = act(f, { type: "workshop", recipe: r.id, batches: 3 });
    expect(f.simulation.warehouse[trash]).toBe(0);
    expect(before.simulation.industry?.workshop).toBeUndefined();
    expect(f.simulation.industry!.workshop).toMatchObject({
      remaining: 3,
      total: 3,
    });
    f = advance(f, workshopDuration(r) + 3);
    expect(f.simulation.industry!.workshop).toMatchObject({
      remaining: 2,
      total: 3,
      progress: 3,
    });
    for (const [id, n] of Object.entries(r.outputs))
      expect(f.simulation.warehouse[id]).toBe(n);
    f = validateSave(toSave(f), user.id);
    f = act(f, { type: "cancel_workshop" });
    expect(f.simulation.warehouse[trash]).toBe(24);
    expect(f.simulation.industry!.workshop).toBeUndefined();
    for (const [id, n] of Object.entries(r.outputs))
      expect(f.simulation.warehouse[id]).toBe(n);
    expect(
      act(f, { type: "cancel_workshop" }).simulation.warehouse[trash],
    ).toBe(24);
  });
  it("rejects noninteger, excessive and unaffordable batch counts atomically, and finishes exactly 100 paid batches", () => {
    const f = start(),
      trash = itemID("垃圾包"),
      r = recipeDefinitions.get("r1001")!;
    f.simulation.warehouse[trash] = 1200;
    const old = structuredClone(f);
    for (const batches of [0, -1, 1.5, 101, NaN, Infinity]) {
      expect(() =>
        act(f, { type: "workshop", recipe: r.id, batches }),
      ).toThrow();
      expect(f).toEqual(old);
    }
    const scarce = structuredClone(f);
    scarce.simulation.warehouse[trash] = 13;
    expect(() =>
      act(scarce, { type: "workshop", recipe: r.id, batches: 2 }),
    ).toThrow("原料不足");
    expect(scarce.simulation.warehouse[trash]).toBe(13);
    const done = advance(
      act(f, { type: "workshop", recipe: r.id, batches: 100 }),
      workshopDuration(r) * 100,
    );
    expect(done.simulation.industry!.workshop).toBeUndefined();
    expect(done.simulation.warehouse[trash]).toBe(0);
    for (const [id, n] of Object.entries(r.outputs))
      expect(done.simulation.warehouse[id]).toBe(100 * n);
  });
  it("keeps remaining batches through output backpressure and accepts legacy single-batch saves", () => {
    let f = start();
    const r = recipeDefinitions.get("r1001")!,
      trash = itemID("垃圾包"),
      product = Object.keys(r.outputs)[0];
    f.simulation.warehouse[trash] = 24;
    f = act(f, { type: "workshop", recipe: r.id, batches: 2 });
    f.simulation.warehouse[product] = Number.MAX_SAFE_INTEGER;
    const stopped = advance(f, 3);
    expect(stopped.simulation.industry!.workshop).toEqual(
      f.simulation.industry!.workshop,
    );
    expect(stopped.simulation.industry!.crafted[product]).toBeUndefined();
    f.simulation.warehouse[product] = 0;
    const oldFactory = start();
    oldFactory.simulation.warehouse[trash] = 12;
    const legacy = toSave(act(oldFactory, { type: "workshop", recipe: r.id }));
    delete legacy.factory.simulation!.industry!.workshop!.remaining;
    delete legacy.factory.simulation!.industry!.workshop!.total;
    expect(
      advance(validateSave(legacy, user.id), workshopDuration(r)).simulation
        .industry!.workshop,
    ).toBeUndefined();
    for (const fields of [
      { remaining: 0, total: 2 },
      { remaining: 3, total: 2 },
      { remaining: 1, total: 101 },
      { remaining: 1 },
      { remaining: null, total: 2 },
    ]) {
      const invalid = toSave(structuredClone(f));
      const job = invalid.factory.simulation!.industry!.workshop!;
      delete job.remaining;
      delete job.total;
      Object.assign(job, fields);
      expect(() => validateSave(invalid, user.id)).toThrow();
    }
  });
  it("bootstraps from zero, reserves one batch and preserves all nine sorting products across reload", () => {
    let f = start();
    for (let n = 0; n < 12; n++) f = act(f, { type: "scavenge" });
    f = act(f, { type: "workshop", recipe: "r1001" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(0);
    expect(() => act(f, { type: "workshop", recipe: "r1001" })).toThrow();
    f = advance(f, 2);
    const reloaded = validateSave(toSave(f), user.id);
    expect(advance(reloaded, 3)).toEqual(advance(f, 3));
    f = advance(f, 3);
    expect(f.simulation.industry?.workshop).toBeUndefined();
    for (const [id, n] of Object.entries(
      recipeDefinitions.get("r1001")!.outputs,
    ))
      expect(f.simulation.warehouse[id]).toBe(n);
    expect(
      Object.values(f.simulation.warehouse).reduce((a, n) => a + n, 0),
    ).toBe(12);
  });
  it("refunds a cancelled reserved batch once, and failed starts cannot mutate the original", () => {
    let f = start();
    expect(() => act(f, { type: "workshop", recipe: "r1001" })).toThrow();
    expect(f.simulation.warehouse).toEqual({});
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "workshop", recipe: "r1001" });
    f = advance(f, 4);
    f = act(f, { type: "cancel_workshop" });
    f = act(f, { type: "cancel_workshop" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(12);
    expect(f.simulation.industry?.crafted).toEqual({});
  });
  it("installs a crafted device, needs a selected recipe and settles a nine-output batch atomically", () => {
    let f = start();
    expect(() =>
      editFactory(f, {
        kind: "place",
        id: "m02",
        building_type: "m02",
        placement: { x: 1, y: 0, rotation: 0 },
      }),
    ).toThrow();
    f = install(f, "m02");
    f = step(f);
    expect(f.simulation.buildings.m02.status).toBe("no_recipe");
    f = act(f, { type: "recipe", id: "m02", recipe: "r1001" });
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "feed_batch", id: "m02" });
    f = advance(f, 9);
    expect(f.simulation.buildings.m02.output).toEqual([]);
    expect(f.simulation.buildings.m02.input[0].count).toBe(12);
    f = step(f);
    expect(f.simulation.buildings.m02.output).toHaveLength(9);
    expect(f.simulation.buildings.m02.input).toEqual([]);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
    f = editFactory(f, { kind: "delete", id: "m02" });
    expect(
      f.simulation.warehouse[
        catalog.buildings.find((b) => b.id === "m02")!.item!
      ],
    ).toBe(1);
    expect(f.simulation.warehouse[itemID("铁质碎片")]).toBe(3);
  });
  it("holds production for any blocked byproduct, and switching recipes never consumes unfinished inputs", () => {
    let f = act(install(start(), "m02"), {
      type: "recipe",
      id: "m02",
      recipe: "r1001",
    });
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "feed_batch", id: "m02" });
    f.simulation.buildings.m02.output = [
      { item: itemID("混合塑料"), count: 100 },
    ];
    f = advance(f, 20);
    expect(f.simulation.buildings.m02.status).toBe("output_full");
    expect(f.simulation.buildings.m02.progress).toBe(0);
    expect(f.simulation.buildings.m02.input[0].count).toBe(12);
    f = act(f, { type: "recipe", id: "m02", recipe: "r1002" });
    f = act(f, { type: "collect_input", id: "m02" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(12);
  });
  it("tops up a target number of complete batches using only missing material and preserves ongoing work", () => {
    let f = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1039",
    });
    const recipe = recipeDefinitions.get("r1039")!;
    for (const id of Object.keys(recipe.inputs))
      f.simulation.warehouse[id] = 100;
    f.simulation.buildings.m08.input = [
      { item: "i0055", count: 7 },
      { item: "i0057", count: 3 },
    ];
    f.simulation.buildings.m08.progress = 4;
    f = act(f, { type: "feed_batch", id: "m08", batches: 6 });
    expect(f.simulation.buildings.m08.input).toEqual([
      { item: "i0055", count: 12 },
      { item: "i0057", count: 12 },
      { item: "i0054", count: 6 },
    ]);
    expect(
      Object.fromEntries(
        Object.keys(recipe.inputs).map((id) => [
          id,
          f.simulation.warehouse[id],
        ]),
      ),
    ).toEqual({ i0055: 95, i0057: 91, i0054: 94 });
    expect(f.simulation.buildings.m08.progress).toBe(4);
    const inventory = structuredClone(f.simulation);
    f = act(f, { type: "feed_batch", id: "m08", batches: 6 });
    expect(f.simulation).toEqual(inventory);
    expect(validateSave(toSave(f), user.id).simulation).toEqual(f.simulation);
    f = editFactory(f, { kind: "delete", id: "m08" });
    expect(f.simulation.warehouse.i0055).toBe(107);
    expect(f.simulation.warehouse.i0057).toBe(103);
    expect(f.simulation.warehouse.i0054).toBe(100);
  });
  it("clamps excessive requested batches to per-item capacity or current stock and can refill after real production", () => {
    let f = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1039",
    });
    const recipe = recipeDefinitions.get("r1039")!;
    for (const id of Object.keys(recipe.inputs))
      f.simulation.warehouse[id] = 500;
    f = act(f, { type: "feed_batch", id: "m08", batches: 1e100 });
    expect(f.simulation.buildings.m08.input).toEqual([
      { item: "i0055", count: 100 },
      { item: "i0057", count: 100 },
      { item: "i0054", count: 50 },
    ]);
    f = advance(f, recipe.duration_ms / 1000);
    expect(f.simulation.buildings.m08.output).toEqual([
      { item: "i0059", count: 1 },
    ]);
    f = act(f, { type: "feed_batch", id: "m08", batches: 999 });
    expect(f.simulation.buildings.m08.input.map((s) => s.count)).toEqual([
      100, 100, 50,
    ]);
    expect(f.simulation.warehouse.i0055).toBe(398);
    expect(f.simulation.warehouse.i0057).toBe(398);
    expect(f.simulation.warehouse.i0054).toBe(449);
    let scarce = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1039",
    });
    Object.assign(scarce.simulation.warehouse, {
      i0055: 14,
      i0057: 100,
      i0054: 100,
    });
    scarce = act(scarce, { type: "feed_batch", id: "m08", batches: 100 });
    expect(scarce.simulation.buildings.m08.input.map((s) => s.count)).toEqual([
      14, 14, 7,
    ]);
    expect(scarce.simulation.warehouse.i0055).toBe(0);
  });
  it("rejects invalid batch counts or a missing first batch atomically and keeps old no-count requests working", () => {
    let f = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1039",
    });
    Object.assign(f.simulation.warehouse, { i0055: 10, i0057: 1, i0054: 10 });
    const before = structuredClone(f);
    expect(() => act(f, { type: "feed_batch", id: "m08", batches: 9 })).toThrow(
      "无法容纳一批",
    );
    expect(f).toEqual(before);
    f.simulation.warehouse.i0057 = 10;
    const full = structuredClone(f);
    for (const batches of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => act(f, { type: "feed_batch", id: "m08", batches })).toThrow(
        "正整数",
      );
      expect(f).toEqual(full);
    }
    f = act(f, { type: "feed_batch", id: "m08" });
    expect(f.simulation.buildings.m08.input.map((s) => s.count)).toEqual([
      2, 2, 1,
    ]);
  });
  it("charges heat separately from chemical ingredients, retains burn energy and rejects batteries as fuel", () => {
    let f = act(install(start(), "m05"), {
      type: "recipe",
      id: "m05",
      recipe: "r1017",
    });
    const r = recipeDefinitions.get("r1017")!;
    Object.assign(f.simulation.warehouse, r.inputs);
    f = act(f, { type: "feed_batch", id: "m05" });
    f = advance(f, 4);
    expect(f.simulation.buildings.m05.status).toBe("no_energy");
    f.simulation.warehouse[itemID("干燥生物质")] = 1;
    f = act(f, {
      type: "fuel",
      id: "m05",
      item: itemID("干燥生物质"),
      count: 1,
    });
    f = advance(f, r.duration_ms / 1000);
    expect(f.simulation.buildings.m05.input).toEqual([]);
    expect(f.simulation.buildings.m05.energy_kj).toBe(
      280 - (r.power_kw! * r.duration_ms) / 1000,
    );
    expect(f.simulation.buildings.m05.fuel).toEqual([]);
    expect(() =>
      act(f, { type: "fuel", id: "m05", item: itemID("废电池"), count: 1 }),
    ).toThrow();
    expect(
      validateSave(toSave(f), user.id).simulation.buildings.m05.energy_kj,
    ).toBe(f.simulation.buildings.m05.energy_kj);
  });
  it("unlocks the next stage only after claiming the manufacturing quest, without consuming the milestone", () => {
    let f = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1040",
    });
    const r = recipeDefinitions.get("r1040")!;
    Object.assign(f.simulation.warehouse, r.inputs);
    f = act(f, { type: "feed_batch", id: "m08" });
    f = advance(f, r.duration_ms / 1000);
    expect(f.simulation.industry?.stage).toBe(1);
    f.simulation.industry!.quests!.completed.push(
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
    );
    claimQuest(f, "p1_free_hands");
    expect(f.simulation.industry?.stage).toBe(2);
    f = act(f, { type: "collect", id: "m08" });
    expect(f.simulation.warehouse[itemID("流水线机械手")]).toBe(1);
    expect(f.simulation.industry?.milestones).toEqual([itemID("流水线机械手")]);
  });
  it("upgrades old rules without deleting legacy machines, inventories or tick", () => {
    let f = editFactory(start(), {
      kind: "place",
      id: "legacy",
      building_type: "miner",
      placement: { x: 1, y: 0, rotation: 0 },
    });
    f = advance(f, 3);
    const old = {
      format_version: 1,
      rules_version: 1,
      factory: structuredClone(f),
    };
    delete old.factory.simulation.industry;
    const upgraded = validateSave(old, user.id);
    expect(upgraded.simulation.tick).toBe(3);
    expect(upgraded.simulation.buildings.legacy.output[0].count).toBe(3);
    expect(upgraded.simulation.industry?.stage).toBe(1);
    expect(toSave(upgraded).rules_version).toBe(2);
  });
});
