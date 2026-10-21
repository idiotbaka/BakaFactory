import { describe, expect, it } from "vitest";
import { catalog, buildingDefinitions, itemID } from "./catalog";
import { actWorld, createWorld, editWorld, stepWorld } from "./world";
import { toSave, validateSave, type LocalFactory } from "./state";
import { plannedBuildings, journey, homeEndpoint } from "./robotRoutes";
import type { ConstructionAction } from "./construction";
import { placementIssue } from "../editorGeometry";

const user = {
  id: "builder-owner",
  username: "builder-owner",
  display_name: "施工员",
  created_at: "now",
  last_login_at: "now",
};
const device = buildingDefinitions.get("m03")!.item!,
  smart = itemID("智能机器人");
function setup(peers = 1) {
  let root = createWorld(user, "施工场");
  root.simulation.industry!.stage = 6;
  root.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  root.simulation.warehouse[buildingDefinitions.get("charge_station")!.item!] =
    1;
  root = editWorld(root, {
    kind: "place",
    id: "station",
    building_type: "charge_station",
    placement: { x: 4, y: 0, rotation: 0 },
  });
  root.simulation.warehouse[smart] = peers;
  root.simulation.warehouse[device] = peers;
  for (let i = 0; i < peers; i++) {
    root = actWorld(root, {
      type: "robot_deploy",
      id: `r${i}`,
      item: smart,
      station: "station",
      factory_id: root.id,
    });
    // Paid energy fixture; actual station charging is covered by robots.test.ts.
    root.robots![i].energy_kj = 30000;
  }
  return root;
}
const action = (
  root: LocalFactory,
  overrides: Partial<ConstructionAction["blueprint"]> = {},
  id = "r0",
): ConstructionAction => ({
  type: "robot_construct",
  id,
  blueprint: {
    id: "site",
    factory_id: root.id,
    building_type: "m03",
    x: 6,
    y: 2,
    rotation: 90,
    recipe_id: "r1007",
    ...overrides,
  },
});
function until(
  root: LocalFactory,
  predicate: (root: LocalFactory) => boolean,
  max = 100,
) {
  for (let i = 0; i < max && !predicate(root); i++) root = stepWorld(root);
  expect(predicate(root)).toBe(true);
  return root;
}
function restored(root: LocalFactory) {
  return validateSave(toSave(root), user.id);
}

