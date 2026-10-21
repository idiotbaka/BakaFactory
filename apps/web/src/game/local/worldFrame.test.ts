import { describe, it, expect } from "vitest";
import { createWorld, stepWorld, projectFactory } from "./world";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";
import { worldFrame, applyWorldFrame } from "./worldFrame";
import { catalog, itemID, buildingDefinitions } from "./catalog";
import { endpointBuilding } from "./robotRoutes";
import { step } from "./simulation";
const user = {
  id: "frames",
  username: "frames",
  display_name: "快照",
  created_at: "now",
  last_login_at: "now",
};
function setup() {
  const r = createWorld(user, "完整世界");
  r.simulation.industry!.stage = 6;
  r.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  return r;
}
function station(root: LocalFactory) {
  root.buildings.push({
    id: "station",
    factory_id: root.id,
    building_type: "charge_station",
    x: 4,
    y: 0,
    rotation: 0,
    configuration: {},
  });
  root.simulation.buildings.station = newMachine();
}
describe("incremental world snapshots and immutable quiet factories", () => {
  it("normalizes stale power metadata through a full child step before using the quiet path", () => {
    const root = stepWorld(setup()),
      child = root.districts![0];
    child.simulation.buildings[child.buildings[0].id].power_demand_kw = 5;
    child.simulation.buildings[child.buildings[0].id].network_id = "stale";
    const expected = step(child, false),
      old = structuredClone(root);
    expect(stepWorld(root).districts![0]).toEqual(expected);
    expect(root).toEqual(old);
  });
  it("indexes valid factory and endpoint IDs without separator collisions", () => {
    const r = setup(),
      child = r.districts![0];
    r.id = "a";
    r.buildings[0].id = "b:c";
    child.id = "a:b";
    child.buildings[0].id = "c";
    expect(endpointBuilding(r, { factory_id: "a", building_id: "b:c" })).toBe(
      r.buildings[0],
    );
    expect(endpointBuilding(r, { factory_id: "a:b", building_id: "c" })).toBe(
      child.buildings[0],
    );
  });
  it("reconstructs the exact full world while omitting unchanged layouts and quiet simulation bodies", () => {
    const before = stepWorld(setup()),
      previous = structuredClone(before),
      after = stepWorld(before),
      frame = structuredClone(worldFrame(before, after));
    expect(frame.factories.every((f) => !f.buildings)).toBe(true);
    expect(frame.factories.slice(1).every((f) => !f.simulation)).toBe(true);
    expect(applyWorldFrame(before, frame)).toEqual(after);
    expect(before).toEqual(previous);
    expect(JSON.stringify(frame).length).toBeLessThan(
      JSON.stringify(after).length,
    );
    expect(() =>
      applyWorldFrame(before, {
        ...frame,
        base_revision: frame.base_revision + 1,
      }),
    ).toThrow();
    expect(() =>
      applyWorldFrame(before, {
        ...frame,
        factories: frame.factories.slice(1),
      }),
    ).toThrow();
    expect(() =>
      applyWorldFrame(before, {
        ...frame,
        factories: [...frame.factories, frame.factories[0]],
      }),
    ).toThrow();
    const wrongChildClock = structuredClone(frame);
    wrongChildClock.factories[1].revision++;
    expect(() => applyWorldFrame(before, wrongChildClock)).toThrow();
    const wrongSimulationTick = structuredClone(frame);
    wrongSimulationTick.factories[0].simulation!.tick++;
    expect(() => applyWorldFrame(before, wrongSimulationTick)).toThrow();
  });
  it("does not mutate the prior quiet warehouse when a robot really delivers into it", () => {
    const root = stepWorld(setup());
    station(root);
    const child = root.districts![0],
      iron = itemID("基础铁板");
    root.robots = [
      {
        id: "r",
        item: itemID("智能机器人"),
        home_factory_id: root.id,
        home_station: "station",
        factory_id: child.id,
        x: 1,
        y: 0,
        energy_kj: 30000,
        enabled: true,
        allowed_zones: [root.id, child.id],
        priority: 3,
        cooldown: 0,
        status: "unloading",
        work_progress: 2,
        cargo: { item: iron, count: 1 },
        task: {
          id: "job",
          source: { factory_id: root.id, building_id: root.buildings[0].id },
          target: { factory_id: child.id, building_id: child.buildings[0].id },
          item: iron,
          count: 1,
          channel: "auto",
          repeat: false,
          phase: "deliver",
          delivered: 0,
        },
      },
    ];
    const old = structuredClone(root),
      after = stepWorld(root);
    expect(root).toEqual(old);
    expect(after.districts![0].simulation.warehouse[iron]).toBe(1);
    expect(
      applyWorldFrame(root, structuredClone(worldFrame(root, after))),
    ).toEqual(after);
  });
  it("ships a real construction layout change and invalidates the endpoint index atomically", () => {
    const root = setup();
    station(root);
    const type = "m03",
      endpoint = { factory_id: root.id, building_id: "site" };
    root.robots = [
      {
        id: "r",
        item: itemID("智能机器人"),
        home_factory_id: root.id,
        home_station: "station",
        factory_id: root.id,
        x: 6,
        y: 1,
        energy_kj: 30000,
        enabled: true,
        allowed_zones: [root.id],
        priority: 3,
        cooldown: 0,
        status: "constructing",
        work_progress: 9,
        cargo: { item: buildingDefinitions.get(type)!.item!, count: 1 },
        construction: {
          id: "site",
          factory_id: root.id,
          building_type: type,
          x: 6,
          y: 2,
          rotation: 0,
        },
      },
    ];
    expect(endpointBuilding(root, endpoint)).toBeUndefined();
    const old = structuredClone(root),
      after = stepWorld(root),
      frame = structuredClone(worldFrame(root, after));
    expect(root).toEqual(old);
    expect(endpointBuilding(after, endpoint)?.id).toBe("site");
    expect(frame.factories[0].buildings?.some((b) => b.id === "site")).toBe(
      true,
    );
    const restored = applyWorldFrame(root, frame);
    expect(restored).toEqual(after);
    expect(validateSave(toSave(restored), user.id)).toEqual(restored);
    expect(projectFactory(restored).districts).toBeUndefined();
  });
});
