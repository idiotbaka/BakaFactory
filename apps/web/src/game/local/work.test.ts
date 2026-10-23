import { describe, expect, it } from "vitest";
import {
  catalog,
  buildingDefinitions,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { createWorld, editWorld, actWorld, stepWorld } from "./world";
import { toSave, validateSave, type LocalFactory } from "./state";
import { claimWork, recordWork } from "./workLedger";
import { robotDefinitions } from "./robots";
import { matureIncident } from "./incidents";

const user = {
  id: "work-owner",
  username: "work-owner",
  display_name: "检修员",
  created_at: "now",
  last_login_at: "now",
};
const camera = itemID("摄像头组件"),
  parts = itemID("维修备件箱"),
  inspector = itemID("管线巡检机器人"),
  repair = itemID("自动维修机器人");
function place(root: LocalFactory, id: string, type: string, x: number, y = 0) {
  root.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
  return editWorld(root, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}
function setup(item = inspector) {
  let root = createWorld(user, "真实作业");
  root.simulation.industry!.stage = 6;
  root.simulation.industry!.quests!.completed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  root.simulation.industry!.quests!.claimed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  root.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  root = place(
    root,
    "station",
    item === inspector ? "hydraulic_station" : "charge_station",
    4,
  );
  root = place(root, "machine", "m03", 7);
  root = editWorld(root, {
    kind: "industry",
    action: { type: "recipe", id: "machine", recipe: "r1007" },
  });
  root.simulation.warehouse[item] = 1;
  root = actWorld(root, {
    type: "robot_deploy",
    id: "r",
    item,
    station: "station",
    factory_id: root.id,
  });
  // Explicit paid-energy/history fixtures; no services or real data involved.
  root.robots![0].energy_kj = robotDefinitions.get(item)!.energy_capacity_kj;
  return root;
}
function advance(root: LocalFactory, n: number) {
  for (let i = 0; i < n; i++) root = stepWorld(root);
  return root;
}
function until(
  root: LocalFactory,
  p: (root: LocalFactory) => boolean,
  n = 180,
) {
  for (let i = 0; i < n; i++) {
    if (p(root)) return root;
    root = stepWorld(root);
  }
  throw new Error("bounded work scenario did not complete");
}
const inspect = (root: LocalFactory) =>
  actWorld(root, {
    type: "robot_service",
    id: "r",
    kind: "inspect",
    target: { factory_id: root.id, building_id: "machine" },
  });
const maintain = (root: LocalFactory) =>
  actWorld(root, {
    type: "robot_service",
    id: "r",
    kind: "maintain",
    target: { factory_id: root.id, building_id: "machine" },
  });
const credits = (root: LocalFactory, kind: string) =>
  root.simulation
    .industry!.work_receipts?.filter((r) => r.kind === kind)
    .reduce((n, r) => n + r.count, 0) ?? 0;
function starving() {
  const root = setup();
  root.simulation.buildings.machine.batches_completed = 1;
  return advance(root, 6);
}
function blocked() {
  const root = setup(repair),
    r = recipeDefinitions.get("r1007")!;
  root.simulation.buildings.machine.input = Object.entries(r.inputs).map(
    ([item, count]) => ({ item, count }),
  );
  root.simulation.buildings.machine.output = Object.keys(r.outputs).map(
    (item) => ({ item, count: 100 }),
  );
  root.simulation.warehouse[parts] = 1;
  return advance(root, 6);
}
describe("real work episodes and consumable training credits", () => {
  it("does not treat new empty machines, docking or charging as evidence", () => {
    const root = advance(setup(), 45);
    expect(root.simulation.buildings.machine.incident).toBeUndefined();
    expect(credits(root, "inspection")).toBe(0);
    expect(() => inspect(root)).toThrow(/异常/);
  });
  it("requires five real seconds, walks to the scene, pays full work and awards only once per episode", () => {
    let root = setup();
    root.simulation.buildings.machine.batches_completed = 1;
    root = advance(root, 2);
    expect(
      matureIncident(root.simulation.buildings.machine, root.simulation.tick),
    ).toBe(false);
    expect(() => inspect(root)).toThrow();
    root = advance(root, 4);
    root = inspect(root);
    const energy = root.robots![0].energy_kj;
    root = until(root, (f) => f.robots![0].status === "inspecting");
    expect(root.robots![0].x).toBe(6);
    expect(credits(root, "inspection")).toBe(0);
    const paused = actWorld(root, {
      type: "robot_config",
      id: "r",
      enabled: false,
    });
    const still = advance(paused, 10);
    expect(still.robots![0].work_progress).toBe(
      paused.robots![0].work_progress,
    );
    root = actWorld(still, { type: "robot_config", id: "r", enabled: true });
    root = until(root, (f) => credits(f, "inspection") === 1);
    expect(root.robots![0].energy_kj).toBeLessThanOrEqual(energy - 31);
    root = until(root, (f) => !f.robots![0].service);
    expect(root.simulation.buildings.machine.incident?.inspected).toBe(true);
    expect(() => inspect(root)).toThrow();
    root = advance(validateSave(toSave(root), user.id), 40);
    expect(credits(root, "inspection")).toBe(1);
  });
  it("abandons a resolved scene and returns unused parts physically after cancellation", () => {
    let root = starving();
    root = inspect(root);
    root = until(root, (f) => f.robots![0].status === "inspecting");
    root = editWorld(root, {
      kind: "industry",
      action: { type: "power_config", id: "machine", enabled: false },
    });
    root = until(root, (f) => !f.robots![0].service);
    expect(credits(root, "inspection")).toBe(0);
    root = maintain(blocked());
    root = until(root, (f) => f.robots![0].status === "maintaining");
    expect(root.simulation.warehouse[parts]).toBe(0);
    root = actWorld(root, { type: "robot_return", id: "r" });
    expect(root.simulation.warehouse[parts]).toBe(0);
    expect(() => actWorld(root, { type: "robot_recall", id: "r" })).toThrow();
    root = until(root, (f) => !f.robots![0].service);
    expect(root.simulation.warehouse[parts]).toBe(1);
    expect(credits(root, "inspection")).toBe(0);
    expect(
      root.simulation.buildings.machine.output.every((s) => s.count === 100),
    ).toBe(true);
  });
  it("consumes a real kit only after removing real blockage and saves cargo until return", () => {
    let root = maintain(blocked());
    root = until(root, (f) => !!f.robots![0].cargo);
    const load = root.robots![0].cargo!;
    expect(load.count).toBe(6);
    expect(
      root.simulation.buildings.machine.output.find((s) => s.item === load.item)
        ?.count,
    ).toBe(94);
    expect(root.robots![0].service?.parts).toBe(0);
    expect(root.simulation.warehouse[parts]).toBe(0);
    expect(credits(root, "inspection")).toBe(1);
    root = validateSave(toSave(root), user.id);
    root = until(root, (f) => !f.robots![0].service);
    expect(root.simulation.warehouse[load.item]).toBe(6);
    expect(root.simulation.warehouse[parts]).toBe(0);
  });
  it("uses a real camera attachment and cannot duplicate it by equipping or recalling", () => {
    let root = starving();
    expect(() =>
      actWorld(root, { type: "robot_camera", id: "r", equipped: true }),
    ).toThrow();
    root.simulation.warehouse[camera] = 1;
    root = actWorld(root, { type: "robot_camera", id: "r", equipped: true });
    root = actWorld(root, { type: "robot_camera", id: "r", equipped: true });
    expect(root.simulation.warehouse[camera]).toBe(0);
    root = until(inspect(root), (f) => !f.robots![0].service);
    expect(credits(root, "visual")).toBe(1);
    root = actWorld(root, { type: "robot_recall", id: "r" });
    expect(root.simulation.warehouse[camera]).toBe(1);
    expect(root.simulation.industry!.work_receipts).toEqual([]);
  });
  it("filters active roles, consumes exactly once, and does not redeem lifetime completed_tasks", () => {
    const root = starving(),
      r = root.robots![0],
      recipe = recipeDefinitions.get("r5049")!;
    r.completed_tasks = 999;
    expect(claimWork(root, recipe)).toBe(false);
    for (let i = 0; i < 20; i++) recordWork(root, r, "inspection");
    r.enabled = false;
    expect(claimWork(root, recipe)).toBe(false);
    r.enabled = true;
    expect(claimWork(root, recipe)).toBe(true);
    expect(credits(root, "inspection")).toBe(20);
    expect(claimWork(root, recipe, true)).toBe(true);
    expect(claimWork(root, recipe, true)).toBe(false);
    r.camera = true;
    for (let i = 0; i < 30; i++) recordWork(root, r, "inspection");
    expect(claimWork(root, recipeDefinitions.get("r5050")!, true)).toBe(true);
    expect(credits(root, "inspection")).toBe(30);
    expect(credits(root, "visual")).toBe(0);
    expect(claimWork(root, recipeDefinitions.get("r5048")!)).toBe(false);
  });
  it("settles two training machines against one shared ledger at batch completion with real fuel", () => {
    let root = starving();
    root = place(root, "generator", "m28", 1, 5);
    root = place(root, "line", "cable", 2, 5);
    root = place(root, "trainer-a", "m46", 3, 5);
    root = place(root, "trainer-b", "m46", 2, 6);
    root.simulation.buildings.generator.fuel = [
      { item: itemID("液体燃料"), count: 2 },
    ];
    const recipe = recipeDefinitions.get("r5049")!;
    for (const id of ["trainer-a", "trainer-b"]) {
      root = editWorld(root, {
        kind: "industry",
        action: { type: "recipe", id, recipe: recipe.id },
      });
      root.simulation.buildings[id].input = Object.entries(recipe.inputs).map(
        ([item, count]) => ({ item, count }),
      );
      root.simulation.buildings[id].progress = 18;
    }
    for (let i = 0; i < 20; i++)
      recordWork(root, root.robots![0], "inspection");
    const original = structuredClone(root);
    root = stepWorld(root);
    const produced = ["trainer-a", "trainer-b"].reduce(
      (n, id) =>
        n +
        root.simulation.buildings[id].output.reduce((n, s) => n + s.count, 0),
      0,
    );
    expect(produced).toBe(4);
    expect(credits(root, "inspection")).toBe(0);
    expect(credits(original, "inspection")).toBe(20);
    expect(
      ["trainer-a", "trainer-b"].filter(
        (id) => root.simulation.buildings[id].input.length > 0,
      ),
    ).toHaveLength(1);
  });
  it("bounds receipts and rejects null, repeated or mismatched service/save data", () => {
    const root = starving();
    for (const mutate of [
      (f: LocalFactory) => {
        f.simulation.industry!.work_receipts = [
          {
            kind: "inspection",
            robot_id: "r",
            robot_item: inspector,
            count: 10001,
            last_tick: f.simulation.tick,
          },
        ];
      },
      (f: LocalFactory) => {
        f.simulation.buildings.machine.incident!.since_tick =
          f.simulation.tick + 1;
      },
      (f: LocalFactory) => {
        f.robots![0].service = {
          kind: "maintain",
          target: { factory_id: f.id, building_id: "machine" },
          since_tick: 0,
          parts: 1,
        };
      },
    ]) {
      const bad = structuredClone(root);
      mutate(bad);
      expect(() => validateSave(toSave(bad), user.id)).toThrow();
    }
    const bad = JSON.parse(JSON.stringify(toSave(root)));
    bad.factory.simulation.industry.work_receipts = null;
    expect(() => validateSave(bad, user.id)).toThrow();
  });
  it("shares consumable credits across factories and does not spend them on blocked batches or recipe switches", () => {
    let root = starving();
    root = place(root, "trainer", "m46", 8, 5);
    const recipe = recipeDefinitions.get("r5049")!;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "trainer", recipe: recipe.id },
    });
    const input = Object.entries(recipe.inputs).map(([item, count]) => ({
      item,
      count,
    }));
    root.simulation.buildings.trainer.input = structuredClone(input);
    root.simulation.buildings.trainer.progress = 18;
    root.simulation.buildings.trainer.work_energy_kj = 50;
    root.simulation.buildings.trainer.output = [
      { item: Object.keys(recipe.outputs)[0], count: 100 },
    ];
    for (let i = 0; i < 20; i++)
      recordWork(root, root.robots![0], "inspection");
    root = stepWorld(root);
    expect(credits(root, "inspection")).toBe(20);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "trainer", recipe: "r5048" },
    });
    expect(credits(root, "inspection")).toBe(20);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "trainer", recipe: recipe.id },
    });
    root.simulation.buildings.trainer.output = [];
    root.simulation.buildings.trainer.progress = 18;
    root.simulation.buildings.trainer.work_energy_kj = 50;
    const child = root.districts![0],
      template = root.buildings.find((b) => b.id === "trainer")!;
    // A second site with an equally paid final second: only the single world
    // ledger may be spent, regardless of which site finishes first.
    child.buildings.push({
      ...structuredClone(template),
      id: "remote-trainer",
      factory_id: child.id,
    });
    child.simulation.buildings["remote-trainer"] = structuredClone(
      root.simulation.buildings.trainer,
    );
    root = stepWorld(root);
    const remote = root.districts![0].simulation.buildings["remote-trainer"];
    expect(root.simulation.buildings.trainer.output[0]?.count).toBe(4);
    expect(remote.output).toEqual([]);
    expect(remote.input).toEqual(input);
    expect(root.districts![0].robots).toBeUndefined();
    expect(credits(root, "inspection")).toBe(0);
    expect(() => validateSave(toSave(root), user.id)).not.toThrow();
  });
});
