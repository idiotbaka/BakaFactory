import { worldSecond as stepWorld } from "./testTime";
import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";
import {
  actWorld,
  createWorld,
  editWorld,
  stepWorld as stepTick,
} from "./world";
import { journey, returnCost } from "./robotRoutes";
import { robotDefinitions } from "./robots";

const user = {
  id: "freight-owner",
  username: "freight-owner",
  display_name: "物流员",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板"),
  fluid = itemID("液压工作液"),
  cart = itemID("发条搬运车"),
  hydraulic = itemID("液压搬运机器人"),
  electric = itemID("电动物流机器人");
function place(
  root: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
) {
  root.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
  return editWorld(root, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0 },
  });
}
function setup(item = cart) {
  let root = createWorld(user, "运输测试");
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
    item === cart
      ? "m18"
      : item === hydraulic
        ? "hydraulic_station"
        : "charge_station",
    4,
    0,
  );
  root = place(root, "source", "chest", 7, 0);
  root = place(root, "target", "chest", 7, 4);
  root.simulation.warehouse[item] = 1;
  root = actWorld(root, {
    type: "robot_deploy",
    factory_id: root.id,
    station: "station",
    item,
    id: "r",
  });
  // Paid energy fixture: real station charging is covered in robots.test.ts.
  root.robots![0].energy_kj = robotDefinitions.get(item)!.energy_capacity_kj;
  root.simulation.buildings.source.output = [{ item: iron, count: 4 }];
  return root;
}
function assign(
  root: LocalFactory,
  item = iron,
  count = 4,
  targetFactory = root.id,
  source = "source",
  target = "target",
  repeat = false,
) {
  return actWorld(root, {
    type: "robot_task",
    id: "r",
    task_id: "job",
    source: { factory_id: root.id, building_id: source },
    target: { factory_id: targetFactory, building_id: target },
    item,
    count,
    channel: "auto",
    repeat,
  });
}
function until(
  root: LocalFactory,
  predicate: (r: LocalFactory) => boolean,
  max = 220,
) {
  for (let i = 0; i < max; i++) {
    if (predicate(root)) return root;
    root = stepWorld(root);
  }
  throw new Error(
    "transport did not reach expected state within bounded ticks",
  );
}
function total(root: LocalFactory, item = iron) {
  return (
    [root, ...root.districts!].reduce(
      (sum, f) =>
        sum +
        (f.simulation.warehouse[item] ?? 0) +
        Object.values(f.simulation.buildings).reduce(
          (n, m) =>
            n +
            [...m.input, ...m.output, ...(m.fuel ?? [])]
              .filter((s) => s.item === item)
              .reduce((n, s) => n + s.count, 0) +
            (m.fluid?.item === item ? m.fluid.count : 0),
          0,
        ),
      0,
    ) +
    (root.robots ?? []).reduce(
      (sum, r) => sum + (r.cargo?.item === item ? r.cargo.count : 0),
      0,
    )
  );
}