describe("paid blueprint construction and physical reclamation", () => {
  it("installs independent peer blueprints once and reserves source quotas against manual edits", () => {
    let root = setup(2);
    root = actWorld(root, action(root));
    root = actWorld(root, action(root, { id: "peer-site", x: 8, y: 4 }, "r1"));
    root = until(
      root,
      (r) =>
        r.buildings.some((b) => b.id === "site") &&
        r.buildings.some((b) => b.id === "peer-site"),
      200,
    );
    expect(root.simulation.warehouse[device]).toBe(0);
    expect(
      root.buildings.filter((b) => b.id === "site" || b.id === "peer-site"),
    ).toHaveLength(2);
    root = setup();
    const port = buildingDefinitions.get("waste_port")!.item!;
    root.simulation.warehouse[port] = 17;
    for (let i = 0; i < 15; i++)
      root = editWorld(root, {
        kind: "place",
        id: `port-${i}`,
        building_type: "waste_port",
        placement: { x: i - 10, y: 10, rotation: 0 },
      });
    root = actWorld(
      root,
      action(root, {
        building_type: "waste_port",
        x: 6,
        y: 10,
        recipe_id: undefined,
      }),
    );
    const previous = structuredClone(root);
    expect(() =>
      editWorld(root, {
        kind: "place",
        id: "overflow-port",
        building_type: "waste_port",
        placement: { x: 8, y: 10, rotation: 0 },
      }),
    ).toThrow();
    expect(root).toEqual(previous);
  });
  it("refuses a blueprint that cuts the last physical return corridor", () => {
    let root = setup(2);
    // A peer is working in a three-wall pocket with one remaining exit.
    root.robots![1].x = 7;
    root.robots![1].y = 2;
    for (const [id, x, y] of [
      ["west", 6, 2],
      ["east", 8, 2],
      ["north", 7, 3],
    ] as const) {
      root.simulation.warehouse[device] =
        (root.simulation.warehouse[device] ?? 0) + 1;
      root = editWorld(root, {
        kind: "place",
        id,
        building_type: "m03",
        placement: { x, y, rotation: 0 },
      });
    }
    // The site is reachable by the builder; reserving it would trap the peer.
    expect(() => actWorld(root, action(root, { x: 7, y: 1 }))).toThrow(/返程/);
  });
  it("holds one real device, pays ten on-site ticks and replaces the immutable layout exactly once", () => {
    const before = setup(),
      saved = structuredClone(before);
    let root = actWorld(before, action(before));
    expect(before).toEqual(saved);
    expect(root.simulation.warehouse[device]).toBe(0);
    expect(root.robots![0].cargo).toEqual({ item: device, count: 1 });
    expect(root.buildings.some((b) => b.id === "site")).toBe(false);
    root = until(root, (r) => (r.robots![0].work_progress ?? 0) === 9);
    const work = structuredClone(root),
      oldBuildings = root.buildings,
      energy = root.robots![0].energy_kj;
    root = stepWorld(root);
    expect(oldBuildings.some((b) => b.id === "site")).toBe(false);
    expect(work.buildings.some((b) => b.id === "site")).toBe(false);
    expect(root.buildings.find((b) => b.id === "site")).toMatchObject({
      building_type: "m03",
      x: 6,
      y: 2,
      rotation: 90,
      configuration: { recipe_id: "r1007" },
    });
    expect(root.simulation.buildings.site).toMatchObject({
      input: [],
      output: [],
      progress: 0,
      status: "idle",
    });
    expect(root.robots![0].energy_kj).toBe(energy - 1);
    expect(root.robots![0].construction).toBeUndefined();
    expect(root.robots![0].cargo).toBeUndefined();
    root = until(root, (r) => !r.robots![0].returning);
    expect(root.buildings.filter((b) => b.id === "site")).toHaveLength(1);
    expect(root.simulation.industry!.work_receipts ?? []).toEqual([]);
    expect(root.robots![0].completed_tasks ?? 0).toBe(0);
    expect(
      root.robots![0].behavior_log?.filter((e) => e.kind === "built"),
    ).toHaveLength(1);
    root = editWorld(root, { kind: "delete", id: "site" });
    expect(root.simulation.warehouse[device]).toBe(1);
    expect(() => editWorld(root, { kind: "delete", id: "site" })).toThrow();
  });
  it("persists partial construction and pauses without paying work or duplicating the held item", () => {
    let root = setup();
    root = actWorld(root, action(root));
    root = until(root, (r) => (r.robots![0].work_progress ?? 0) === 3);
    root = restored(root);
    root = actWorld(root, { type: "robot_config", id: "r0", enabled: false });
    const held = structuredClone(root.robots![0]);
    for (let i = 0; i < 12; i++) root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      construction: held.construction,
      cargo: held.cargo,
      energy_kj: held.energy_kj,
      work_progress: held.work_progress,
    });
    root = actWorld(root, { type: "robot_config", id: "r0", enabled: true });
    root = until(restored(root), (r) =>
      r.buildings.some((b) => b.id === "site"),
    );
    expect(root.simulation.warehouse[device]).toBe(0);
  });
  it("cancels on site without instant refund, releases the footprint, and returns cargo before recall", () => {
    let root = setup();
    root = actWorld(root, action(root));
    root = until(root, (r) => (r.robots![0].work_progress ?? 0) === 4);
    root = actWorld(root, { type: "robot_return", id: "r0" });
    root = actWorld(root, { type: "robot_return", id: "r0" });
    expect(plannedBuildings(root, root.id)).toEqual([]);
    expect(root.simulation.warehouse[device]).toBe(0);
    expect(root.robots![0].cargo?.count).toBe(1);
    expect(() => actWorld(root, { type: "robot_recall", id: "r0" })).toThrow();
    root = until(restored(root), (r) => !r.robots![0].returning);
    expect(root.simulation.warehouse[device]).toBe(1);
    expect(root.robots![0].construction).toBeUndefined();
    expect(root.buildings.some((b) => b.id === "site")).toBe(false);
    root = actWorld(root, { type: "robot_recall", id: "r0" });
    expect(root.simulation.warehouse[smart]).toBe(1);
    expect(root.simulation.warehouse[device]).toBe(1);
  });
  it("carries the device through real WH transit and installs only in the authorized destination", () => {
    let root = setup();
    const child = root.districts![0],
      target = child.id;
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id, target],
    });
    root = actWorld(root, action(root, { factory_id: target }));
    root = until(root, (r) => !!r.robots![0].transit);
    expect(root.robots![0].transit?.remaining_ticks).toBe(8);
    expect(root.districts![0].buildings).toHaveLength(1);
    expect(root.districts![0].simulation.warehouse[device] ?? 0).toBe(0);
    root = until(restored(root), (r) =>
      r.districts![0].buildings.some((b) => b.id === "site"),
    );
    expect(root.buildings.some((b) => b.id === "site")).toBe(false);
    expect(root.robots![0].factory_id).toBe(target);
    expect(root.simulation.warehouse[device]).toBe(0);
  });
  it("finishes an in-flight cancellation before refunding to the home district", () => {
    let root = setup();
    const target = root.districts![0].id;
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id, target],
    });
    root = actWorld(root, action(root, { factory_id: target }));
    root = until(root, (r) => !!r.robots![0].transit);
    root = actWorld(root, { type: "robot_return", id: "r0" });
    expect(root.simulation.warehouse[device]).toBe(0);
    root = until(restored(root), (r) => !r.robots![0].returning);
    expect(root.districts![0].buildings).toHaveLength(1);
    expect(root.districts![0].simulation.warehouse[device] ?? 0).toBe(0);
    expect(root.simulation.warehouse[device]).toBe(1);
  });
  it("rejects missing stock, energy, legacy types, locked recipes, invalid positions and permissions atomically", () => {
    const root = setup(),
      baseline = structuredClone(root);
    for (const c of [
      { x: 11 },
      { x: 0, y: 0 },
      { building_type: "bus" },
      { building_type: "miner" },
      { recipe_id: "r1001" },
      { recipe_id: "unknown" },
      { factory_id: root.districts![0].id },
      { x: 5, y: 0 },
      { rotation: 45 },
      { building_type: "waste_port", y: 0 },
    ]) {
      expect(() =>
        actWorld(
          root,
          action(root, c as Partial<ConstructionAction["blueprint"]>),
        ),
      ).toThrow();
      expect(root).toEqual(baseline);
    }
    const missing = structuredClone(root);
    missing.simulation.warehouse[device] = 0;
    expect(() => actWorld(missing, action(missing))).toThrow();
    expect(missing.robots![0].cargo).toBeUndefined();
    const empty = structuredClone(root);
    empty.robots![0].energy_kj = 0;
    expect(() => actWorld(empty, action(empty))).toThrow();
    expect(empty.simulation.warehouse[device]).toBe(1);
  });
  it("reserves cells and IDs against peers and edits, and routes other robots around a blueprint", () => {
    let root = setup(2);
    root = actWorld(root, action(root));
    expect(() => actWorld(root, action(root, { id: "other" }, "r1"))).toThrow();
    expect(() => actWorld(root, action(root, { x: 8, y: 2 }, "r1"))).toThrow();
    expect(placementIssue(root, { x: 6, y: 2 })).toContain("蓝图");
    expect(() =>
      editWorld(root, {
        kind: "move",
        id: "station",
        placement: { x: 6, y: 2, rotation: 0 },
      }),
    ).toThrow();
    expect(() =>
      editWorld(root, {
        kind: "place",
        id: "manual",
        building_type: "m03",
        placement: { x: 6, y: 2, rotation: 0 },
      }),
    ).toThrow();
    const peer = root.robots![1];
    const plan = journey(
      root,
      { factory_id: root.id, x: 8, y: 2 },
      homeEndpoint(peer),
    );
    expect(plan).toBeDefined();
    expect(plan!.route.some((p) => p.x === 6 && p.y === 2)).toBe(false);
    const bad = toSave(root);
    bad.factory.robots![0].cargo!.count = 2;
    expect(() => validateSave(bad, user.id)).toThrow();
  });
  it("waits with the actual item if the emergency return warehouse is full", () => {
    let root = setup();
    root = actWorld(root, action(root));
    root = actWorld(root, { type: "robot_return", id: "r0" });
    root.simulation.warehouse[device] = Number.MAX_SAFE_INTEGER;
    root = until(root, (r) => r.robots![0].status === "blocked");
    expect(root.robots![0].cargo?.count).toBe(1);
    expect(root.simulation.warehouse[device]).toBe(Number.MAX_SAFE_INTEGER);
    root = restored(root);
    root.simulation.warehouse[device]--;
    root = until(root, (r) => !r.robots![0].returning);
    expect(root.simulation.warehouse[device]).toBe(Number.MAX_SAFE_INTEGER);
    expect(root.robots![0].cargo).toBeUndefined();
  });
});
