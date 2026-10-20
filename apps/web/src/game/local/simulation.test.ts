import { describe, expect, it } from "vitest";
import {
  createLocalFactory,
  editFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";

const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
function add(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y = 0,
  rotation: 0 | 90 | 180 | 270 = 0,
) {
  return editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation },
  });
}
function advance(f: LocalFactory, n: number) {
  for (let i = 0; i < n; i++) f = step(f);
  return f;
}
function total(f: LocalFactory) {
  return (
    Object.values(f.simulation.warehouse).reduce((n, c) => n + c, 0) +
    Object.values(f.simulation.buildings).reduce(
      (n, m) =>
        n +
        [...m.input, ...m.output].reduce((a, s) => a + s.count, 0) +
        (m.belt ? 1 : 0),
      0,
    )
  );
}
describe("client authoritative simulation", () => {
  it("delivers gears through the complete chain and conserves every mined unit", () => {
    let f = createLocalFactory(user, "守恒产线");
    const types = [
      "miner",
      "item_output",
      "conveyor",
      "item_input",
      "furnace",
      "item_output",
      "conveyor",
      "item_input",
      "assembler",
      "item_output",
    ];
    for (let i = 0; i < types.length; i++)
      f = add(f, `line-${i}`, types[i], -10 + i);
    const start = structuredClone(f);
    f = advance(f, 20);
    expect(f.simulation.tick).toBe(20);
    expect(f.simulation.warehouse.gear).toBeGreaterThanOrEqual(1);
    expect(total(f)).toBe(20);
    expect(start.simulation.tick).toBe(0);
    expect(advance(start, 20)).toEqual(f);
  });
  it("uses one stack per item, blocks at capacity and consumes inputs only on completion", () => {
    let f = add(createLocalFactory(user, "配方"), "f", "furnace", 1);
    f.simulation.buildings.f.input = [{ item: "iron_ore", count: 2 }];
    f = advance(f, 3);
    expect(f.simulation.buildings.f.input[0].count).toBe(2);
    expect(f.simulation.buildings.f.output).toEqual([]);
    f = step(f);
    expect(f.simulation.buildings.f.input[0].count).toBe(1);
    expect(f.simulation.buildings.f.output).toEqual([
      { item: "iron_plate", count: 1 },
    ]);
    f.simulation.buildings.f.output[0].count = 100;
    f = advance(f, 10);
    expect(f.simulation.buildings.f.output).toEqual([
      { item: "iron_plate", count: 100 },
    ]);
    expect(f.simulation.buildings.f.input[0].count).toBe(1);
    expect(f.simulation.buildings.f.progress).toBe(0);
  });
  it("vacates a full belt chain simultaneously without moving any payload twice", () => {
    let f = createLocalFactory(user, "传送带");
    f = add(f, "a", "conveyor", -2);
    f = add(f, "b", "conveyor", -1);
    f.simulation.buildings.a.belt = {
      id: "ore-a",
      item: "iron_ore",
      progress: 0,
    };
    f.simulation.buildings.b.belt = {
      id: "ore-b",
      item: "iron_ore",
      progress: 0,
    };
    f = step(f);
    expect(f.simulation.buildings.a.belt).toBeUndefined();
    expect(f.simulation.buildings.b.belt?.id).toBe("ore-a");
    expect(f.simulation.warehouse.iron_ore).toBe(1);
    expect(total(f)).toBe(2);
  });
  it("keeps blocked items and emits no success receipt for a whitelist rejection", () => {
    let f = createLocalFactory(user, "白名单");
    f = add(f, "belt", "conveyor", 1);
    f = add(f, "port", "item_input", 2);
    f = add(f, "machine", "assembler", 3);
    f.simulation.buildings.belt.belt = {
      id: "ore",
      item: "iron_ore",
      progress: 1,
    };
    f = step(f);
    expect(f.simulation.buildings.belt.belt?.id).toBe("ore");
    expect(f.simulation.buildings.port.status).toBe("rejected");
    expect(f.simulation.transfers).toEqual([]);
    expect(total(f)).toBe(1);
  });
  it("rotates a completely full loop and resolves contention without duplicates", () => {
    let f = createLocalFactory(user, "环路");
    for (const [id, x, y, r] of [
      ["a", 2, 2, 0],
      ["b", 3, 2, 270],
      ["c", 3, 3, 180],
      ["d", 2, 3, 90],
    ] as const)
      f = add(f, id, "conveyor", x, y, r);
    for (const id of ["a", "b", "c", "d"])
      f.simulation.buildings[id].belt = { id, item: "iron_ore", progress: 1 };
    f = step(f);
    expect(
      ["a", "b", "c", "d"].map((id) => f.simulation.buildings[id].belt?.id),
    ).toEqual(["d", "a", "b", "c"]);
    expect(total(f)).toBe(4);
    let competing = createLocalFactory(user, "竞争");
    competing = add(competing, "source", "furnace", 2, 2);
    competing = add(competing, "left", "item_output", 1, 2, 180);
    competing = add(competing, "right", "item_output", 3, 2);
    competing = add(competing, "left-belt", "conveyor", 0, 2, 180);
    competing = add(competing, "right-belt", "conveyor", 4, 2);
    competing.simulation.buildings.source.output = [
      { item: "iron_plate", count: 1 },
    ];
    competing = step(competing);
    expect(total(competing)).toBe(1);
    expect(competing.simulation.transfers).toHaveLength(1);
  });
  it("keeps identity and progress on moves and atomically reclaims only existing inventory", () => {
    const f = add(createLocalFactory(user, "编辑"), "f", "furnace", 1);
    f.simulation.buildings.f = {
      ...newMachine(),
      input: [{ item: "iron_ore", count: 2 }],
      output: [{ item: "iron_plate", count: 3 }],
      progress: 3,
    };
    const moved = editFactory(f, {
      kind: "move",
      id: "f",
      placement: { x: 2, y: 2, rotation: 90 },
    });
    expect(moved.simulation.buildings.f).toEqual(f.simulation.buildings.f);
    const removed = editFactory(moved, { kind: "delete", id: "f" });
    expect(removed.simulation.warehouse).toEqual({
      iron_ore: 2,
      iron_plate: 3,
    });
    expect(total(removed)).toBe(total(f));
    const bus = f.buildings.find((b) => b.building_type === "bus")!;
    expect(() => editFactory(f, { kind: "delete", id: bus.id })).toThrow(
      "工厂仓库固定",
    );
    expect(() =>
      editFactory(f, {
        kind: "move",
        id: "f",
        placement: { x: 0, y: 0, rotation: 0 },
      }),
    ).toThrow("占用");
    f.simulation.warehouse.iron_ore = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(f);
    expect(() => editFactory(f, { kind: "delete", id: "f" })).toThrow("上限");
    expect(f).toEqual(before);
  });
  it("restores complete gameplay while dropping old visual receipts and rejects corrupt state", () => {
    let f = add(createLocalFactory(user, "存档"), "miner", "miner", 1);
    f = advance(f, 4);
    const save = toSave(f);
    expect(validateSave(JSON.parse(JSON.stringify(save)), user.id)).toEqual(f);
    expect(() => validateSave(save, "another-owner")).toThrow("存档");
    const corrupt = structuredClone(save);
    corrupt.factory.simulation!.warehouse.iron_ore =
      Number.MAX_SAFE_INTEGER + 1;
    expect(() => validateSave(corrupt, user.id)).toThrow("存档");
  });
});