describe("physical robot freight", () => {
  it("cycles unfiltered multi-item trips without mixing cargo and preserves every item across reloads", () => {
    const copper = itemID("铜条");
    let root = setup();
    root.simulation.buildings.source.output = [
      { item: iron, count: 4 },
      { item: copper, count: 3 },
    ];
    root = assign(root, "", 2, root.id, "source", "target", true);
    for (let i = 0; i < 180; i++) {
      root = stepTick(root);
      expect(total(root, iron)).toBe(4);
      expect(total(root, copper)).toBe(3);
      if (root.robots![0].cargo) {
        expect([iron, copper]).toContain(root.robots![0].cargo!.item);
        expect(root.robots![0].cargo!.count).toBeLessThanOrEqual(2);
        root = validateSave(toSave(root), user.id);
        expect(root.robots![0].task!.item).toBe("");
      }
    }
    expect(root.simulation.buildings.source.output).toEqual([]);
    expect(root.simulation.buildings.target.output).toEqual(
      expect.arrayContaining([
        { item: iron, count: 4 },
        { item: copper, count: 3 },
      ]),
    );
    expect(root.robots![0].task?.repeat).toBe(true);
    expect(root.robots![0].status).toBe("source_empty");
  });

  it("skips incompatible or full target material and keeps an actual load bound when capacity changes", () => {
    const copper = itemID("铜条");
    let root = setup();
    root.simulation.buildings.source.output.push({ item: copper, count: 3 });
    root.simulation.buildings.target.output = [{ item: iron, count: 100 }];
    root = assign(root, "", 3);
    root = until(root, (f) => !!f.robots![0].cargo);
    expect(root.robots![0].cargo).toEqual({ item: copper, count: 3 });
    root.simulation.buildings.target.output.push({ item: copper, count: 100 });
    root = until(root, (f) => f.robots![0].status === "blocked");
    root = validateSave(toSave(root), user.id);
    const before = total(root, copper),
      energy = root.robots![0].energy_kj;
    root = stepTick(root);
    expect(root.robots![0].cargo).toEqual({ item: copper, count: 3 });
    expect(root.robots![0].energy_kj).toBe(energy);
    expect(total(root, copper)).toBe(before);
    root.simulation.buildings.target.output = [{ item: iron, count: 100 }];
    root = until(root, (f) => f.robots![0].completed_tasks === 1);
    expect(root.simulation.buildings.source.output).toEqual([
      { item: iron, count: 4 },
    ]);
    expect(root.simulation.buildings.target.output).toContainEqual({
      item: copper,
      count: 3,
    });
  });

  it("does not take unsupported fluid into solid carriers or extract machine input with any-item tasks", () => {
    let root = setup();
    root = editWorld(root, { kind: "delete", id: "source" });
    root = place(root, "source", "m03", 7, 0);
    root.simulation.buildings.source.input = [{ item: iron, count: 2 }];
    root = assign(root, "", 2);
    root = until(root, (f) => f.robots![0].status === "source_empty");
    expect(root.simulation.buildings.source.input).toEqual([
      { item: iron, count: 2 },
    ]);
    expect(root.robots![0].cargo).toBeUndefined();
    root = setup();
    root = editWorld(root, { kind: "delete", id: "source" });
    root = place(root, "source", "tank", 7, 0);
    root.simulation.buildings.source.fluid = { item: fluid, count: 10 };
    root = assign(root, "", 2);
    root = until(root, (f) => f.robots![0].status === "source_empty");
    expect(root.simulation.buildings.source.fluid?.count).toBe(10);
    expect(root.robots![0].cargo).toBeUndefined();
  });

  it("transports one compatible tank fluid with any-item mode and retains hydraulic capacity", () => {
    let root = setup(hydraulic);
    for (const id of ["source", "target"])
      root = editWorld(root, { kind: "delete", id });
    root = place(root, "source", "tank", 7, 0);
    root = place(root, "target", "tank", 7, 4);
    root.simulation.buildings.source.fluid = { item: fluid, count: 25 };
    root = assign(root, "", 20);
    root = until(root, (f) => f.robots![0].completed_tasks === 1);
    expect(root.simulation.buildings.target.fluid).toEqual({
      item: fluid,
      count: 20,
    });
    expect(root.simulation.buildings.source.fluid).toEqual({
      item: fluid,
      count: 5,
    });
    expect(total(root, fluid)).toBe(25);
  });

  it("honors WH item filters and the paid per-face output limit in any-item mode", () => {
    let root = setup();
    const bus = root.buildings[0];
    bus.configuration.face_180 = {
      mode: "output",
      filter: iron,
      output_count: 1,
    };
    root.simulation.warehouse[iron] = 4;
    const copper = itemID("铜条");
    root.simulation.warehouse[copper] = 5;
    root = assign(root, "", 4, root.id, bus.id);
    for (let i = 0; i < 160 && !root.robots![0].completed_tasks; i++) {
      const before = root.simulation.warehouse[iron];
      root = stepTick(root);
      expect(before - root.simulation.warehouse[iron]).toBeLessThanOrEqual(1);
      expect(root.simulation.warehouse[copper]).toBe(5);
      expect(total(root, iron)).toBe(8);
    }
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
  });

  it.each(["pipe", "return_pipe", "pressure_valve", "valve", "pump", "m18"])(
    "rejects new %s freight endpoints atomically",
    (type) => {
      let root = setup(hydraulic);
      root = place(root, "invalid-endpoint", type, -5, 4);
      const before = structuredClone(root);
      expect(() =>
        assign(root, "", 1, root.id, "invalid-endpoint", "target"),
      ).toThrow(/请选择/);
      expect(() =>
        assign(root, "", 1, root.id, "source", "invalid-endpoint"),
      ).toThrow(/请选择/);
      expect(root).toEqual(before);
    },
  );

  it("waits for the first full charge but does not restart that gate when passing the station later", () => {
    let root = setup();
    const bus = root.buildings[0];
    bus.configuration.face_180 = { mode: "output", filter: iron };
    root.simulation.warehouse[iron] = 4;
    root.simulation.buildings.source.output = [];
    root.robots![0].energy_kj--;
    root = assign(root, iron, 4, root.id, bus.id, "target");
    const origin = { x: root.robots![0].x, y: root.robots![0].y };
    root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      ...origin,
      status: "waiting_charge",
    });
    expect(root.simulation.warehouse[iron]).toBe(4);
    // Explicit paid-energy fixture; the route passes another side of the
    // station on its way to WH without any station energy available.
    root.robots![0].energy_kj++;
    root = until(root, (f) => (f.robots![0].completed_tasks ?? 0) === 1);
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
    expect(root.simulation.buildings.station.station_energy_kj ?? 0).toBe(0);
    expect(total(root)).toBe(4);
  });

  it("moves only two empty ground cells per second, pays handling time and conserves cargo through save/reload", () => {
    let root = assign(setup());
    const energy = root.robots![0].energy_kj;
    for (let i = 0; i < 70; i++) {
      const before = structuredClone(root.robots![0]);
      root = stepWorld(root);
      const r = root.robots![0];
      expect(
        Math.abs(r.x - before.x) + Math.abs(r.y - before.y),
      ).toBeLessThanOrEqual(2);
      expect(root.buildings.some((b) => b.x === r.x && b.y === r.y)).toBe(
        false,
      );
      expect(total(root)).toBe(4);
      root = validateSave(toSave(root), user.id);
    }
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
    expect(root.robots![0]).toMatchObject({ completed_tasks: 1 });
    expect(
      root.simulation.industry!.quests!.factory_events?.clockwork_transport,
    ).toBe(1);
    expect(root.simulation.industry!.quests!.completed).toContain(
      "p2_clockwork_colleague",
    );
    expect(root.robots![0].cargo).toBeUndefined();
    expect(root.robots![0].task).toBeUndefined();
    expect(root.robots![0].returning).toBeUndefined();
    expect(root.robots![0].energy_kj).toBe(energy - 16);
  });
  it("preserves a real load when a target fills, resumes on space, and never recalls a working body", () => {
    let root = assign(setup());
    root = until(root, (f) => !!f.robots![0].cargo);
    expect(() => actWorld(root, { type: "robot_recall", id: "r" })).toThrow(
      /返站/,
    );
    root.simulation.buildings.target.output = [{ item: iron, count: 100 }];
    root = until(root, (f) => f.robots![0].status === "blocked");
    const saved = structuredClone(root),
      energy = root.robots![0].energy_kj;
    root = stepWorld(root);
    expect(root.robots![0].energy_kj).toBe(energy);
    expect(root.robots![0].cargo).toEqual(saved.robots![0].cargo);
    root.simulation.buildings.target.output = [];
    root = until(root, (f) => f.robots![0].completed_tasks === 1);
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
  });
  it("cancels a loaded job without an instant warehouse refund, returns physically, and recalls exactly once", () => {
    let root = until(assign(setup()), (f) => !!f.robots![0].cargo);
    const before = root.simulation.warehouse[iron] ?? 0;
    root = actWorld(root, { type: "robot_return", id: "r" });
    expect(root.simulation.warehouse[iron] ?? 0).toBe(before);
    expect(root.robots![0].cargo?.count).toBe(4);
    root = until(root, (f) => !f.robots![0].returning);
    expect(total(root)).toBe(4);
    expect(root.simulation.warehouse[iron]).toBe(before + 4);
    expect(root.simulation.industry!.quests!.automated_received).toBe(0);
    expect(
      root.simulation.industry!.quests!.factory_events?.clockwork_transport ??
        0,
    ).toBe(0);
    expect(root.robots![0].completed_tasks ?? 0).toBe(0);
    root = actWorld(root, { type: "robot_recall", id: "r" });
    expect(root.simulation.warehouse[cart]).toBe(1);
    expect(() => actWorld(root, { type: "robot_recall", id: "r" })).toThrow();
  });
  it("crosses via WH gates over eight paid ticks, pauses in transit, and preserves partial journeys", () => {
    let root = setup(electric);
    const dest = root.districts![0],
      gate = dest.buildings[0].id;
    const body = buildingDefinitions.get("m03")!.item!;
    root.simulation.buildings.source.output = [{ item: body, count: 1 }];
    root = actWorld(root, {
      type: "robot_config",
      id: "r",
      allowed_zones: [root.id, dest.id],
    });
    root = assign(root, body, 1, dest.id, "source", gate);
    root = until(root, (f) => !!f.robots![0].transit);
    expect(root.robots![0].transit?.remaining_ticks).toBe(8);
    const energy = root.robots![0].energy_kj;
    root = actWorld(root, { type: "robot_config", id: "r", enabled: false });
    root = stepWorld(root);
    expect(root.robots![0].transit?.remaining_ticks).toBe(8);
    expect(root.robots![0].energy_kj).toBe(energy);
    root = actWorld(root, { type: "robot_config", id: "r", enabled: true });
    for (let i = 7; i >= 1; i--) {
      root = stepWorld(root);
      expect(root.robots![0].transit?.remaining_ticks).toBe(i);
      expect(root.districts![0].simulation.warehouse[body] ?? 0).toBe(0);
      root = validateSave(toSave(root), user.id);
    }
    root = stepWorld(root);
    expect(root.robots![0].factory_id).toBe(dest.id);
    expect(root.robots![0].energy_kj).toBe(energy - 8);
    expect(root.robots![0].cargo?.count).toBe(1);
    root = until(root, (f) => f.robots![0].completed_tasks === 1);
    expect(root.simulation.warehouse[body]).toBe(1);
    expect(root.simulation.industry!.quests!.automated_received).toBe(1);
    expect(
      root.simulation.industry!.quests!.factory_events?.clockwork_transport ??
        0,
    ).toBe(0);
    expect(total(root, body)).toBe(1);
    expect(
      root.districts!.every((f) => f.simulation.tick === root.simulation.tick),
    ).toBe(true);
  });
  it("keeps real cargo and travels home when cancelled in transit or when a target is removed", () => {
    for (const cancel of [false, true]) {
      let root = setup(electric);
      const child = root.districts![0];
      root = actWorld(root, {
        type: "robot_config",
        id: "r",
        allowed_zones: [root.id, child.id],
      });
      root = assign(root, iron, 4, child.id, "source", child.buildings[0].id);
      root = until(root, (f) => !!f.robots![0].transit);
      if (cancel) root = actWorld(root, { type: "robot_return", id: "r" });
      else root.robots![0].task!.target.building_id = "removed";
      root = validateSave(toSave(root), user.id);
      expect(root.simulation.warehouse[iron] ?? 0).toBe(0);
      root = until(root, (f) => !f.robots![0].returning && !f.robots![0].task);
      expect(root.simulation.warehouse[iron]).toBe(4);
      expect(root.districts![0].simulation.warehouse[iron] ?? 0).toBe(0);
      expect(root.robots![0].completed_tasks ?? 0).toBe(0);
    }
  });
  it("routes to the configured WH face and never exceeds one output unit per face per half-second", () => {
    let root = setup();
    const bus = root.buildings[0];
    bus.configuration.face_180 = { mode: "output", filter: iron };
    root.simulation.warehouse[iron] = 4;
    root.simulation.buildings.source.output = [];
    root = assign(root, iron, 4, root.id, bus.id, "target");
    let last = 4;
    for (let i = 0; i < 100; i++) {
      root = stepTick(root);
      const left = root.simulation.warehouse[iron];
      expect(last - left).toBeLessThanOrEqual(1);
      expect(total(root)).toBe(4);
      last = left;
    }
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
  });
  it("honors a configured WH output batch while keeping robot capacity and warehouse stock conserved", () => {
    let root = setup();
    const bus = root.buildings[0];
    bus.configuration.face_180 = {
      mode: "output",
      filter: iron,
      output_count: 3,
    };
    root.simulation.warehouse[iron] = 4;
    root.simulation.buildings.source.output = [];
    root = assign(root, iron, 4, root.id, bus.id, "target");
    let previous = 4,
      peak = 0;
    for (let i = 0; i < 100; i++) {
      root = stepTick(root);
      const current = root.simulation.warehouse[iron];
      const moved = previous - current;
      peak = Math.max(peak, moved);
      expect(moved).toBeLessThanOrEqual(3);
      expect(total(root)).toBe(4);
      previous = current;
    }
    expect(peak).toBe(3);
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
  });
  it("uses sealed fluid capacity only for capable carriers and refuses a mixed target", () => {
    let root = setup(hydraulic);
    root = editWorld(root, { kind: "delete", id: "source" });
    root = editWorld(root, { kind: "delete", id: "target" });
    root = place(root, "source", "tank", 7, 0);
    root = place(root, "target", "tank", 7, 4);
    root.simulation.buildings.source.fluid = { item: fluid, count: 12 };
    root.simulation.buildings.target.fluid = {
      item: itemID("高压蒸汽"),
      count: 1,
    };
    root = assign(root, fluid, 12);
    root = until(root, (f) => !!f.robots![0].cargo);
    root = until(root, (f) => f.robots![0].status === "rejected");
    expect(root.robots![0].cargo).toEqual({ item: fluid, count: 12 });
    delete root.simulation.buildings.target.fluid;
    root = until(root, (f) => f.robots![0].completed_tasks === 1);
    expect(root.simulation.buildings.target.fluid).toEqual({
      item: fluid,
      count: 12,
    });
    expect(total(root, fluid)).toBe(12);
    const incompatible = setup(electric);
    expect(() => assign(incompatible, fluid, 1)).toThrow(/无效/);
    expect(incompatible.robots![0].task).toBeUndefined();
  });
  it("keeps source input caches inaccessible", () => {
    let root = setup();
    root = editWorld(root, { kind: "delete", id: "source" });
    root = place(root, "source", "m03", 7, 0);
    const recipe = recipeDefinitions.get("r1007")!;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "source", recipe: recipe.id },
    });
    const input = Object.keys(recipe.inputs)[0];
    root.simulation.buildings.source.input = [{ item: input, count: 1 }];
    root = assign(root, input, 1);
    root = until(root, (f) => f.robots![0].status === "source_empty");
    expect(root.simulation.buildings.source.input).toEqual([
      { item: input, count: 1 },
    ]);
    expect(root.robots![0].cargo).toBeUndefined();
  });
  it("delivers to the selected recipe or the separate fuel cache and serializes robots without cell overlap", () => {
    for (const channel of ["input", "fuel"] as const) {
      let root = setup();
      root = editWorld(root, { kind: "delete", id: "target" });
      root = place(root, "target", channel === "input" ? "m03" : "m05", 7, 4);
      root = editWorld(root, {
        kind: "industry",
        action: {
          type: "recipe",
          id: "target",
          recipe: channel === "input" ? "r1007" : "r1017",
        },
      });
      root = editWorld(root, {
        kind: "industry",
        action: { type: "power_config", id: "target", enabled: false },
      });
      const item =
        channel === "input"
          ? Object.keys(recipeDefinitions.get("r1007")!.inputs)[0]
          : itemID("干燥生物质");
      root.simulation.buildings.source.output = [{ item, count: 1 }];
      root = actWorld(root, {
        type: "robot_task",
        id: "r",
        task_id: "supply",
        source: { factory_id: root.id, building_id: "source" },
        target: { factory_id: root.id, building_id: "target" },
        item,
        count: 1,
        channel,
        repeat: false,
      });
      root = until(root, (f) => f.robots![0].completed_tasks === 1);
      expect(root.simulation.buildings.target[channel]).toEqual([
        { item, count: 1 },
      ]);
    }
    let root = setup();
    root.simulation.warehouse[cart] = 1;
    root = actWorld(root, {
      type: "robot_deploy",
      id: "peer",
      factory_id: root.id,
      station: "station",
      item: cart,
    });
    root.robots![1].energy_kj = 1000;
    root = assign(root, iron, 2);
    root = actWorld(root, {
      type: "robot_task",
      id: "peer",
      task_id: "peer-job",
      source: { factory_id: root.id, building_id: "source" },
      target: { factory_id: root.id, building_id: "target" },
      item: iron,
      count: 2,
      channel: "auto",
      repeat: false,
    });
    for (let i = 0; i < 100; i++) {
      root = stepWorld(root);
      expect(
        new Set(root.robots!.map((r) => `${r.factory_id}:${r.x},${r.y}`)).size,
      ).toBe(2);
      expect(total(root)).toBe(4);
    }
    expect(root.simulation.buildings.target.output).toEqual([
      { item: iron, count: 4 },
    ]);
  });
  it("blocks encircled routes, occupied tiles, transit landing edits and newly unaffordable return paths", () => {
    const root = setup();
    const before = structuredClone(root);
    for (const [x, y] of [
      [8, 4],
      [7, 3],
      [6, 4],
      [7, 5],
    ]) {
      root.buildings.push({
        id: `wall-${x}-${y}`,
        factory_id: root.id,
        building_type: "chest",
        x,
        y,
        rotation: 0,
        configuration: {},
      });
      root.simulation.buildings[`wall-${x}-${y}`] = newMachine();
    }
    expect(() => assign(root)).toThrow(/不可达/);
    expect(root.robots![0].task).toBeUndefined();
    const r = before.robots![0];
    expect(() => place(before, "occupied", "chest", r.x, r.y)).toThrow(/停靠/);
    // A one-cell corridor: blocking it would strand a robot despite being
    // an otherwise legal building cell. It must be an atomic rejection.
    const corridor = setup();
    for (let y = -10; y <= 10; y++)
      if (y !== 2) {
        const id = `barrier-${y}`;
        corridor.buildings.push({
          id,
          factory_id: corridor.id,
          building_type: "chest",
          x: 6,
          y,
          rotation: 0,
          configuration: {},
        });
        corridor.simulation.buildings[id] = newMachine();
      }
    corridor.robots![0].x = 7;
    corridor.robots![0].y = 1;
    expect(
      journey(corridor, corridor.robots![0], {
        factory_id: corridor.id,
        building_id: "station",
      }),
    ).toBeDefined();
    expect(returnCost(corridor, corridor.robots![0])).toBeLessThan(1000);
    expect(() => place(corridor, "seal", "chest", 6, 2)).toThrow(/返站/);
    let transit = setup(electric);
    const child = transit.districts![0];
    transit = actWorld(transit, {
      type: "robot_config",
      id: "r",
      allowed_zones: [transit.id, child.id],
    });
    transit = until(
      assign(transit, iron, 4, child.id, "source", child.buildings[0].id),
      (f) => !!f.robots![0].transit,
    );
    const landing = transit.robots![0].transit!;
    transit = actWorld(transit, { type: "select_district", id: child.id });
    transit.simulation.warehouse[buildingDefinitions.get("chest")!.item!] = 1;
    expect(() =>
      editWorld(transit, {
        kind: "place",
        id: "landing-wall",
        building_type: "chest",
        placement: { x: landing.x, y: landing.y, rotation: 0 },
      }),
    ).toThrow(/停靠/);
  });
  it("rejects invalid nested saves and preserves jobs when permissions cannot be revoked in flight", () => {
    let root = setup(electric);
    const child = root.districts![0];
    root = actWorld(root, {
      type: "robot_config",
      id: "r",
      allowed_zones: [root.id, child.id],
    });
    root = assign(root, iron, 4, child.id, "source", child.buildings[0].id);
    const before = structuredClone(root);
    expect(() =>
      actWorld(root, {
        type: "robot_config",
        id: "r",
        allowed_zones: [root.id],
      }),
    ).toThrow();
    expect(root).toEqual(before);
    for (const mutate of [
      (r: Record<string, unknown>) => {
        r.allowed_zones = 4;
      },
      (r: Record<string, unknown>) => {
        r.work_progress = null;
      },
      (r: Record<string, unknown>) => {
        r.completed_tasks = -1;
      },
      (r: Record<string, unknown>) => {
        r.cargo = { item: iron, count: 25 };
      },
      (r: Record<string, unknown>) => {
        r.task = { ...(r.task as object), repeat: null };
      },
      (r: Record<string, unknown>) => {
        r.transit = { to_factory_id: child.id, x: 1, y: 0, remaining_ticks: 9 };
      },
    ]) {
      const bad = JSON.parse(JSON.stringify(toSave(root)));
      mutate(bad.factory.robots[0]);
      expect(() => validateSave(bad, user.id)).toThrow();
    }
  });
});
