import { describe, expect, it } from "vitest";
import { catalog, buildingDefinitions, itemID } from "./catalog";
import { createWorld, editWorld, actWorld, stepWorld } from "./world";
import { chargeRobots } from "./robots";
import { newMachine, toSave, validateSave } from "./state";
import { robotCanTraverse } from "./robotMovement";
import { journey, emptyCell, plannedLayout } from "./robotRoutes";
import { previewRobotRoutes, previewRobotRoute } from "./robotNavigation";

const user = {
  id: "upgrade-owner",
  username: "upgrade",
  display_name: "搬运",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板");
function setup(item = itemID("发条搬运车")) {
  let root = createWorld(user, "机器人升级");
  root.simulation.industry!.stage = 6;
  const finals = catalog
    .quests!.filter((q) => q.stage_final && q.tier < 6)
    .map((q) => q.id);
  root.simulation.industry!.quests!.completed.push(...finals);
  root.simulation.industry!.quests!.claimed.push(...finals);
  root.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  const spec = catalog.robots!.find((r) => r.item === item)!;
  const station = catalog.buildings.find(
    (d) => d.role === "station" && d.energy === spec.energy,
  )!;
  root.simulation.warehouse[station.item!] = 1;
  root = editWorld(root, {
    kind: "place",
    id: "station",
    building_type: station.id,
    placement: { x: -4, y: 1, rotation: 0 },
  });
  root.simulation.warehouse[item] = 1;
  return actWorld(root, {
    type: "robot_deploy",
    id: "r",
    item,
    station: "station",
    factory_id: root.id,
  });
}

describe("robot throughput, walkable logistics and compatibility", () => {
  it("round-trips the new nominal station power and rejects power outside the station-only boundary", () => {
    const root = setup(itemID("智能机器人"));
    const state = root.simulation.buildings.station;
    state.power_demand_kw = 1500;
    state.supplied_kw = 1500;
    expect(
      validateSave(toSave(root), user.id).simulation.buildings.station,
    ).toMatchObject({ power_demand_kw: 1500, supplied_kw: 1500 });
    for (const field of ["power_demand_kw", "supplied_kw"] as const) {
      const high = structuredClone(root);
      high.simulation.buildings.station[field] = 1501;
      expect(() => validateSave(toSave(high), user.id)).toThrow();
      const normal = structuredClone(root);
      normal.simulation.buildings[normal.buildings[0].id][field] = 1001;
      expect(() => validateSave(toSave(normal), user.id)).toThrow();
    }
  });
  it.each(catalog.robots!.filter((d) => ["carrier", "smart"].includes(d.role)))(
    "loads $name at its new capacity after the specified preparation and a half-second transfer",
    (spec) => {
      let root = setup(spec.item);
      root.robots![0].energy_kj = spec.energy_capacity_kj;
      for (const [id, x] of [
        ["source", -2],
        ["target", 2],
      ] as const) {
        root.simulation.warehouse[buildingDefinitions.get("chest")!.item!] = 1;
        root = editWorld(root, {
          kind: "place",
          id,
          building_type: "chest",
          placement: { x, y: 1, rotation: 0 },
        });
      }
      root.simulation.buildings.source.output = [
        { item: iron, count: spec.capacity },
      ];
      root = actWorld(root, {
        type: "robot_task",
        id: "r",
        task_id: "full",
        source: { factory_id: root.id, building_id: "source" },
        target: { factory_id: root.id, building_id: "target" },
        item: iron,
        count: spec.capacity,
        channel: "auto",
        repeat: false,
      });
      for (let tick = 0; tick < spec.action_ticks * 2; tick++) {
        root = stepWorld(root);
        expect(root.robots![0].cargo).toBeUndefined();
      }
      root = stepWorld(root);
      expect(root.robots![0].cargo).toEqual({
        item: iron,
        count: spec.capacity,
      });
      expect(root.simulation.buildings.source.output).toEqual([]);
      for (
        let tick = 0;
        tick < 150 && root.robots![0].completed_tasks !== 1;
        tick++
      )
        root = stepWorld(root);
      expect(root.simulation.buildings.target.output).toEqual([
        { item: iron, count: spec.capacity },
      ]);
      expect(root.robots![0].cargo).toBeUndefined();
    },
  );

  it.each(["液压搬运机器人", "智能机器人"])(
    "transports a complete single-fluid load with %s without mixing or changing total volume",
    (name) => {
      const spec = catalog.robots!.find((d) => d.name === name)!;
      let root = setup(spec.item);
      root.robots![0].energy_kj = spec.energy_capacity_kj;
      const water = itemID("净化水");
      for (const [id, x] of [
        ["source", -2],
        ["target", 2],
      ] as const) {
        root.simulation.warehouse[buildingDefinitions.get("tank")!.item!] = 1;
        root = editWorld(root, {
          kind: "place",
          id,
          building_type: "tank",
          placement: { x, y: 1, rotation: 0 },
        });
      }
      root.simulation.buildings.source.fluid = {
        item: water,
        count: spec.capacity,
      };
      root = actWorld(root, {
        type: "robot_task",
        id: "r",
        task_id: "fluid",
        source: { factory_id: root.id, building_id: "source" },
        target: { factory_id: root.id, building_id: "target" },
        item: water,
        count: spec.capacity,
        channel: "auto",
        repeat: false,
      });
      for (
        let tick = 0;
        tick < 150 && root.robots![0].completed_tasks !== 1;
        tick++
      ) {
        root = stepWorld(root);
        expect(
          (root.simulation.buildings.source.fluid?.count ?? 0) +
            (root.simulation.buildings.target.fluid?.count ?? 0) +
            (root.robots![0].cargo?.count ?? 0),
        ).toBe(spec.capacity);
      }
      expect(root.simulation.buildings.target.fluid).toEqual({
        item: water,
        count: spec.capacity,
      });
    },
  );
  it.each(catalog.robots!)(
    "fills $name from paid station energy in <=30 seconds at nominal single-robot power",
    (spec) => {
      const root = setup(spec.item);
      const station = root.buildings.find((b) => b.id === "station")!;
      const definition = buildingDefinitions.get(station.building_type)!;
      let ticks = 0,
        paid = 0;
      while (
        root.robots![0].energy_kj < spec.energy_capacity_kj &&
        ticks < 60
      ) {
        root.simulation.tick = ++ticks;
        const state = root.simulation.buildings.station;
        // Isolated paid-supply fixture. Network/fuel payment is separately tested.
        const incoming = Math.min(
          definition.power_kw! / 2,
          definition.station_capacity_kj! - (state.station_energy_kj ?? 0),
        );
        paid += incoming;
        state.station_energy_kj = (state.station_energy_kj ?? 0) + incoming;
        chargeRobots(root);
      }
      expect(root.robots![0].energy_kj).toBe(spec.energy_capacity_kj);
      expect(ticks).toBeLessThanOrEqual(60);
      const spent = paid - root.simulation.buildings.station.station_energy_kj!;
      expect(
        spent * (spec.energy === "electric" ? 0.88 : 1),
      ).toBeGreaterThanOrEqual(spec.energy_capacity_kj);
    },
  );

  it.each([
    "hand_belt",
    "mechanical_belt",
    "underground_belt",
    "pipe",
    "return_pipe",
    "pressure_valve",
    "shaft",
    "hydraulic_line",
    "cable",
  ])(
    "walks through %s, saves the overlap, and transports 10 real items without duplication",
    (type) => {
      let root = setup();
      root.robots![0].energy_kj = 1000;
      for (let y = -10; y <= 10; y++) {
        if (y === 1) continue;
        const id = `wall:${y}`;
        root.buildings.push({
          id,
          factory_id: root.id,
          building_type: "chest",
          x: 1,
          y,
          rotation: 0,
          configuration: {},
        });
        root.simulation.buildings[id] = newMachine();
      }
      root.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
      root =
        type === "underground_belt"
          ? editWorld(root, {
              kind: "place_underground",
              id: "crossing",
              exitID: "exit",
              entry: { x: 1, y: 1, rotation: 0 },
              exit: { x: 2, y: 1, rotation: 0 },
            })
          : editWorld(root, {
              kind: "place",
              id: "crossing",
              building_type: type,
              placement: { x: 1, y: 1, rotation: 0 },
            });
      root.simulation.warehouse[buildingDefinitions.get("chest")!.item!] = 1;
      root = editWorld(root, {
        kind: "place",
        id: "target",
        building_type: "chest",
        placement: { x: 4, y: 1, rotation: 0 },
      });
      root.buildings[0].configuration.face_270 = {
        mode: "output",
        filter: iron,
        output_count: 20,
      };
      root.simulation.warehouse[iron] = 10;
      root = actWorld(root, {
        type: "robot_task",
        id: "r",
        task_id: "ten",
        source: { factory_id: root.id, building_id: root.buildings[0].id },
        target: { factory_id: root.id, building_id: "target" },
        item: iron,
        count: 10,
        channel: "auto",
        repeat: false,
      });
      let crossed = false;
      for (
        let tick = 0;
        tick < 150 && root.robots![0].completed_tasks !== 1;
        tick++
      ) {
        root = stepWorld(root);
        const r = root.robots![0];
        if (r.x === 1 && r.y === 1) {
          crossed = true;
          root = validateSave(toSave(root), user.id);
        }
        const total =
          (root.simulation.warehouse[iron] ?? 0) +
          (root.robots![0].cargo?.count ?? 0) +
          root.simulation.buildings.target.output.reduce(
            (n, s) => n + (s.item === iron ? s.count : 0),
            0,
          );
        expect(total).toBe(10);
      }
      expect(crossed).toBe(true);
      expect(root.simulation.buildings.target.output).toEqual([
        { item: iron, count: 10 },
      ]);
      expect(root.robots![0].completed_tasks).toBe(1);
    },
  );

  it("keeps machines, tanks, ports and construction reservations blocking", () => {
    for (const type of [
      "bus",
      "m01",
      "tank",
      "feeder",
      "splitter",
      "valve",
      "pump",
      "charge_station",
    ])
      expect(robotCanTraverse(type)).toBe(false);
    const root = setup();
    const before = structuredClone(root);
    root.robots![0].x = -2;
    root.robots![0].y = 1;
    expect(
      journey(root, root.robots![0], {
        factory_id: root.id,
        building_id: "station",
      }),
    ).toBeDefined();
    expect(() =>
      editWorld(root, {
        kind: "place",
        id: "blocked",
        building_type: "m01",
        placement: { x: -2, y: 1, rotation: 0 },
      }),
    ).toThrow(/停靠/);
    expect(before.robots![0].x).toBe(-3);
    let smart = setup(itemID("智能机器人"));
    smart.robots![0].energy_kj = 30000;
    smart.simulation.warehouse[buildingDefinitions.get("hand_belt")!.item!] = 1;
    smart = actWorld(smart, {
      type: "robot_construct",
      id: "r",
      blueprint: {
        id: "reserved-belt",
        factory_id: smart.id,
        building_type: "hand_belt",
        x: -2,
        y: 1,
        rotation: 0,
      },
    });
    expect(emptyCell(smart, { x: -2, y: 1 })).toBe(true);
    expect(emptyCell(plannedLayout(smart, smart), { x: -2, y: 1 })).toBe(false);
  });

  it("accepts bounded old work on a clone without moving or issuing real cargo, rejects excessive progress", () => {
    const root = setup();
    root.robots![0].work_progress = 8;
    const save = toSave(root),
      original = structuredClone(save);
    const loaded = validateSave(save, user.id);
    expect(loaded.robots![0].work_progress).toBe(2);
    expect(loaded.simulation.warehouse).toEqual(root.simulation.warehouse);
    expect(loaded.robots![0].cargo).toBeUndefined();
    expect(save).toEqual(original);
    const bad = structuredClone(save);
    bad.factory.robots![0].work_progress = 9;
    expect(() => validateSave(bad, user.id)).toThrow();
  });

  it("batches the same read-only routes as individual previews without modifying the world", () => {
    const root = setup();
    const before = structuredClone(root);
    expect(previewRobotRoutes(root, root.id)).toEqual([
      previewRobotRoute(root, "r"),
    ]);
    expect(previewRobotRoutes(root, root.districts![0].id)).toEqual([]);
    expect(root).toEqual(before);
  });
});
