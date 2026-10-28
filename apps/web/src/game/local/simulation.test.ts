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
import { buildingDefinitions } from "./catalog";

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
  const item = buildingDefinitions.get(type)!.item!;
  f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + 1;
  const next = editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation },
  });
  if (type === "m07")
    next.buildings.find((b) => b.id === id)!.configuration.recipe_id = "r1025";
  if (type === "m01")
    next.buildings.find((b) => b.id === id)!.configuration.recipe_id = "r1005";
  return next;
}
function advance(f: LocalFactory, n: number) {
  for (let i = 0; i < n * 2; i++) f = step(f);
  return f;
}
function total(f: LocalFactory) {
  return (
    Object.values(f.simulation.warehouse).reduce((n, c) => n + c, 0) +
    f.buildings.filter((b) => buildingDefinitions.get(b.building_type)?.item)
      .length +
    Object.values(f.simulation.buildings).reduce(
      (n, m) =>
        n +
        [...m.input, ...m.output].reduce((a, s) => a + s.count, 0) +
        (m.belt?.count ?? (m.belt ? 1 : 0)),
      0,
    )
  );
}
describe("client authoritative simulation", () => {
  it("delivers paid current iron batches through a complete line and conserves every unit", () => {
    let f = createLocalFactory(user, "守恒产线");
    const types = ["chest", "feeder", "hand_belt", "feeder", "m07", "feeder"];
    for (let i = 0; i < types.length; i++)
      f = add(f, "line-" + i, types[i], -6 + i);
    f.simulation.buildings["line-0"].output = [{ item: "i0038", count: 20 }];
    const start = structuredClone(f);
    f = advance(f, 25);
    expect(f.simulation.tick).toBe(50);
    expect(f.simulation.warehouse.i0045).toBeGreaterThanOrEqual(2);
    expect(total(f)).toBe(total(start));
    expect(start.simulation.tick).toBe(0);
    expect(advance(start, 25)).toEqual(f);
  });
  it("uses one stack per item, blocks at capacity and consumes inputs only on completion", () => {
    let f = add(createLocalFactory(user, "配方"), "f", "m07", 1);
    f.simulation.buildings.f.input = [{ item: "i0038", count: 4 }];
    f = advance(f, 7);
    expect(f.simulation.buildings.f.input[0].count).toBe(4);
    expect(f.simulation.buildings.f.output).toEqual([]);
    f = advance(f, 1);
    expect(f.simulation.buildings.f.input[0].count).toBe(2);
    expect(f.simulation.buildings.f.output).toEqual([
      { item: "i0045", count: 2 },
    ]);
    f.simulation.buildings.f.output[0].count = 100;
    f = advance(f, 10);
    expect(f.simulation.buildings.f.output).toEqual([
      { item: "i0045", count: 100 },
    ]);
    expect(f.simulation.buildings.f.input[0].count).toBe(2);
    expect(f.simulation.buildings.f.progress).toBe(0);
  });
  it("vacates a full belt chain simultaneously without moving any payload twice", () => {
    let f = createLocalFactory(user, "传送带");
    f = add(f, "a", "hand_belt", -2);
    f = add(f, "b", "hand_belt", -1);
    f.simulation.buildings.a.belt = {
      id: "ore-a",
      item: "i0038",
      progress: 1,
      count: 2,
    };
    f.simulation.buildings.b.belt = {
      id: "ore-b",
      item: "i0038",
      progress: 1,
      count: 2,
    };
    const before = total(f);
    f = step(f);
    expect(f.simulation.buildings.a.belt).toBeUndefined();
    expect(f.simulation.buildings.b.belt?.id).toBe("ore-a");
    expect(f.simulation.warehouse.i0038).toBe(2);
    expect(total(f)).toBe(before);
  });
  it("keeps blocked items and emits no success receipt for a whitelist rejection", () => {
    let f = createLocalFactory(user, "白名单");
    f = add(f, "belt", "hand_belt", 1);
    f = add(f, "port", "feeder", 2);
    f = add(f, "machine", "m01", 3);
    f.simulation.buildings.belt.belt = {
      id: "ore",
      item: "i0038",
      progress: 1,
    };
    const before = total(f);
    f = step(f);
    expect(f.simulation.buildings.belt.belt?.id).toBe("ore");
    expect(f.simulation.buildings.port.status).toBe("rejected");
    expect(f.simulation.transfers).toEqual([]);
    expect(total(f)).toBe(before);
  });
  it("rotates a completely full loop and resolves contention without duplicates", () => {
    let f = createLocalFactory(user, "环路");
    for (const [id, x, y, r] of [
      ["a", 2, 2, 0],
      ["b", 3, 2, 270],
      ["c", 3, 3, 180],
      ["d", 2, 3, 90],
    ] as const)
      f = add(f, id, "hand_belt", x, y, r);
    for (const id of ["a", "b", "c", "d"])
      f.simulation.buildings[id].belt = {
        id,
        item: "i0038",
        progress: 1,
        count: 2,
      };
    const before = total(f);
    f = step(f);
    expect(
      ["a", "b", "c", "d"].map((id) => f.simulation.buildings[id].belt?.id),
    ).toEqual(["d", "a", "b", "c"]);
    expect(total(f)).toBe(before);
    let competing = createLocalFactory(user, "竞争");
    competing = add(competing, "source", "m07", 2, 2);
    competing = add(competing, "left", "feeder", 1, 2, 180);
    competing = add(competing, "right", "feeder", 3, 2);
    competing = add(competing, "left-belt", "hand_belt", 0, 2, 180);
    competing = add(competing, "right-belt", "hand_belt", 4, 2);
    competing.simulation.buildings.source.output = [
      { item: "i0045", count: 1 },
    ];
    const stock = total(competing);
    competing = step(competing);
    expect(total(competing)).toBe(stock);
    expect(competing.simulation.transfers).toHaveLength(1);
  });
  it("keeps identity and progress on moves and atomically reclaims only existing inventory", () => {
    const f = add(createLocalFactory(user, "编辑"), "f", "m07", 1);
    f.simulation.buildings.f = {
      ...newMachine(),
      input: [{ item: "i0038", count: 2 }],
      output: [{ item: "i0045", count: 3 }],
      progress: 3,
    };
    const moved = editFactory(f, {
      kind: "move",
      id: "f",
      placement: { x: 2, y: 2, rotation: 90 },
    });
    expect(moved.simulation.buildings.f).toEqual(f.simulation.buildings.f);
    const removed = editFactory(moved, { kind: "delete", id: "f" });
    expect(removed.simulation.warehouse).toMatchObject({
      i0038: 2,
      i0045: 3,
    });
    expect(total(removed)).toBe(total(f));
    const bus = f.buildings.find((b) => b.building_type === "bus")!;
    expect(() => editFactory(f, { kind: "delete", id: bus.id })).toThrow(
      "不能删除",
    );
    expect(() =>
      editFactory(f, {
        kind: "move",
        id: "f",
        placement: { x: 0, y: 0, rotation: 0 },
      }),
    ).toThrow("占用");
    f.simulation.warehouse.i0038 = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(f);
    expect(() => editFactory(f, { kind: "delete", id: "f" })).toThrow("上限");
    expect(f).toEqual(before);
  });
  it("restores complete gameplay while dropping old visual receipts and rejects corrupt state", () => {
    let f = add(createLocalFactory(user, "存档"), "m07", "m07", 1);
    f = advance(f, 4);
    const save = toSave(f);
    expect(validateSave(JSON.parse(JSON.stringify(save)), user.id)).toEqual(f);
    expect(() => validateSave(save, "another-owner")).toThrow("存档");
    const corrupt = structuredClone(save);
    corrupt.factory.simulation!.warehouse.i0038 = Number.MAX_SAFE_INTEGER + 1;
    expect(() => validateSave(corrupt, user.id)).toThrow("存档");
  });
});
