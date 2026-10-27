import { describe, expect, it } from "vitest";
import type { BuildingInstance, BuildingPlacement } from "../../api/client";
import { catalog, direction, itemID } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { createWorld, editWorld } from "./world";
import { advanceTransport, transferSolids } from "./logistics";
import {
  undergroundItem,
  undergroundType,
  validUndergroundPairs,
} from "./underground";

const user = {
  id: "tunnel-owner",
  username: "tunnel",
  display_name: "物流员",
  created_at: "now",
  last_login_at: "now",
};
function start() {
  const f = createLocalFactory(user, "地下物流");
  const p = f.simulation.industry!;
  p.stage = 2;
  p.quests!.completed = catalog
    .quests!.filter((q) => q.stage_final && q.tier === 1)
    .map((q) => q.id);
  p.quests!.claimed = [...p.quests!.completed];
  f.simulation.warehouse[undergroundItem] = 2;
  return f;
}
function pair(
  f = start(),
  entry: BuildingPlacement = { x: -8, y: 2, rotation: 0 },
  exit: BuildingPlacement = { x: 0, y: 2, rotation: 0 },
  id = "in",
) {
  return editFactory(f, {
    kind: "place_underground",
    id,
    exitID: `${id}-out`,
    entry,
    exit,
  });
}
function node(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  rotation: BuildingInstance["rotation"] = 0,
) {
  f.buildings.push({
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    rotation,
    configuration: {},
  });
  f.simulation.buildings[id] = newMachine();
}
const run = (f: LocalFactory) => {
  f.simulation.tick++;
  advanceTransport(f, f.buildings);
  transferSolids(f, f.buildings);
};

