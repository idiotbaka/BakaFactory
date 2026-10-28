import { describe, expect, it } from "vitest";
import { rectangleSelection } from "../batchSelection";
import { actWorld, createWorld, editWorld, projectFactory } from "./world";
import { catalog, buildingDefinitions, itemID } from "./catalog";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";

const user = {
  id: "batch-owner",
  username: "batch",
  display_name: "框选",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板");
function start() {
  const f = createWorld(user, "批量编辑");
  const p = f.simulation.industry!;
  p.stage = 6;
  p.quests!.completed = catalog
    .quests!.filter((q) => q.stage_final && q.tier < 6)
    .map((q) => q.id);
  p.quests!.claimed = [...p.quests!.completed];
  p.milestones = catalog.stages!.slice(0, 5).map((s) => s.milestone_item);
  return f;
}
function node(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  size?: 2,
) {
  f.buildings.push({
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    size,
    rotation: 0,
    configuration: {},
  });
  f.simulation.buildings[id] = newMachine();
}
function pair(f: LocalFactory) {
  f.simulation.warehouse.d0001 = 1;
  return editWorld(f, {
    kind: "place_underground",
    id: "entry",
    exitID: "exit",
    entry: { x: -5, y: 4, rotation: 0 },
    exit: { x: 1, y: 4, rotation: 0 },
  });
}
const select = (f: LocalFactory, x: number, y: number) =>
  rectangleSelection(projectFactory(f), catalog.buildings, { x, y }, { x, y });

describe("atomic batch editing", () => {
  it("selects a whole 2x2 instance from its covered corner and expands either paired endpoint", () => {
    const f = pair(start());
    node(f, "large", "m08", 3, 3, 2);
    expect(select(f, 4, 2)).toEqual(["large"]);
    expect(select(f, -5, 4)).toEqual(["entry", "exit"]);
    expect(select(f, 1, 4)).toEqual(["entry", "exit"]);
    expect(select(f, 0, 0)).toEqual([]);
  });

  it("moves into group members' former cells in one revision, preserving identity and state", () => {
    const f = start();
    node(f, "a", "hand_belt", 2, 2);
    node(f, "b", "hand_belt", 3, 2);
    f.simulation.buildings.a.belt = {
      id: "load",
      item: iron,
      count: 2,
      progress: 1,
    };
    const before = structuredClone(f);
    const next = editWorld(f, {
      kind: "batch_move",
      ids: ["a", "b"],
      dx: 1,
      dy: 0,
    });
    expect(next.buildings.find((b) => b.id === "a")).toMatchObject({
      x: 3,
      y: 2,
    });
    expect(next.buildings.find((b) => b.id === "b")).toMatchObject({
      x: 4,
      y: 2,
    });
    expect(next.simulation).toEqual(f.simulation);
    expect(next.revision).toBe(f.revision + 1);
    expect(f).toEqual(before);
    expect(validateSave(toSave(next), user.id).buildings).toEqual(
      next.buildings,
    );
  });

  it("translates both tunnel ends in either axis and preserves pair span, role and real load", () => {
    const f = pair(start());
    f.simulation.buildings.exit.belt = {
      id: "tunnel-load",
      item: iron,
      count: 3,
      progress: 0,
    };
    const next = editWorld(f, {
      kind: "batch_move",
      ids: ["entry"],
      dx: 2,
      dy: -3,
    });
    expect(next.buildings.find((b) => b.id === "entry")).toMatchObject({
      x: -3,
      y: 1,
      configuration: f.buildings.find((b) => b.id === "entry")!.configuration,
    });
    expect(next.buildings.find((b) => b.id === "exit")).toMatchObject({
      x: 3,
      y: 1,
    });
    expect(next.simulation.buildings).toEqual(f.simulation.buildings);
    expect(validateSave(toSave(next), user.id).buildings).toEqual(
      next.buildings,
    );
  });

  it("rejects collisions on any footprint, bounds, invalid offsets and missing IDs without partial edits", () => {
    const f = start();
    node(f, "large", "m08", 2, 3, 2);
    node(f, "belt", "hand_belt", -3, 2);
    node(f, "wall", "chest", 5, 2);
    const before = structuredClone(f);
    for (const edit of [
      { kind: "batch_move", ids: ["belt", "large"], dx: 2, dy: 0 },
      { kind: "batch_move", ids: ["belt", "large"], dx: 8, dy: 0 },
      { kind: "batch_move", ids: ["belt"], dx: 0.5, dy: 0 },
      { kind: "batch_move", ids: ["belt", "missing"], dx: 1, dy: 0 },
    ] as const) {
      expect(() => editWorld(f, { ...edit, ids: [...edit.ids] })).toThrow();
      expect(f).toEqual(before);
    }
  });

  it("keeps waste ports on the top row and excludes protected terminals and WH", () => {
    const f = start();
    node(f, "waste", "waste_port", 2, 10);
    node(f, "terminal", "warehouse_pickup", 3, 2);
    expect(() =>
      editWorld(f, { kind: "batch_move", ids: ["waste"], dx: 0, dy: -1 }),
    ).toThrow("顶部");
    expect(
      editWorld(f, {
        kind: "batch_move",
        ids: ["waste"],
        dx: 1,
        dy: 0,
      }).buildings.find((b) => b.id === "waste")!.x,
    ).toBe(3);
    expect(select(f, 3, 2)).toEqual([]);
    for (const id of [f.buildings[0].id, "terminal"])
      for (const kind of ["batch_move", "batch_delete"] as const)
        expect(() => editWorld(f, { kind, ids: [id], dx: 1, dy: 0 })).toThrow(
          "保护",
        );
  });

  it("refunds paired kits once and every real buffer once, with one revision", () => {
    const f = pair(start());
    node(f, "large", "m08", 3, 3, 2);
    node(f, "belt", "hand_belt", -3, 2);
    f.simulation.buildings.large.input = [{ item: iron, count: 7 }];
    f.simulation.buildings.large.output = [{ item: iron, count: 5 }];
    f.simulation.buildings.large.progress = 1;
    f.simulation.buildings.belt.belt = {
      id: "belt-load",
      item: iron,
      count: 2,
      progress: 1,
    };
    f.simulation.buildings.exit.belt = {
      id: "tunnel-load",
      item: iron,
      count: 3,
      progress: 0,
    };
    const next = editWorld(f, {
      kind: "batch_delete",
      ids: ["entry", "exit", "large", "belt", "belt"],
    });
    expect(next.buildings).toHaveLength(1);
    expect(next.simulation.warehouse[iron]).toBe(17);
    expect(next.simulation.warehouse.d0001).toBe(1);
    expect(
      next.simulation.warehouse[buildingDefinitions.get("m08")!.item!],
    ).toBe(1);
    expect(next.revision).toBe(f.revision + 1);
    expect(() =>
      editWorld(next, { kind: "batch_delete", ids: ["large"] }),
    ).toThrow();
  });

  it("rolls back all refunds when a later item would overflow", () => {
    const f = start();
    node(f, "a", "hand_belt", 2, 2);
    node(f, "b", "chest", 3, 2);
    f.simulation.buildings.b.output = [{ item: iron, count: 1 }];
    f.simulation.warehouse[iron] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(f);
    expect(() =>
      editWorld(f, { kind: "batch_delete", ids: ["a", "b"] }),
    ).toThrow("上限");
    expect(f).toEqual(before);
  });

  it("uses the unique root warehouse for child-factory batch refunds and saves", () => {
    let f = start();
    const child = f.districts![0];
    node(child, "belt", "hand_belt", 2, 2);
    child.simulation.buildings.belt.belt = {
      id: "child-load",
      item: iron,
      count: 2,
      progress: 1,
    };
    f = actWorld(f, { type: "select_district", id: child.id });
    const next = editWorld(f, { kind: "batch_delete", ids: ["belt"] });
    expect(next.simulation.warehouse[iron]).toBe(2);
    expect(next.districts![0].simulation.warehouse).toEqual({});
    expect(next.revision).toBe(f.revision + 1);
    expect(validateSave(toSave(next), user.id).simulation.warehouse[iron]).toBe(
      2,
    );
    expect(() =>
      editWorld(f, { kind: "batch_delete", ids: ["belt"] }, f.id),
    ).toThrow("切换");
  });

  it("excludes bound stations and rejects robot, blueprint and unsafe return targets in Worker", () => {
    let f = start();
    node(f, "station", "charge_station", 4, 0);
    node(f, "belt", "hand_belt", -3, 2);
    f.simulation.warehouse[itemID("智能机器人")] = 1;
    f = actWorld(f, {
      type: "robot_deploy",
      id: "robot",
      item: itemID("智能机器人"),
      station: "station",
      factory_id: f.id,
    });
    const robot = f.robots![0];
    expect(select(f, 4, 0)).toEqual([]);
    const before = structuredClone(f);
    for (const kind of ["batch_move", "batch_delete"] as const)
      expect(() =>
        editWorld(f, { kind, ids: ["station"], dx: 0, dy: 1 }),
      ).toThrow("绑定");
    const overlap = editWorld(f, {
      kind: "batch_move",
      ids: ["belt"],
      dx: robot.x + 3,
      dy: robot.y - 2,
    });
    expect(overlap.buildings.find((b) => b.id === "belt")).toMatchObject({
      x: robot.x,
      y: robot.y,
    });
    node(f, "blocking-machine", "m01", -5, 2);
    const protectedBefore = structuredClone(f);
    expect(() =>
      editWorld(f, {
        kind: "batch_move",
        ids: ["blocking-machine"],
        dx: robot.x + 5,
        dy: robot.y - 2,
      }),
    ).toThrow("机器人");
    expect(f).toEqual(protectedBefore);
    expect(before.buildings.find((b) => b.id === "belt")).toMatchObject({
      x: -3,
      y: 2,
    });
    robot.construction = {
      factory_id: f.id,
      building_type: "hand_belt",
      x: 7,
      y: 7,
      rotation: 0,
    } as NonNullable<typeof robot.construction>;
    expect(() =>
      editWorld(f, { kind: "batch_move", ids: ["belt"], dx: 10, dy: 5 }),
    ).toThrow("蓝图");
    delete robot.construction;
    // An edit may not increase the unpaid robot's return cost.
    robot.x = 0;
    robot.y = 3;
    robot.energy_kj = 0;
    const dock = { x: 3, y: 0 };
    for (const [i, p] of [
      { x: 5, y: 0 },
      { x: 4, y: 1 },
      { x: 4, y: -1 },
    ].entries()) {
      node(f, `wall-${i}`, "chest", p.x, p.y);
    }
    // Moving the final obstacle onto the open approach forces a longer route.
    expect(() =>
      editWorld(f, {
        kind: "batch_move",
        ids: ["blocking-machine"],
        dx: dock.x + 5,
        dy: dock.y - 2,
      }),
    ).toThrow("返站");
  });
});
