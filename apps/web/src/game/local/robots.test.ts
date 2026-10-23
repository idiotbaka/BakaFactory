import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { toSave, validateSave, type LocalFactory } from "./state";
import {
  actWorld,
  createWorld,
  editWorld,
  projectFactory,
  stepWorld,
  type WorldAction,
} from "./world";
import { robotDefinitions } from "./robots";
import { fuelAvailable } from "./fuel";

const user = {
  id: "robot-owner",
  username: "robot-owner",
  display_name: "站长",
  created_at: "now",
  last_login_at: "now",
};
const cart = itemID("发条搬运车"),
  electric = itemID("电动物流机器人"),
  hydraulic = itemID("液压搬运机器人");
function start() {
  const root = createWorld(user, "机器人车间");
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
  return root;
}
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
const act = (root: LocalFactory, action: WorldAction) => actWorld(root, action);
function deploy(root: LocalFactory, id: string, item = cart) {
  const f =
    root.id === root.active_district_id
      ? root
      : root.districts!.find((f) => f.id === root.active_district_id)!;
  root.simulation.warehouse[item] = (root.simulation.warehouse[item] ?? 0) + 1;
  return act(root, {
    type: "robot_deploy",
    id,
    factory_id: f.id,
    item,
    station: "station",
  });
}
function advance(root: LocalFactory, ticks: number) {
  for (let i = 0; i < ticks; i++) root = stepWorld(root);
  return root;
}
function powered(kind: "shaft" | "electric") {
  let root = place(start(), "generator", kind === "shaft" ? "m09" : "m28", 2);
  root = place(root, "line", kind === "shaft" ? "shaft" : "cable", 3);
  root = place(root, "station", kind === "shaft" ? "m18" : "charge_station", 4);
  root.simulation.buildings.generator.fuel = [
    { item: itemID(kind === "shaft" ? "固体燃料块" : "液体燃料"), count: 1 },
  ];
  return root;
}
const fuel = (r: LocalFactory, type: string) =>
  fuelAvailable(
    r.simulation.buildings.generator,
    buildingDefinitions.get(type)!,
  );