describe("paired underground conveyors", () => {
  it.each([0, 90, 180, 270] as const)(
    "places distance 8 atomically with rotation %s and rejects distance 9",
    (rotation) => {
      const [dx, dy] = direction(rotation),
        f = start();
      const entry = { x: -dx * 4, y: 3 - dy * 4, rotation },
        exit = { x: dx * 4, y: 3 + dy * 4, rotation };
      const next = pair(f, entry, exit);
      expect(validUndergroundPairs(next.buildings)).toBe(true);
      expect(next.simulation.warehouse[undergroundItem]).toBe(1);
      expect(f.buildings).toHaveLength(1);
      expect(() =>
        pair(f, entry, { ...exit, x: exit.x + dx, y: exit.y + dy }),
      ).toThrow();
      expect(f.simulation.warehouse[undergroundItem]).toBe(2);
    },
  );
  it("rejects partial placement, locked stage, occupied ends and missing kit without mutation", () => {
    const f = start();
    expect(() =>
      editFactory(f, {
        kind: "place",
        id: "single",
        building_type: undergroundType,
        placement: { x: 2, y: 2, rotation: 0 },
      }),
    ).toThrow();
    expect(() =>
      pair(f, { x: -2, y: 0, rotation: 0 }, { x: 0, y: 0, rotation: 0 }),
    ).toThrow();
    f.simulation.industry!.stage = 1;
    expect(() => pair(f)).toThrow();
    f.simulation.industry!.stage = 2;
    f.simulation.warehouse[undergroundItem] = 0;
    expect(() => pair(f)).toThrow();
    expect(f.buildings).toHaveLength(1);
  });
  it("moves either end along its axis, preserves load, and refunds one kit and one real load on either-end deletion", () => {
    for (const id of ["in", "in-out"]) {
      let f = pair();
      const item = itemID("基础铁板");
      f.simulation.buildings["in-out"].belt = {
        id: "real-load",
        item,
        count: 6,
        progress: 0,
      };
      expect(() =>
        editFactory(f, {
          kind: "move",
          id: "in",
          placement: { x: -7, y: 3, rotation: 0 },
        }),
      ).toThrow();
      expect(() =>
        editFactory(f, {
          kind: "move",
          id: "in",
          placement: { x: -7, y: 2, rotation: 90 },
        }),
      ).toThrow();
      f = editFactory(f, {
        kind: "move",
        id: "in",
        placement: { x: -7, y: 2, rotation: 0 },
      });
      f = editFactory(f, {
        kind: "move",
        id: "in-out",
        placement: { x: 1, y: 2, rotation: 0 },
      });
      expect(f.simulation.buildings["in-out"].belt?.id).toBe("real-load");
      f = editFactory(f, { kind: "delete", id });
      expect(f.buildings).toHaveLength(1);
      expect(f.simulation.warehouse[undergroundItem]).toBe(2);
      expect(f.simulation.warehouse[item]).toBe(6);
    }
  });
  it("teleports an old batch to the exit in one transaction, then splits safely into a slow belt", () => {
    const f = pair(),
      item = itemID("基础铁板");
    node(f, "source", "flexible_belt", -9, 2);
    node(f, "destination", "hand_belt", 1, 2);
    // This test drives transport directly: externally paid power is set explicitly.
    f.simulation.buildings.source.powered = true;
    f.simulation.buildings.source.belt = {
      id: "payload",
      item,
      count: 6,
      progress: 1,
    };
    run(f);
    expect(f.simulation.buildings.source.belt).toBeUndefined();
    expect(f.simulation.buildings.in.belt).toBeUndefined();
    expect(f.simulation.buildings["in-out"].belt).toEqual({
      id: "payload",
      item,
      count: 6,
      progress: 0,
    });
    expect(f.simulation.buildings.destination.belt).toBeUndefined();
    run(f);
    expect(f.simulation.buildings["in-out"].belt?.count).toBe(5);
    expect(f.simulation.buildings.destination.belt?.count).toBe(1);
    expect(f.simulation.transfers).toHaveLength(0); // No fictitious underground flight.
  });
  it("keeps old source stock when exit is blocked, rejects side and reverse surface entry, and honors entry filter", () => {
    const f = pair(),
      item = itemID("基础铁板");
    node(f, "source", "hand_belt", -9, 2);
    f.simulation.buildings.source.belt = {
      id: "next",
      item,
      count: 1,
      progress: 2,
    };
    f.simulation.buildings["in-out"].belt = {
      id: "held",
      item,
      count: 6,
      progress: 1,
    };
    run(f);
    expect(f.simulation.buildings.source.belt?.id).toBe("next");
    delete f.simulation.buildings["in-out"].belt;
    f.buildings.find((b) => b.id === "in")!.configuration.filter =
      itemID("铜条");
    run(f);
    expect(f.simulation.buildings.source.belt?.id).toBe("next");
    delete f.buildings.find((b) => b.id === "in")!.configuration.filter;
    const source = f.buildings.find((b) => b.id === "source")!;
    Object.assign(source, { x: -8, y: 3, rotation: 90 });
    run(f);
    expect(f.simulation.buildings.source.belt?.id).toBe("next");
    Object.assign(source, { x: -1, y: 2, rotation: 0 });
    run(f);
    expect(f.simulation.buildings.source.belt?.id).toBe("next");
  });
  it("persists explicit pairs, rejects orphaned or forged pairs and permits intersecting spans", () => {
    let f = pair();
    f = pair(
      f,
      { x: -4, y: -2, rotation: 270 },
      { x: -4, y: 6, rotation: 270 },
      "cross",
    );
    expect(validateSave(toSave(f), user.id)).toBeTruthy();
    const bad = structuredClone(f);
    bad.buildings.find(
      (b) => b.id === "in-out",
    )!.configuration.underground_peer = "cross";
    expect(() => validateSave(toSave(bad), user.id)).toThrow("原存档已保留");
    const orphan = structuredClone(f);
    orphan.buildings = orphan.buildings.filter((b) => b.id !== "in-out");
    delete orphan.simulation.buildings["in-out"];
    expect(() => validateSave(toSave(orphan), user.id)).toThrow("原存档已保留");
  });
  it("checks both endpoint tiles against robot occupancy and shares the world's only warehouse", () => {
    const local = start(),
      world = createWorld(user, "世界");
    world.simulation.industry = local.simulation.industry;
    world.simulation.warehouse = local.simulation.warehouse;
    const child = world.districts![0];
    world.active_district_id = child.id;
    world.robots = [
      { factory_id: child.id, x: 9, y: 2 } as NonNullable<
        LocalFactory["robots"]
      >[number],
    ];
    expect(() =>
      editWorld(
        world,
        {
          kind: "place_underground",
          id: "a",
          exitID: "b",
          entry: { x: 1, y: 2, rotation: 0 },
          exit: { x: 9, y: 2, rotation: 0 },
        },
        child.id,
      ),
    ).toThrow(/机器人/);
    delete world.robots;
    const next = editWorld(
      world,
      {
        kind: "place_underground",
        id: "a",
        exitID: "b",
        entry: { x: 1, y: 2, rotation: 0 },
        exit: { x: 9, y: 2, rotation: 0 },
      },
      child.id,
    );
    expect(next.simulation.warehouse[undergroundItem]).toBe(1);
    expect(next.districts![0].simulation.warehouse).toEqual({});
    expect(next.districts![0].buildings).toHaveLength(3);
    expect(validateSave(toSave(next), user.id)).toBeTruthy();
  });
});
