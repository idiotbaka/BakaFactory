import { describe, expect, it } from "vitest";
import { catalog, beltCapacity, beltTicks, itemID } from "./catalog";
import {
  createLocalFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import { stepWorld, createWorld, initializeWorld } from "./world";
import { transferSolids } from "./logistics";
import { isStepValue, onInterval, wholeUnitsThisTick } from "./simulationTime";
import { validTransportConfig } from "./transportConfig";

const user = {
  id: "clock",
  username: "clock",
  display_name: "时钟",
  created_at: "now",
  last_login_at: "now",
};
function start() {
  const f = createLocalFactory(user, "半秒工厂");
  const p = f.simulation.industry!;
  p.stage = 6;
  p.quests!.completed = catalog
    .quests!.filter((q) => q.stage_final)
    .map((q) => q.id);
  p.quests!.claimed = [...p.quests!.completed];
  return f;
}
function node(f: LocalFactory, id: string, type: string, x: number, y = 2) {
  const b = {
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    rotation: 0 as const,
    configuration: {},
  };
  f.buildings.push(b);
  f.simulation.buildings[id] = newMachine();
  return b;
}
const item = itemID("铁质碎片");

describe("shared half-second simulation time", () => {
  it.each([
    ["hand_belt", 2, 2, "", ""],
    ["mechanical_belt", 1, 2, "m09", "shaft"],
    ["hydraulic_belt", 1, 10, "m21", "hydraulic_line"],
    ["electric_belt", 1, 20, "m28", "cable"],
    ["precision_belt", 1, 50, "m28", "cable"],
    ["flexible_belt", 1, 100, "m28", "cable"],
  ] as const)(
    "moves the whole %s load after its exact interval",
    (type, ticks, count, gen, wire) => {
      let f = start();
      node(f, "belt", type, 3);
      node(f, "box", "chest", 4);
      if (gen) {
        node(f, "generator", gen, 1);
        node(f, "wire", wire, 2);
        f.simulation.buildings.generator.fuel = [
          { item: itemID(gen === "m09" ? "固体燃料块" : "液体燃料"), count: 1 },
        ];
        if (gen === "m21") f.simulation.buildings.generator.medium = 1;
      }
      expect(beltCapacity(type)).toBe(count);
      expect(beltTicks(type)).toBe(ticks);
      f.simulation.buildings.belt.belt = {
        id: "load",
        item,
        count,
        progress: 0,
      };
      const before = structuredClone(f);
      for (let n = 1; n < ticks; n++) {
        f = step(f);
        expect(f.simulation.buildings.box.output).toEqual([]);
      }
      f = step(f);
      expect(f.simulation.buildings.belt.belt).toBeUndefined();
      expect(f.simulation.buildings.box.output).toEqual([{ item, count }]);
      expect(before.simulation.buildings.belt.belt?.count).toBe(count);
      expect(
        validateSave(toSave(f), user.id).simulation.buildings.box.output,
      ).toEqual([{ item, count }]);
    },
  );

  it("does not double production or manual work, and preserves half-second saves", () => {
    let f = createLocalFactory(user, "原工时");
    node(f, "miner", "miner", 2);
    f = step(f);
    expect(f.simulation.buildings.miner.progress).toBe(0.5);
    expect(f.simulation.buildings.miner.output).toEqual([]);
    expect(validateSave(toSave(f), user.id)).toEqual(f);
    f = step(f);
    expect(f.simulation.buildings.miner.output).toEqual([
      { item: "iron_ore", count: 1 },
    ]);
    const manual = createLocalFactory(user, "手工");
    manual.simulation.industry!.workshop = { recipe_id: "r1001", progress: 0 };
    expect(step(manual).simulation.industry!.workshop?.progress).toBe(0.5);
  });

  it("supports half-second feeder intervals with twenty-item batches", () => {
    for (const interval of [0.5, 1, 1.5]) {
      let f = start();
      node(f, "source", "chest", 1);
      const port = node(f, "port", "feeder", 2);
      node(f, "target", "chest", 3);
      port.configuration = { interval } as typeof port.configuration;
      f.simulation.buildings.source.output = [{ item, count: 100 }];
      for (let n = 0; n < 6; n++) f = step(f);
      const transferred = interval === 0.5 ? 100 : interval === 1 ? 60 : 40;
      expect(f.simulation.buildings.target.output).toEqual([
        { item, count: transferred },
      ]);
      expect(
        (f.simulation.buildings.source.output[0]?.count ?? 0) + transferred,
      ).toBe(100);
      expect(
        validateSave(toSave(f), user.id).simulation.buildings.port.cooldown,
      ).toBe(f.simulation.buildings.port.cooldown);
    }
    expect(
      validTransportConfig({
        building_type: "feeder",
        configuration: { interval: 0.25 },
      }),
    ).toBe(false);
  });

  it("splits a hundred-item load onto two-item belts without loss or duplicate payload IDs", () => {
    const f = start();
    node(f, "fast", "flexible_belt", -2, 0);
    node(f, "slow", "hand_belt", -1, 0);
    f.simulation.buildings.fast.powered = true;
    f.simulation.buildings.fast.belt = {
      id: "large",
      item,
      count: 100,
      progress: 1,
    };
    for (let n = 0; n < 51; n++) {
      f.simulation.tick++;
      if (f.simulation.buildings.slow.belt)
        f.simulation.buildings.slow.belt!.progress = 2;
      transferSolids(f, f.buildings);
      const payloads = Object.values(f.simulation.buildings).flatMap((m) =>
        m.belt ? [m.belt] : [],
      );
      expect(new Set(payloads.map((p) => p.id)).size).toBe(payloads.length);
      expect(
        payloads.reduce((sum, p) => sum + p.count!, 0) +
          (f.simulation.warehouse[item] ?? 0),
      ).toBe(100);
    }
    expect(f.simulation.warehouse[item]).toBe(100);
  });

  it("pays 0.5 kJ per half second for a 1 kW belt, and stops after disconnection", () => {
    let f = start();
    node(f, "gen", "m09", 1);
    const wire = node(f, "wire", "shaft", 2);
    node(f, "belt", "mechanical_belt", 3);
    f.simulation.buildings.gen.energy_kj = 10;
    f = step(f);
    // Belt 0.5 kJ + shaft loss 0.5 kJ; power displays remain kW.
    expect(f.simulation.buildings.gen.energy_kj).toBe(9);
    expect(f.simulation.buildings.gen.generated_kw).toBe(2);
    expect(f.simulation.buildings.belt.powered).toBe(true);
    expect(f.simulation.buildings.belt.supplied_kw).toBe(1);
    f = step(f);
    expect(f.simulation.buildings.gen.energy_kj).toBe(8);
    f.buildings.find((b) => b.id === wire.id)!.configuration.enabled = false;
    f = step(f);
    expect(f.simulation.buildings.gen.energy_kj).toBe(8);
    expect(f.simulation.buildings.belt.powered).toBe(false);
  });

  it("keeps one-item-per-second warehouse output across half ticks", () => {
    let f = start();
    f.buildings[0].configuration.face_0 = { mode: "output", filter: item };
    node(f, "box", "chest", 1, 0);
    f.simulation.warehouse[item] = 10;
    for (let n = 0; n < 6; n++) f = step(f);
    expect(f.simulation.buildings.box.output).toEqual([{ item, count: 3 }]);
  });

  it("moves fluid and robots every half second", () => {
    let fluid = start();
    node(fluid, "a", "pipe", 2, 0);
    node(fluid, "b", "pipe", 3, 0);
    const water = itemID("净化水");
    fluid.simulation.buildings.a.fluid = { item: water, count: 2 };
    fluid = step(fluid);
    expect(fluid.simulation.buildings.b.fluid).toEqual({
      item: water,
      count: 2,
    });
    expect(fluid.simulation.buildings.a.flow_out).toBe(2);
    fluid = step(fluid);
    expect(fluid.simulation.buildings.a.flow_out).toBe(0);

    let robot = initializeWorld(start());
    node(robot, "station", "m18", 4, 0);
    robot.robots = [
      {
        id: "r",
        item: itemID("发条搬运车"),
        home_factory_id: robot.id,
        home_station: "station",
        factory_id: robot.id,
        x: 8,
        y: 0,
        energy_kj: 1000,
        enabled: true,
        allowed_zones: [robot.id],
        priority: 3,
        cooldown: 0,
        status: "returning",
        returning: "complete",
      },
    ];
    robot = stepWorld(robot);
    expect(robot.robots![0].x).toBe(7);
    robot = stepWorld(robot);
    expect(robot.robots![0].x).toBe(6);
    expect(robot.robots![0].energy_kj).toBe(998);
    robot = stepWorld(robot);
    expect(robot.robots![0].x).toBe(5);
    expect(robot.robots![0].status).toBe("returning");
  });

  it("does not starve alternating extractors when a producer becomes ready only on even ticks", () => {
    let f = start();
    node(f, "producer", "miner", 4, 0);
    node(f, "left", "item_output", 3, 0);
    f.buildings.find((b) => b.id === "left")!.rotation = 180;
    node(f, "right", "item_output", 5, 0);
    node(f, "left-box", "chest", 2, 0);
    node(f, "right-box", "chest", 6, 0);
    for (let tick = 0; tick < 20; tick++) f = step(f);
    expect(f.simulation.buildings["left-box"].output).toEqual([
      { item: "iron_ore", count: 5 },
    ]);
    expect(f.simulation.buildings["right-box"].output).toEqual([
      { item: "iron_ore", count: 5 },
    ]);
  });

  it("upgrades an old multi-factory clock once while preserving stock, IDs and second-based progress", () => {
    const old = createWorld(user, "旧世界");
    for (const f of [old, ...old.districts!]) {
      f.simulation.tick_rate = 1;
      f.simulation.tick = 7;
    }
    node(old, "belt", "hand_belt", -1, 0);
    old.simulation.buildings.belt.belt = {
      id: "old",
      item,
      count: 1,
      progress: 3,
    };
    old.simulation.industry!.workshop = { recipe_id: "r1001", progress: 2 };
    old.simulation.warehouse[item] = 13;
    const before = structuredClone(old);
    const next = validateSave(toSave(old), user.id);
    expect(old).toEqual(before);
    expect(next.simulation.tick).toBe(14);
    expect(
      next.districts!.every(
        (f) => f.simulation.tick === 14 && f.simulation.tick_rate === 2,
      ),
    ).toBe(true);
    expect(next.simulation.buildings.belt.belt).toEqual({
      id: "old",
      item,
      count: 1,
      progress: 2,
    });
    expect(next.simulation.industry!.workshop?.progress).toBe(2);
    expect(next.simulation.warehouse[item]).toBe(13);
    expect(validateSave(toSave(next), user.id)).toEqual(next);
    expect(stepWorld(next).simulation.tick).toBe(15);
  });

  it("keeps fractional state exact and rejects finer unsupported increments", () => {
    expect(isStepValue(0.5, 60)).toBe(true);
    expect(isStepValue(0.25, 60)).toBe(false);
    expect(isStepValue(NaN, 60)).toBe(false);
    expect([1, 2, 3, 4].map((tick) => wholeUnitsThisTick(15, tick))).toEqual([
      7, 8, 7, 8,
    ]);
    expect(onInterval(9, 1.5)).toBe(true);
    const f = createLocalFactory(user, "精度");
    f.simulation.buildings[f.buildings[0].id].cooldown = 0.25;
    expect(() => validateSave(toSave(f), user.id)).toThrow();
  });
});