describe("robot bodies, real charging and save boundaries", () => {
  it("imports all nine source capacities and deploys a real body with zero free energy", () => {
    expect(catalog.robots!.map((d) => d.capacity)).toEqual([
      4, 12, 0, 24, 8, 12, 6, 4, 32,
    ]);
    let root = place(start(), "station", "m18", 4);
    const original = structuredClone(root);
    expect(() =>
      act(root, {
        type: "robot_deploy",
        id: "r",
        factory_id: root.id,
        item: cart,
        station: "station",
      }),
    ).toThrow();
    expect(root).toEqual(original);
    root = deploy(root, "r");
    expect(root.simulation.warehouse[cart]).toBe(0);
    expect(root.robots![0]).toMatchObject({
      energy_kj: 0,
      x: 5,
      y: 0,
      home_station: "station",
      allowed_zones: [root.id],
    });
    root.simulation.buildings.station.powered = true;
    root.simulation.buildings.station.supplied_kw = 100;
    root = advance(root, 5);
    expect(root.robots![0].energy_kj).toBe(0);
    expect(root.robots![0].status).toBe("no_energy");
  });
  it("charges exactly the paid shaft output while charging energy plus wire loss equals real fuel expenditure", () => {
    let root = deploy(powered("shaft"), "r");
    root = advance(root, 20);
    expect(root.robots![0].energy_kj).toBe(100);
    expect(root.simulation.buildings.station.station_energy_kj).toBe(0);
    expect(fuel(root, "m09")).toBe(1980 - 100 - 20);
    expect(root.simulation.networks![0].loss_kw).toBe(1);
  });
  it("cannot consume a deployed body in a milestone recipe and returns it exactly once for fabrication", () => {
    let root = deploy(place(start(), "station", "m18", 4), "r");
    root = place(root, "assembler", "m15", 7);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "assembler", recipe: "r2046" },
    });
    for (const [item, n] of Object.entries(
      recipeDefinitions.get("r2046")!.inputs,
    ))
      if (item !== cart) root.simulation.warehouse[item] = n;
    expect(() =>
      editWorld(root, {
        kind: "industry",
        action: { type: "feed_batch", id: "assembler" },
      }),
    ).toThrow();
    expect(root.simulation.buildings.assembler.input).toEqual([]);
    root = act(root, { type: "robot_recall", id: "r" });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "feed_batch", id: "assembler" },
    });
    expect(
      root.simulation.buildings.assembler.input.find((s) => s.item === cart)
        ?.count,
    ).toBe(1);
    expect(root.simulation.warehouse[cart]).toBe(0);
    expect(root.robots).toHaveLength(0);
  });
  it("shares one station's transfer rate, rotates peers and respects priority and pause", () => {
    let root = deploy(deploy(deploy(powered("shaft"), "a"), "b"), "c");
    root = advance(root, 9);
    expect(root.robots!.map((r) => r.energy_kj)).toEqual([15, 15, 15]);
    root = act(root, { type: "robot_config", id: "c", priority: 1 });
    root = advance(root, 2);
    expect(root.robots!.find((r) => r.id === "c")!.energy_kj).toBe(25);
    expect(root.robots!.find((r) => r.id === "a")!.energy_kj).toBe(15);
    root = act(root, { type: "robot_config", id: "c", enabled: false });
    root = advance(root, 2);
    expect(root.robots!.find((r) => r.id === "c")!.energy_kj).toBe(25);
    expect(
      root
        .robots!.filter((r) => r.id !== "c")
        .reduce((n, r) => n + r.energy_kj, 0),
    ).toBe(40);
    const before = structuredClone(root);
    expect(() => deploy(structuredClone(root), "fourth")).toThrow(/空格/);
    expect(root).toEqual(before);
  });
  it("stores and transfers only a brownout's actual paid kJ instead of granting the rated station rate", () => {
    let root = deploy(powered("shaft"), "r");
    root.simulation.buildings.generator.fuel = [];
    root.simulation.buildings.generator.energy_kj = 2; // Previously paid output, one kJ goes to shaft loss.
    root = stepWorld(root);
    expect(root.robots![0].energy_kj).toBe(1);
    expect(root.simulation.buildings.station.supplied_kw).toBe(1);
    expect(fuel(root, "m09")).toBe(0);
    root = advance(root, 3);
    expect(root.robots![0].energy_kj).toBe(1);
  });
  it("uses 88% electric efficiency and consumes stored paid energy after disconnection without new fuel", () => {
    let root = advance(powered("electric"), 10);
    expect(root.simulation.buildings.station.station_energy_kj).toBe(1000);
    root = deploy(root, "r", electric);
    root = stepWorld(root);
    expect(root.robots![0].energy_kj).toBe(88);
    expect(fuel(root, "m28")).toBe(5300);
    root = editWorld(root, {
      kind: "industry",
      action: { type: "power_config", id: "line", enabled: false },
    });
    root = advance(root, 20);
    expect(root.simulation.buildings.station.station_energy_kj).toBe(0);
    expect(root.robots![0].energy_kj).toBe(968);
    expect(fuel(root, "m28")).toBe(5300);
  });
  it("keeps fractional charge, caps full batteries and discards energy on recall without duplicating the body", () => {
    let root = deploy(
      place(start(), "station", "charge_station", 4),
      "r",
      electric,
    );
    root.simulation.buildings.station.station_energy_kj = 1; // Paid preexisting station stock fixture.
    root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      energy_kj: 0,
      charge_remainder: 88,
    });
    root.simulation.buildings.station.station_energy_kj = 1;
    root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      energy_kj: 1,
      charge_remainder: 76,
    });
    root.robots![0].energy_kj = 14999;
    root.robots![0].charge_remainder = 88;
    root.simulation.buildings.station.station_energy_kj = 5;
    root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      energy_kj: 15000,
      charge_remainder: 0,
    });
    expect(root.simulation.buildings.station.station_energy_kj).toBe(4);
    root = act(root, { type: "robot_recall", id: "r" });
    expect(root.simulation.warehouse[electric]).toBe(1);
    expect(() => act(root, { type: "robot_recall", id: "r" })).toThrow();
    root = act(root, {
      type: "robot_deploy",
      factory_id: root.id,
      id: "r2",
      item: electric,
      station: "station",
    });
    expect(root.robots![0]).toMatchObject({ energy_kj: 0 });
    expect(root.robots![0].charge_remainder ?? 0).toBe(0);
  });
  it("stops burning fuel at a full station and retains station energy on movement but loses it on demolition", () => {
    let root = advance(powered("shaft"), 200);
    expect(root.simulation.buildings.station.station_energy_kj).toBe(1000);
    expect(fuel(root, "m09")).toBe(780);
    root = advance(root, 10);
    expect(fuel(root, "m09")).toBe(780);
    root = editWorld(root, {
      kind: "move",
      id: "station",
      placement: { x: 6, y: 0, rotation: 90 },
    });
    expect(root.simulation.buildings.station.station_energy_kj).toBe(1000);
    root = editWorld(root, { kind: "delete", id: "station" });
    expect(root.simulation.buildings.station).toBeUndefined();
    expect(
      root.simulation.warehouse[buildingDefinitions.get("m18")!.item!],
    ).toBe(1);
  });
  it("protects occupied cells and bound stations until safe recall", () => {
    let root = deploy(place(start(), "station", "m18", 4), "r");
    expect(() => editWorld(root, { kind: "delete", id: "station" })).toThrow(
      /绑定/,
    );
    expect(() =>
      editWorld(root, {
        kind: "move",
        id: "station",
        placement: { x: 6, y: 0, rotation: 0 },
      }),
    ).toThrow(/绑定/);
    expect(() =>
      editWorld(root, {
        kind: "place",
        id: "bad",
        building_type: "miner",
        placement: { x: 5, y: 0, rotation: 0 },
      }),
    ).toThrow(/停靠/);
    root = act(root, { type: "robot_recall", id: "r" });
    root = editWorld(root, {
      kind: "move",
      id: "station",
      placement: { x: 6, y: 0, rotation: 0 },
    });
    expect(root.buildings.find((b) => b.id === "station")!.x).toBe(6);
  });
  it("persists a global robot in a child factory without moving any stock to another warehouse", () => {
    let root = start();
    const childID = root.districts![0].id;
    root = act(root, { type: "select_district", id: childID });
    root = deploy(place(root, "station", "m18", 4), "r");
    root = validateSave(toSave(root), user.id);
    expect(root.robots![0].home_factory_id).toBe(childID);
    expect(root.districts![0].robots).toBeUndefined();
    expect(projectFactory(root).robots).toHaveLength(1);
    root = act(root, { type: "select_district", id: root.id });
    root = act(root, { type: "robot_recall", id: "r" });
    expect(root.districts![0].simulation.warehouse).toEqual({});
    expect(root.simulation.warehouse[cart]).toBe(1);
  });
  it("validates zone permissions, compatible energy, whole-save bounds and unique occupancy atomically", () => {
    let root = deploy(place(start(), "station", "m18", 4), "r");
    const childID = root.districts![0].id;
    expect(() =>
      act(root, {
        type: "robot_config",
        id: "r",
        allowed_zones: [root.id, childID],
      }),
    ).toThrow(/权限/);
    expect(() =>
      act(root, {
        type: "robot_deploy",
        factory_id: root.id,
        station: "station",
        item: electric,
        id: "bad",
      }),
    ).toThrow(/能源/);
    const original = structuredClone(root);
    for (const mutate of [
      (r: LocalFactory) => {
        r.robots![0].energy_kj = 1001;
      },
      (r: LocalFactory) => {
        r.robots![0].charge_remainder = 1;
      },
      (r: LocalFactory) => {
        r.robots![0].x = 4;
      },
      (r: LocalFactory) => {
        r.robots![0].allowed_zones = [childID];
      },
      (r: LocalFactory) => {
        r.robots![0].home_station = "missing";
      },
      (r: LocalFactory) => {
        r.robots!.push({ ...r.robots![0], id: "duplicate-cell" });
      },
      (r: LocalFactory) => {
        r.districts![0].robots = r.robots;
      },
    ]) {
      const bad = structuredClone(root);
      mutate(bad);
      expect(() => validateSave(toSave(bad), user.id)).toThrow();
    }
    expect(root).toEqual(original);
    const unknown = JSON.parse(JSON.stringify(toSave(root)));
    unknown.factory.robots[0].free_energy = 1000;
    expect(() => validateSave(unknown, user.id)).toThrow();
    root = deploy(
      place(start(), "station", "hydraulic_station", 4),
      "hyd",
      hydraulic,
    );
    root = act(root, {
      type: "robot_config",
      id: "hyd",
      allowed_zones: [root.id, root.districts![0].id],
    });
    expect(root.robots![0].allowed_zones).toHaveLength(2);
    expect(root.robots![0].energy_kj).toBe(0);
    expect(robotDefinitions.get(hydraulic)!.capacity).toBe(12);
  });
});
