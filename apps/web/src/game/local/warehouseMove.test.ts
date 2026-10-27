import { describe, expect, it } from "vitest";
import { buildingDefinitions, itemID } from "./catalog";
import { createWorld, editWorld, actWorld, stepWorld } from "./world";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";

const user = { id: "warehouse-move", username: "warehouse", display_name: "仓库", created_at: "now", last_login_at: "now" };
const iron = itemID("基础铁板");
function move(f: LocalFactory, x: number, y: number) {
  const district = [f, ...(f.districts ?? [])].find((d) => d.id === (f.active_district_id ?? f.id))!;
  return editWorld(f, { kind: "move", id: district.buildings.find((b) => b.building_type === "bus")!.id,
    placement: { x, y, rotation: 0 } });
}
function node(f: LocalFactory, id: string, type: string, x: number, y: number, rotation: 0 | 90 = 0) {
  f.buildings.push({ id, factory_id: f.id, building_type: type, x, y, rotation, configuration: {} });
  f.simulation.buildings[id] = newMachine();
}

describe("movable protected warehouse", () => {
  it("retains root / child identities, face configuration, machine state and the unique stock ledger through moves and reload", () => {
    let f = createWorld(user, "仓库搬迁");
    const bus = f.buildings[0];
    bus.configuration.face_0 = { mode: "output", filter: iron };
    f.simulation.buildings[bus.id].cooldown = 0.5;
    f.simulation.warehouse[iron] = 50;
    const original = structuredClone(f);
    f = move(f, -5, 4);
    expect(f.buildings[0]).toEqual({ ...bus, x: -5, y: 4 });
    expect(f.simulation.buildings[bus.id]).toEqual(original.simulation.buildings[bus.id]);
    expect(original.buildings[0]).toEqual(bus);
    const childID = f.districts![0].id;
    const childBusID = f.districts![0].buildings[0].id;
    f = actWorld(f, { type: "select_district", id: childID });
    f = move(f, 8, -8);
    expect(f.districts![0].buildings[0]).toMatchObject({ id: childBusID, x: 8, y: -8, rotation: 0 });
    expect(f.simulation.warehouse[iron]).toBe(50);
    expect(f.districts!.every((d) => Object.keys(d.simulation.warehouse).length === 0)).toBe(true);
    expect(validateSave(toSave(f), user.id)).toEqual(f);
    f = actWorld(f, { type: "select_district", id: f.id });
    f.simulation.warehouse[buildingDefinitions.get("hand_belt")!.item!] = 1;
    f = editWorld(f, { kind: "place", id: "old-origin", building_type: "hand_belt", placement: { x: 0, y: 0, rotation: 0 } });
    expect(f.buildings.find((b) => b.id === "old-origin")).toMatchObject({ x: 0, y: 0 });
    expect(f.buildings.filter((b) => b.building_type === "bus")).toHaveLength(1);
  });

  it("rejects rotation, deletion, duplicates, occupied and out-of-map targets without modifying the current world", () => {
    const f = createWorld(user, "保护仓库"), id = f.buildings[0].id;
    node(f, "occupied", "chest", 3, 3);
    const original = structuredClone(f);
    for (const action of [
      { kind: "delete", id },
      { kind: "move", id, placement: { x: 2, y: 2, rotation: 90 } },
      { kind: "move", id, placement: { x: 11, y: 2, rotation: 0 } },
      { kind: "move", id, placement: { x: 3, y: 3, rotation: 0 } },
      { kind: "place", id: "duplicate-wh", building_type: "bus", placement: { x: 2, y: 2, rotation: 0 } },
    ] as const) {
      expect(() => editWorld(f, action)).toThrow();
      expect(f).toEqual(original);
    }
    const edge = move(f, 10, -10);
    expect(validateSave(toSave(edge), user.id).buildings[0]).toMatchObject({ x: 10, y: -10, rotation: 0 });
  });

  it("uses the relocated faces for solid / fluid transfer while leaving the world ledger intact", () => {
    let f = move(createWorld(user, "实际接货"), 5, 5);
    const water = itemID("净化水"), bus = f.buildings[0];
    bus.configuration.face_0 = { mode: "output", filter: iron };
    bus.configuration.face_90 = { mode: "output", filter: water };
    f.simulation.warehouse[iron] = 10;
    f.simulation.warehouse[water] = 3;
    node(f, "source", "hand_belt", 4, 5);
    node(f, "target", "chest", 6, 5);
    node(f, "pipe", "pipe", 5, 4, 90);
    f.simulation.buildings.source.belt = { id: "real-load", item: iron, count: 2, progress: 2 };
    f = stepWorld(f);
    expect(f.simulation.warehouse[iron]).toBe(11);
    expect(f.simulation.buildings.target.output).toEqual([{ item: iron, count: 1 }]);
    expect(f.simulation.buildings.source.belt).toBeUndefined();
    f = stepWorld(f);
    expect(f.simulation.warehouse[water]).toBe(2);
    expect(f.simulation.buildings.pipe.fluid).toEqual({ item: water, count: 1 });
  });
});
