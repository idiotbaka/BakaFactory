import { describe, expect, it } from "vitest";
import { buildingDefinitions, itemID, recipeDefinitions } from "./catalog";
import {
  createLocalFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import {
  actWorld,
  allDistricts,
  createWorld,
  editWorld,
  stepWorld,
} from "./world";
import { interval } from "./transportConfig";

const user = {
  id: "logistics-upgrade",
  username: "upgrade",
  display_name: "物流",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板");
function node(f: LocalFactory, id: string, type: string, x: number) {
  f.buildings.push({
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y: 2,
    rotation: 0,
    configuration: {},
  });
  f.simulation.buildings[id] = newMachine();
  return f.buildings.at(-1)!;
}
function feederLine(target = "chest") {
  const f = createLocalFactory(user, "投料");
  node(f, "source", "chest", 1);
  node(f, "feeder", "feeder", 2);
  node(f, "target", target, 3);
  return f;
}

describe("logistics gameplay upgrades", () => {
  it("defaults the basic feeder to twenty items every half second and keeps explicit intervals", () => {
    let f = feederLine();
    const feeder = f.buildings.find((b) => b.id === "feeder")!;
    expect(buildingDefinitions.get("feeder")!.batch_size).toBe(20);
    expect(interval(feeder)).toBe(0.5);
    feeder.configuration.interval = 1.5;
    expect(
      interval(
        validateSave(toSave(f), user.id).buildings.find(
          (b) => b.id === "feeder",
        )!,
      ),
    ).toBe(1.5);
    delete feeder.configuration.interval;
    f.simulation.buildings.source.output = [{ item: iron, count: 60 }];
    const before = structuredClone(f);
    for (let tick = 1; tick <= 3; tick++) {
      f = step(f);
      expect(f.simulation.buildings.target.output).toEqual([
        { item: iron, count: tick * 20 },
      ]);
      expect(
        f.simulation.transfers!.filter((t) => t.tick === tick)[0].count,
      ).toBe(20);
      expect(f.simulation.buildings.feeder.cooldown).toBe(0.5);
    }
    expect(f.simulation.buildings.source.output).toEqual([]);
    expect(before.simulation.buildings.source.output[0].count).toBe(60);
  });

  it("caps each feeder batch to real receiver space and never debits blocked belt arrivals", () => {
    let f = feederLine("hand_belt");
    f.simulation.buildings.source.output = [{ item: iron, count: 40 }];
    f = step(f);
    expect(f.simulation.buildings.target.belt?.count).toBe(2);
    expect(f.simulation.buildings.source.output[0].count).toBe(38);
    f = step(f);
    expect(f.simulation.buildings.source.output[0].count).toBe(38);
    expect(
      f.simulation.transfers!.filter((t) => t.tick === f.simulation.tick),
    ).toEqual([]);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();

    let machine = feederLine("m02");
    machine.buildings.find((b) => b.id === "target")!.configuration.recipe_id =
      "r1001";
    const trash = itemID("垃圾包");
    machine.simulation.buildings.source.output = [{ item: trash, count: 100 }];
    machine.simulation.buildings.target.input = [{ item: trash, count: 95 }];
    machine = step(machine);
    expect(machine.simulation.buildings.target.input).toEqual([
      { item: trash, count: 100 },
    ]);
    expect(machine.simulation.buildings.source.output[0].count).toBe(95);
    expect(machine.simulation.transfers!.at(-1)!.count).toBe(5);
  });

  it("installs paid sources beyond old stage limits in root and child factories and reloads without loss", () => {
    let world = createWorld(user, "垃圾多厂");
    const kit = buildingDefinitions.get("waste_port")!.item!;
    world.simulation.warehouse[kit] = 6;
    const ids = [world.id, world.districts![0].id];
    for (const id of ids) {
      world = actWorld(world, { type: "select_district", id });
      for (let n = 0; n < 3; n++) {
        world = editWorld(world, {
          kind: "place",
          id: `source:${id}:${n}`,
          building_type: "waste_port",
          placement: { x: n - 1, y: 10, rotation: 0 },
        });
      }
    }
    expect(world.simulation.warehouse[kit]).toBe(0);
    expect(
      allDistricts(world)
        .flatMap((f) => f.buildings)
        .filter((b) => b.building_type === "waste_port"),
    ).toHaveLength(6);
    const original = structuredClone(world);
    expect(() =>
      editWorld(world, {
        kind: "place",
        id: "bad-row",
        building_type: "waste_port",
        placement: { x: 2, y: 9, rotation: 0 },
      }),
    ).toThrow(/顶部/);
    expect(world).toEqual(original);
    for (let tick = 0; tick < 20; tick++) world = stepWorld(world);
    const trash = itemID("垃圾包");
    expect(
      allDistricts(world).reduce(
        (sum, f) =>
          sum +
          Object.values(f.simulation.buildings).reduce(
            (sum, m) =>
              sum +
              m.output
                .filter((s) => s.item === trash)
                .reduce((sum, s) => sum + s.count, 0),
            0,
          ),
        0,
      ),
    ).toBe(72);
    const restored = validateSave(toSave(world), user.id);
    expect(restored).toEqual(world);
    expect(
      restored.districts!.every(
        (f) => Object.keys(f.simulation.warehouse).length === 0,
      ),
    ).toBe(true);
  });

  it("uses two gears and two basic iron plates for the existing underground kit", () => {
    const recipe = recipeDefinitions.get("web_underground_belt")!;
    expect(recipe.inputs).toEqual({ [itemID("简易齿轮")]: 2, [iron]: 2 });
    expect(recipe.outputs).toEqual({ d0001: 1 });
    expect(recipe.duration_ms).toBe(12000);
  });

  it("pays the same pump power for twice-per-second fluid movement and stops when disconnected", () => {
    let f = createLocalFactory(user, "半秒液压");
    node(f, "gen", "m21", 1);
    const wire = node(f, "wire", "hydraulic_line", 2);
    node(f, "pump", "pump", 3);
    node(f, "tank", "tank", 4);
    const water = itemID("净化水");
    f.simulation.buildings.gen.medium = 1;
    f.simulation.buildings.gen.energy_kj = 10;
    f.simulation.buildings.pump.fluid = { item: water, count: 10 };
    f = step(f);
    expect(f.simulation.buildings.gen.energy_kj).toBe(7.5);
    expect(f.simulation.buildings.pump.supplied_kw).toBe(5);
    expect(f.simulation.buildings.tank.fluid?.count).toBe(4);
    f = step(f);
    expect(f.simulation.buildings.gen.energy_kj).toBe(5);
    expect(f.simulation.buildings.tank.fluid?.count).toBe(8);
    f.buildings = f.buildings.filter((b) => b.id !== wire.id);
    f = step(f);
    expect(f.simulation.buildings.gen.energy_kj).toBe(5);
    expect(f.simulation.buildings.tank.fluid?.count).toBe(8);
    expect(f.simulation.buildings.pump.fluid?.count).toBe(2);
    expect(f.simulation.buildings.pump.powered).toBe(false);
  });
});
