import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import {
  createLocalFactory,
  editFactory,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { simulationSecond as step } from "./testTime";
import { fuelAvailable } from "./fuel";
import type { IndustryAction } from "./industry";

const user = {
  id: "engineer",
  username: "engineer",
  display_name: "工程师",
  created_at: "now",
  last_login_at: "now",
};
function start() {
  const f = createLocalFactory(user, "动力厂");
  f.simulation.industry!.stage = 6;
  f.simulation.industry!.quests!.completed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  f.simulation.industry!.quests!.claimed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  f.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  return f;
}
function place(f: LocalFactory, id: string, type: string, x: number, y = 0) {
  const item = buildingDefinitions.get(type)!.item;
  if (item)
    f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + 1;
  return editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}
const act = (f: LocalFactory, action: IndustryAction) =>
  editFactory(f, { kind: "industry", action });
const advance = (f: LocalFactory, n: number) => {
  for (let i = 0; i < n; i++) f = step(f);
  return f;
};
function configure(f: LocalFactory, id: string, recipe: string, batches = 1) {
  f = act(f, { type: "recipe", id, recipe });
  f.simulation.buildings[id].input = Object.entries(
    recipeDefinitions.get(recipe)!.inputs,
  ).map(([item, n]) => ({ item, count: n * batches }));
  return f;
}
const remainingFuel = (f: LocalFactory, id: string) =>
  fuelAvailable(
    f.simulation.buildings[id],
    buildingDefinitions.get(
      f.buildings.find((b) => b.id === id)!.building_type,
    )!,
  );
function poweredMachine(type: string, recipe?: string) {
  let f = place(start(), "gen", "m28", 2);
  f = place(f, "wire", "cable", 3);
  f = place(f, "load", type, 4);
  f.simulation.buildings.gen.fuel = [{ item: itemID("液体燃料"), count: 1 }];
  return configure(
    f,
    "load",
    recipe ?? catalog.recipes.find((r) => r.building_type === type)!.id,
    4,
  );
}

describe("power networks and conserved energy", () => {
  it("charges actual shaft work plus loss, and retains material until the batch completes", () => {
    let f = place(start(), "gen", "m09", 2);
    f = place(f, "shaft", "shaft", 3);
    f = place(f, "load", "m10", 4);
    const recipe = catalog.recipes.find((r) => r.building_type === "m10")!;
    f = configure(f, "load", recipe.id);
    f.simulation.buildings.gen.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    const input = structuredClone(f.simulation.buildings.load.input);
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(1);
    expect(f.simulation.buildings.load.input).toEqual(input);
    expect(f.simulation.networks?.[0].supplied_kw).toBe(9);
    expect(f.simulation.networks?.[0].loss_kw).toBe(1);
    expect(remainingFuel(f, "gen")).toBe(1980 - 10);
    expect(f.simulation.buildings.gen.generated_kw).toBe(10);
  });
  it("accumulates partial power proportionally rather than working at full speed on a small supply", () => {
    let f = poweredMachine("m51");
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(0);
    expect(f.simulation.buildings.load.work_energy_kj).toBe(160);
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(0.5);
    expect(f.simulation.buildings.load.work_energy_kj).toBe(80);
    const restored = validateSave(toSave(f), user.id);
    expect(step(restored)).toEqual(step(f));
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(1);
    expect(f.simulation.buildings.load.work_energy_kj).toBe(0);
    expect(remainingFuel(f, "gen")).toBe(6400 - 450);
  });
  it("parallels three generators without over-drawing any rate or burning extra fuel", () => {
    let f = start();
    for (let i = 0; i < 3; i++) {
      f = place(f, `wire${i}`, "cable", i, 2);
      f = place(f, `gen${i}`, "m28", i, 3);
      f.simulation.buildings[`gen${i}`].fuel = [
        { item: itemID("液体燃料"), count: 1 },
      ];
    }
    f = place(f, "load", "m51", 1, 1);
    f = configure(
      f,
      "load",
      catalog.recipes.find((r) => r.building_type === "m51")!.id,
    );
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(1);
    expect(f.simulation.networks?.[0].supplied_kw).toBe(450);
    expect(
      [0, 1, 2].reduce((sum, i) => sum + remainingFuel(f, `gen${i}`), 0),
    ).toBe(3 * 6400 - 450);
    for (let i = 0; i < 3; i++)
      expect(
        f.simulation.buildings[`gen${i}`].generated_kw,
      ).toBeLessThanOrEqual(160);
  });
  it("rotates equal-priority brownout work and prioritizes critical consumers explicitly", () => {
    let f = poweredMachine("m51");
    f = place(f, "other", "m51", 3, 1);
    f = configure(
      f,
      "other",
      catalog.recipes.find((r) => r.building_type === "m51")!.id,
      4,
    );
    const critical = act(f, { type: "power_config", id: "load", priority: 1 });
    const priorityResult = advance(critical, 1);
    expect(priorityResult.simulation.buildings.load.work_energy_kj).toBe(160);
    expect(priorityResult.simulation.buildings.other.work_energy_kj ?? 0).toBe(
      0,
    );
    f = advance(f, 6);
    expect(f.simulation.buildings.load.progress).toBe(1);
    expect(f.simulation.buildings.other.progress).toBe(1);
    expect(
      (f.simulation.buildings.load.work_energy_kj ?? 0) +
        (f.simulation.buildings.other.work_energy_kj ?? 0),
    ).toBe(60);
    expect(remainingFuel(f, "gen")).toBe(6400 - 960);
  });
  it("does not burn fuel for a full output or an unconnected consumer, and cannot use stale saved power", () => {
    let f = poweredMachine("m30");
    const recipe = catalog.recipes.find((r) => r.building_type === "m30")!;
    f.simulation.buildings.load.output = Object.keys(recipe.outputs).map(
      (item) => ({ item, count: 100 }),
    );
    f = advance(f, 5);
    expect(remainingFuel(f, "gen")).toBe(6400);
    expect(f.simulation.buildings.load.status).toBe("output_full");
    f = act(f, { type: "collect", id: "load" });
    f = editFactory(f, { kind: "delete", id: "wire" });
    f.simulation.buildings.load.powered = true;
    f.simulation.buildings.load.supplied_kw = 1000;
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(0);
    expect(f.simulation.buildings.load.supplied_kw).toBe(0);
    expect(f.simulation.buildings.load.status).toBe("no_energy");
    expect(remainingFuel(f, "gen")).toBe(6400);
  });
  it("conducts shaft, hydraulic and electric power across any orthogonally touching buildings including disabled ones, without bridging diagonals", () => {
    let f = place(start(), "shaftGen", "m09", 1, 0);
    f = place(f, "disabledRelay", "m01", 2, 0);
    f = act(f, { type: "power_config", id: "disabledRelay", enabled: false });
    f = place(f, "chestRelay", "chest", 3, 0);
    f = place(f, "elecGen", "m28", 3, 1);
    f = place(f, "shaftBelt1", "mechanical_belt", 4, 0);
    f = place(f, "shaftBelt2", "mechanical_belt", 5, 0);
    f = place(f, "elecLoad", "m30", 6, 0);
    f = place(f, "diagonalLoad", "m10", 7, 1);
    f.simulation.buildings.shaftGen.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    f.simulation.buildings.elecGen.fuel = [
      { item: itemID("液体燃料"), count: 1 },
    ];
    f.simulation.buildings.shaftBelt1.belt = {
      id: "b1",
      item: itemID("铁质碎片"),
      count: 2,
      progress: 0,
    };
    f = configure(
      f,
      "elecLoad",
      catalog.recipes.find((r) => r.building_type === "m30")!.id,
    );
    f = configure(
      f,
      "diagonalLoad",
      catalog.recipes.find((r) => r.building_type === "m10")!.id,
    );
    f.buildings.find((b) => b.id === "elecLoad")!.configuration.power_side = 0;
    f = step(f);
    expect(f.simulation.buildings.elecLoad.progress).toBe(1);
    expect(f.simulation.buildings.shaftBelt2.belt?.count).toBe(2);
    expect(f.simulation.buildings.diagonalLoad.progress).toBe(0);
    expect(f.simulation.buildings.diagonalLoad.network_id).toBeUndefined();
    expect(f.simulation.networks?.map((n) => n.kind)).toEqual([
      "shaft",
      "electric",
    ]);
  });
  it("stores 88% at the input rate, stops charging with the generator off, and discharges only real energy", () => {
    let f = place(start(), "gen", "m28", 2);
    f = place(f, "wire", "cable", 3);
    f = place(f, "battery", "battery", 4);
    f.simulation.buildings.gen.fuel = [{ item: itemID("液体燃料"), count: 1 }];
    f = step(f);
    expect(f.simulation.buildings.battery.charge_kj).toBe(88);
    expect(remainingFuel(f, "gen")).toBe(6300);
    expect(f.simulation.networks?.[0].charge_kw).toBe(100);
    f = act(f, { type: "power_config", id: "gen", enabled: false });
    f = advance(f, 10);
    expect(f.simulation.buildings.battery.charge_kj).toBe(88);
    f = place(f, "load", "m30", 3, 1);
    f = configure(
      f,
      "load",
      catalog.recipes.find((r) => r.building_type === "m30")!.id,
    );
    f = advance(f, 5);
    expect(f.simulation.buildings.load.progress).toBe(4);
    expect(f.simulation.buildings.load.work_energy_kj).toBe(8);
    expect(f.simulation.buildings.battery.charge_kj).toBe(0);
    expect(f.simulation.buildings.battery.supplied_kw).toBe(0);
    expect(f.simulation.networks?.[0].charge_kw).toBe(0);
  });
  it("keeps a reserve for critical loads and never transfers charge from one battery into another", () => {
    let f = place(start(), "wire", "cable", 3);
    f = place(f, "battery", "battery", 4);
    f = place(f, "empty", "battery", 2);
    f = place(f, "load", "m30", 3, 1);
    f = configure(
      f,
      "load",
      catalog.recipes.find((r) => r.building_type === "m30")!.id,
    );
    f.simulation.buildings.battery.charge_kj = 20;
    f = act(f, { type: "power_config", id: "battery", reserve_kj: 20 });
    f = advance(f, 4);
    expect(f.simulation.buildings.battery.charge_kj).toBe(20);
    expect(f.simulation.buildings.empty.charge_kj ?? 0).toBe(0);
    expect(f.simulation.buildings.load.progress).toBe(0);
    f = act(f, { type: "power_config", id: "load", priority: 1 });
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(1);
    expect(f.simulation.buildings.battery.charge_kj).toBe(0);
    expect(f.simulation.buildings.empty.charge_kj ?? 0).toBe(0);
  });
  it("preserves fractional charging, caps capacity, and honors hold/charge-only modes", () => {
    let f = place(start(), "gen", "m28", 2);
    f = place(f, "wire", "cable", 3);
    f = place(f, "battery", "battery", 4);
    f.simulation.buildings.gen.energy_kj = 1;
    f = step(f);
    expect(f.simulation.buildings.battery.charge_kj).toBe(0);
    expect(f.simulation.buildings.battery.charge_remainder).toBe(88);
    expect(step(validateSave(toSave(f), user.id))).toEqual(step(f));
    f.simulation.buildings.gen.fuel = [{ item: itemID("液体燃料"), count: 1 }];
    f = act(f, { type: "power_config", id: "battery", battery_mode: "hold" });
    f = step(f);
    expect(remainingFuel(f, "gen")).toBe(6400);
    f = act(f, { type: "power_config", id: "battery", battery_mode: "charge" });
    f.simulation.buildings.battery.charge_kj = 14999;
    f.simulation.buildings.battery.charge_remainder = 0;
    f = step(f);
    expect(f.simulation.buildings.battery.charge_kj).toBe(15000);
    expect(f.simulation.buildings.battery.charge_remainder).toBe(0);
    expect(remainingFuel(f, "gen")).toBe(6398.5);
    f = place(f, "load", "m30", 3, 1);
    f = configure(
      f,
      "load",
      catalog.recipes.find((r) => r.building_type === "m30")!.id,
    );
    f = act(f, { type: "power_config", id: "gen", enabled: false });
    f = step(f);
    expect(f.simulation.buildings.load.progress).toBe(0);
    expect(f.simulation.buildings.battery.charge_kj).toBe(15000);
  });
  it("uses real boiler steam to start distillation without any hydraulic power", () => {
    let f = place(start(), "tower", "m20", 2);
    f = configure(f, "tower", "r3007");
    f.simulation.buildings.tower.fuel = [
      { item: itemID("高压蒸汽"), count: 4 },
    ];
    f = advance(f, 16);
    expect(f.simulation.buildings.tower.output).toEqual(
      Object.entries(recipeDefinitions.get("r3007")!.outputs)
        .map(([item, count]) => ({ item, count }))
        .sort((a, b) => (a.item < b.item ? -1 : 1)),
    );
    expect(f.simulation.buildings.tower.fuel).toEqual([]);
    expect(f.simulation.buildings.tower.energy_kj).toBe(80);
  });
  it("cold-mixes its own working fluid, primes a real unit, charges compression and then supplies a hydraulic consumer", () => {
    let f = place(start(), "hyd", "m21", 2);
    f = configure(f, "hyd", "r3012", 2);
    f.simulation.buildings.hyd.fuel = [{ item: itemID("液体燃料"), count: 1 }];
    f = advance(f, 22);
    expect(f.simulation.buildings.hyd.medium ?? 0).toBe(0);
    expect(remainingFuel(f, "hyd")).toBe(6080);
    f = act(f, { type: "collect", id: "hyd" });
    expect(f.simulation.warehouse[itemID("液压工作液")]).toBe(4);
    f = act(f, { type: "prime", id: "hyd", count: 1 });
    expect(f.simulation.warehouse[itemID("液压工作液")]).toBe(3);
    f.simulation.warehouse[itemID("净化水")] = 1;
    f = act(f, { type: "recipe", id: "hyd", recipe: "r3013" });
    f = act(f, { type: "feed_batch", id: "hyd" });
    f = advance(f, 14);
    expect(remainingFuel(f, "hyd")).toBe(6080 - 280);
    f = act(f, { type: "collect", id: "hyd" });
    f = place(f, "pipe", "hydraulic_line", 3);
    f = place(f, "load", "m22", 4);
    f = act(f, { type: "recipe", id: "load", recipe: "r3015" });
    f.simulation.warehouse[itemID("合金钢坯")] = 3;
    f = act(f, { type: "feed_batch", id: "load" });
    f = advance(f, 14);
    expect(remainingFuel(f, "hyd")).toBe(6080 - 280 - 420);
    expect(
      f.simulation.buildings.load.output.find(
        (s) => s.item === itemID("污工作液"),
      )?.count,
    ).toBe(1);
    expect(
      validateSave(toSave(f), user.id).simulation.buildings.hyd.medium,
    ).toBe(1);
    f = editFactory(f, { kind: "delete", id: "hyd" });
    expect(f.simulation.warehouse[itemID("液压工作液")]).toBe(1);
  });
  it("powers transport through real fuel and preserves battery charge while moving without duplicating it on reinstall", () => {
    let f = place(start(), "gen", "m28", 2);
    f = place(f, "wire", "cable", 3);
    f = place(f, "belt", "electric_belt", 4);
    f.simulation.buildings.gen.fuel = [{ item: itemID("液体燃料"), count: 1 }];
    f.simulation.buildings.belt.belt = {
      id: "batch",
      item: itemID("铁质碎片"),
      count: 3,
      progress: 0,
    };
    f = step(f);
    expect(f.simulation.buildings.belt.belt?.progress).toBe(1);
    expect(remainingFuel(f, "gen")).toBe(6398);
    f = place(f, "battery", "battery", 3, 1);
    f.simulation.buildings.battery.charge_kj = 1234;
    f = editFactory(f, {
      kind: "move",
      id: "battery",
      placement: { x: 3, y: 2, rotation: 0 },
    });
    expect(f.simulation.buildings.battery.charge_kj).toBe(1234);
    f = editFactory(f, { kind: "delete", id: "battery" });
    f = editFactory(f, {
      kind: "place",
      id: "replacement",
      building_type: "battery",
      placement: { x: 3, y: 2, rotation: 0 },
    });
    expect(f.simulation.buildings.replacement.charge_kj ?? 0).toBe(0);
  });
});
