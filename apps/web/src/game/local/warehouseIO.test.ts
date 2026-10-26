import { describe, expect, it } from "vitest";
import { catalog, itemID } from "./catalog";
import {
  createWorld,
  actWorld,
  editWorld,
  stepWorld,
  projectFactory,
} from "./world";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";
import {
  pickupType,
  intakeType,
  ioQuestID,
  ioCost,
  ioLimit,
} from "./warehouseIO";
import { advanceTransport, transferSolids } from "./logistics";
import type { BuildingInstance } from "../../api/client";

const user = {
  id: "io-owner",
  username: "io-owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
function start(stage = 2, unlocked = false) {
  const root = createWorld(user, "终端工厂"),
    p = root.simulation.industry!;
  p.stage = stage;
  const previous = catalog
    .quests!.filter((q) => q.stage_final && q.tier < stage)
    .map((q) => q.id);
  p.quests!.completed = [...previous, ...(unlocked ? [ioQuestID] : [])];
  p.quests!.claimed = [...p.quests!.completed];
  return root;
}
function node(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  configuration = {},
  rotation: BuildingInstance["rotation"] = 0,
) {
  f.buildings.push({
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    rotation,
    configuration,
  });
  f.simulation.buildings[id] = newMachine();
  return f.buildings.at(-1)!;
}
const move = (f: LocalFactory) => {
  f.simulation.tick++;
  advanceTransport(f, f.buildings);
  transferSolids(f, f.buildings);
};

describe("warehouse IO upgrades and actual submissions", () => {
  it("does not complete merely by holding materials; submits both atomically and unlocks only on claim", () => {
    let f = start();
    const iron = itemID("基础铁板"),
      copper = itemID("铜条");
    f.simulation.warehouse = { [iron]: 80, [copper]: 49 };
    const before = structuredClone(f);
    expect(() =>
      actWorld(f, { type: "submit_quest", id: ioQuestID }),
    ).toThrow();
    expect(f).toEqual(before);
    f.simulation.warehouse[copper] = 50;
    f = stepWorld(f);
    expect(f.simulation.industry!.quests!.completed).not.toContain(ioQuestID);
    f = actWorld(f, { type: "submit_quest", id: ioQuestID });
    expect(f.simulation.warehouse).toMatchObject({ [iron]: 30, [copper]: 0 });
    expect(() =>
      actWorld(f, { type: "upgrade_io", id: f.id, terminal: pickupType }),
    ).toThrow();
    expect(() =>
      actWorld(f, { type: "submit_quest", id: ioQuestID }),
    ).toThrow();
    f = actWorld(f, { type: "claim_quest", id: ioQuestID });
    expect(() => actWorld(f, { type: "claim_quest", id: ioQuestID })).toThrow();
    f = actWorld(f, { type: "upgrade_io", id: f.id, terminal: pickupType });
    expect(f.simulation.warehouse[iron]).toBe(0);
  });
  it("charges the current stage, enforces per-factory caps, and preserves movable terminal identity", () => {
    let f = start(2, true);
    const iron = itemID("基础铁板");
    f.simulation.warehouse[iron] = 120;
    const child = f.districts![0].id;
    f = actWorld(f, { type: "upgrade_io", id: child, terminal: pickupType });
    f = actWorld(f, { type: "upgrade_io", id: child, terminal: pickupType });
    expect(() =>
      actWorld(f, { type: "upgrade_io", id: child, terminal: pickupType }),
    ).toThrow(/上限/);
    f = actWorld(f, { type: "upgrade_io", id: f.id, terminal: pickupType });
    expect(f.simulation.warehouse[iron]).toBe(30);
    expect(f.districts![0].simulation.warehouse).toEqual({});
    const b = f.buildings.find((b) => b.building_type === pickupType)!;
    f = editWorld(f, {
      kind: "move",
      id: b.id,
      placement: { x: 6, y: 6, rotation: 180 },
    });
    expect(f.buildings.find((v) => v.id === b.id)).toMatchObject({
      x: 6,
      y: 6,
      rotation: 180,
    });
    expect(() => editWorld(f, { kind: "delete", id: b.id })).toThrow(
      /不能删除/,
    );
    expect(() =>
      editWorld(f, {
        kind: "place",
        id: "free",
        building_type: intakeType,
        placement: { x: 7, y: 7, rotation: 0 },
      }),
    ).toThrow();
    const saved = toSave(f);
    expect(validateSave(saved, user.id).buildings).toEqual(f.buildings);
    const invalid = structuredClone(saved);
    invalid.factory.simulation!.industry!.quests!.claimed = ["p1_free_hands"];
    expect(() => validateSave(invalid, user.id)).toThrow();
    for (const stage of [2, 3, 4, 6]) {
      expect(ioLimit(stage, pickupType)).toBe(Math.min(3, stage - 1) * 2);
      expect(ioLimit(stage, intakeType)).toBe(Math.min(3, stage - 1));
      for (const type of [pickupType, intakeType] as const) {
        const next = start(stage, true);
        next.simulation.warehouse = Object.fromEntries(
          Object.keys(ioCost(stage, type)).map((id) => [id, 30]),
        );
        expect(
          Object.values(
            actWorld(next, { type: "upgrade_io", id: next.id, terminal: type })
              .simulation.warehouse,
          ),
        ).toEqual([0]);
      }
    }
  });
  it("rejects a full map before charging and keeps shared projection unchanged", () => {
    const f = start(2, true);
    f.simulation.warehouse[itemID("基础铁板")] = 30;
    for (let y = -10; y <= 10; y++)
      for (let x = -10; x <= 10; x++) {
        if (x || y) node(f, `full:${x}:${y}`, "hand_belt", x, y);
      }
    const before = structuredClone(f);
    expect(() =>
      actWorld(f, { type: "upgrade_io", id: f.id, terminal: pickupType }),
    ).toThrow(/空闲格子/);
    expect(f).toEqual(before);
    expect(projectFactory(f).simulation.warehouse).toEqual(
      before.simulation.warehouse,
    );
  });
});

describe("terminal transfers", () => {
  it("does not consume blocked stock, export sideways, or accept an empty/duplicate/fluid selection", () => {
    const f = start(2, true),
      item = itemID("基础铁板");
    const b = node(f, "pickup", pickupType, 3, 3, { output_items: [item] });
    node(f, "front", "hand_belt", 4, 3);
    f.simulation.buildings.front.belt = { id: "occupied", item, progress: 3 };
    node(f, "side", "item_output", 3, 4, {}, 270);
    node(f, "side-chest", "chest", 3, 5);
    f.simulation.warehouse[item] = 5;
    move(f);
    expect(f.simulation.warehouse[item]).toBe(5);
    expect(f.simulation.buildings.pickup.terminal_cursor ?? 0).toBe(0);
    for (const output_items of [[], [item, item], [itemID("净化水")]]) {
      expect(() =>
        editWorld(f, {
          kind: "industry",
          action: { type: "transport", id: b.id, output_items },
        }),
      ).toThrow();
      expect(b.configuration.output_items).toEqual([item]);
    }
  });
  it("round-robins successful items, skips shortages/rejection and resumes cursor after reload", () => {
    let f = start(2, true);
    const a = itemID("基础铁板"),
      b = itemID("铜条");
    node(f, "pickup", pickupType, 3, 3, { output_items: [a, b] });
    node(f, "chest", "chest", 4, 3);
    f.simulation.warehouse = { [a]: 5, [b]: 5 };
    move(f);
    expect(f.simulation.buildings.pickup.terminal_cursor).toBe(1);
    expect(f.simulation.buildings.chest.output).toEqual([
      { item: a, count: 1 },
    ]);
    f = validateSave(toSave(f), user.id);
    move(f);
    expect(f.simulation.buildings.chest.output).toEqual([
      { item: a, count: 1 },
      { item: b, count: 1 },
    ]);
    f.simulation.warehouse[a] = 0;
    move(f);
    expect(f.simulation.buildings.chest.output[1].count).toBe(2);
    f.simulation.warehouse[a] = 3;
    f.buildings.find((n) => n.id === "chest")!.configuration.filter = b;
    move(f);
    expect(f.simulation.buildings.chest.output[1].count).toBe(3);
  });
  it("limits extractors to one item, accepts intake from four sides and conserves the last shared item", () => {
    let f = start(2, true);
    const item = itemID("基础铁板");
    node(f, "pickup", pickupType, 3, 3, { output_items: [item] });
    node(f, "port", "item_output", 4, 3);
    node(f, "chest", "chest", 5, 3);
    f.simulation.warehouse[item] = 4;
    move(f);
    expect(f.simulation.warehouse[item]).toBe(3);
    expect(f.simulation.buildings.chest.output).toEqual([{ item, count: 1 }]);
    node(f, "intake", intakeType, -5, -5);
    for (const [i, x, y, rotation] of [
      [0, -6, -5, 0],
      [1, -5, -4, 90],
      [2, -4, -5, 180],
      [3, -5, -6, 270],
    ] as const) {
      node(f, `belt${i}`, "hand_belt", x, y, {}, rotation);
      f.simulation.buildings[`belt${i}`].belt = {
        id: `payload${i}`,
        item,
        progress: 3,
      };
    }
    move(f);
    expect(f.simulation.buildings.intake.output).toEqual([]);
    expect(f.simulation.industry!.quests!.warehouse_received![item]).toBe(4);
    expect(f.simulation.warehouse[item]).toBe(6);
    f = start(2, true);
    f.simulation.warehouse[item] = 1;
    node(f, "p0", pickupType, 3, 3, { output_items: [item] });
    node(f, "c0", "chest", 4, 3);
    const child = f.districts![0];
    node(child, "p1", pickupType, 3, 3, { output_items: [item] });
    node(child, "c1", "chest", 4, 3);
    const next = stepWorld(f);
    expect(next.simulation.warehouse[item]).toBe(0);
    expect(
      next.simulation.buildings.c0.output.reduce((n, s) => n + s.count, 0) +
        next.districts![0].simulation.buildings.c1.output.reduce(
          (n, s) => n + s.count,
          0,
        ),
    ).toBe(1);
    expect(f.simulation.warehouse[item]).toBe(1);
  });
});
