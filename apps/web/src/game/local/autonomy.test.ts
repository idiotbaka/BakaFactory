import { worldSecond as stepWorld } from "./testTime";
import { describe, expect, it } from "vitest";
import {
  catalog,
  buildingDefinitions,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { createWorld, editWorld, actWorld } from "./world";
import { toSave, validateSave, type LocalFactory } from "./state";
import { dispatchRobots } from "./robotAutonomy";

const user = {
  id: "auto-owner",
  username: "auto-owner",
  display_name: "调度员",
  created_at: "now",
  last_login_at: "now",
};
const smart = itemID("智能机器人"),
  recipe = recipeDefinitions.get("r1007")!,
  input = Object.keys(recipe.inputs)[0];
function place(root: LocalFactory, id: string, type: string, x: number, y = 0) {
  root.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
  return editWorld(root, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}
function setup(peers = 1) {
  let root = createWorld(user, "自动调度");
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
  root = place(root, "station", "charge_station", 4);
  root = place(root, "target", "m03", 7);
  root = editWorld(root, {
    kind: "industry",
    action: { type: "recipe", id: "target", recipe: recipe.id },
  });
  root.simulation.warehouse[smart] = peers;
  root.simulation.warehouse[input] = recipe.inputs[input];
  root.buildings[0].configuration.face_0 = { mode: "output", filter: input };
  for (let i = 0; i < peers; i++) {
    root = actWorld(root, {
      type: "robot_deploy",
      id: `r${i}`,
      item: smart,
      station: "station",
      factory_id: root.id,
    });
    // Paid energy fixture, with real station conversion covered separately.
    root.robots![i].energy_kj = 30000;
    root = actWorld(root, {
      type: "robot_autonomy",
      id: `r${i}`,
      config: { enabled: true, refill: true, inspect: false, maintain: false },
    });
  }
  return root;
}
const advance = (r: LocalFactory, n: number) => {
  for (let i = 0; i < n; i++) r = stepWorld(r);
  return r;
};
describe("deterministic authorized robot dispatch", () => {
  it("reserves one shared stock pool across different WH endpoints instead of promising the same units twice", () => {
    let root = setup(2);
    root = place(root, "other-target", "m03", 7, 3);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "other-target", recipe: recipe.id },
    });
    const child = root.districts![0];
    child.buildings[0].configuration.face_0 = { mode: "output", filter: input };
    for (const r of root.robots!)
      root = actWorld(root, {
        type: "robot_config",
        id: r.id,
        allowed_zones: [root.id, child.id],
      });
    dispatchRobots(root);
    expect(root.robots!.filter((r) => r.task)).toHaveLength(1);
    expect(root.robots!.reduce((n, r) => n + (r.task?.count ?? 0), 0)).toBe(
      recipe.inputs[input],
    );
    expect(root.simulation.warehouse[input]).toBe(recipe.inputs[input]);
    expect(root.districts![0].simulation.warehouse).toEqual({});
  });
  it("reserves demand across peers and performs real freight rather than teleporting warehouse stock", () => {
    let root = setup(2);
    dispatchRobots(root);
    expect(root.robots!.filter((r) => r.task)).toHaveLength(1);
    expect(root.simulation.warehouse[input]).toBe(recipe.inputs[input]);
    expect(root.simulation.buildings.target.input).toEqual([]);
    root = advance(root, 70);
    expect(root.simulation.buildings.target.batches_completed).toBe(1);
    expect(root.simulation.warehouse[input]).toBe(0);
    expect(root.robots!.reduce((n, r) => n + (r.completed_tasks ?? 0), 0)).toBe(
      1,
    );
    expect(
      root.robots!.some((r) =>
        r.behavior_log?.some((e) => e.kind === "refill"),
      ),
    ).toBe(true);
  });
  it("honors device priority, role restrictions, permissions and reproducible save/reload decisions", () => {
    let root = setup();
    root = place(root, "urgent", "m03", 7, 4);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "urgent", recipe: recipe.id },
    });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "power_config", id: "urgent", priority: 1 },
    });
    const saved = validateSave(toSave(root), user.id);
    expect(advance(root, 3)).toEqual(advance(saved, 3));
    dispatchRobots(root);
    expect(root.robots![0].task?.target.building_id).toBe("urgent");
    root.robots![0].autonomy!.next_tick = root.simulation.tick + 11;
    expect(() => validateSave(toSave(root), user.id)).toThrow();
    const wrong = setup();
    wrong.robots![0].item = itemID("电动物流机器人");
    expect(() =>
      actWorld(wrong, {
        type: "robot_autonomy",
        id: "r0",
        config: {
          enabled: true,
          refill: true,
          inspect: false,
          maintain: false,
        },
      }),
    ).toThrow();
  });
  it("rolls back rejected proposals and never uses a warehouse input face as an output", () => {
    for (const wall of [false, true]) {
      let root = setup();
      if (wall) root = place(root, "wall", "chest", 1);
      else
        root.buildings[0].configuration.face_0 = { mode: "input", filter: "" };
      const stock = structuredClone(root.simulation.warehouse);
      dispatchRobots(root);
      expect(root.robots![0].task).toBeUndefined();
      expect(root.simulation.warehouse).toEqual(stock);
      expect(root.robots![0].energy_kj).toBe(30000);
      expect(root.robots![0].behavior_log!.at(-1)?.kind).toBe("waiting");
    }
  });
  it("requires explicit cross-district permission before proposing a remote refill", () => {
    let root = setup();
    const child = root.districts![0].id;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "power_config", id: "target", enabled: false },
    });
    root = actWorld(root, { type: "select_district", id: child });
    root = place(root, "remote", "m03", 7);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "remote", recipe: recipe.id },
    });
    root = actWorld(root, { type: "select_district", id: root.id });
    dispatchRobots(root);
    expect(root.robots![0].task).toBeUndefined();
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id, child],
    });
    root = advance(root, 5);
    expect(root.robots![0].task?.target).toEqual({
      factory_id: child,
      building_id: "remote",
    });
    expect(root.districts![0].simulation.buildings.remote.input).toEqual([]);
    expect(root.simulation.warehouse[input]).toBe(recipe.inputs[input]);
  });
  it("dispatches a real mature inspection only once and keeps its work across reload", () => {
    let root = setup();
    root.robots![0].autonomy!.enabled = false;
    root.simulation.buildings.target.batches_completed = 1;
    root = advance(root, 6);
    root = actWorld(root, {
      type: "robot_autonomy",
      id: "r0",
      config: { enabled: true, refill: false, inspect: true, maintain: false },
    });
    root = advance(root, 2);
    expect(root.robots![0].service?.kind).toBe("inspect");
    const saved = validateSave(toSave(root), user.id);
    root = advance(saved, 40);
    expect(
      root.simulation
        .industry!.work_receipts?.filter((e) => e.kind === "inspection")
        .reduce((n, e) => n + e.count, 0),
    ).toBe(1);
    expect(
      root.robots![0].behavior_log?.filter((e) => e.kind === "inspect"),
    ).toHaveLength(1);
  });
  it("stops new dispatch independently from an already loaded physical task and bounds its journal", () => {
    let root = setup();
    for (let i = 0; i < 100 && !root.robots![0].cargo; i++)
      root = stepWorld(root);
    expect(root.robots![0].cargo).toBeDefined();
    root = actWorld(root, {
      type: "robot_autonomy",
      id: "r0",
      config: { enabled: false, refill: true, inspect: false, maintain: false },
    });
    const task = root.robots![0].task!.id;
    root = advance(root, 2);
    expect(root.robots![0].task?.id).toBe(task);
    root = advance(root, 70);
    expect(root.robots![0].task).toBeUndefined();
    for (let i = 0; i < 30; i++)
      root = actWorld(root, {
        type: "robot_autonomy",
        id: "r0",
        config: {
          enabled: i % 2 === 0,
          refill: false,
          inspect: false,
          maintain: false,
        },
      });
    expect(root.robots![0].behavior_log).toHaveLength(20);
    expect(() => validateSave(toSave(root), user.id)).not.toThrow();
  });
});
