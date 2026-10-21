import { describe, it, expect } from "vitest";
import { createWorld, actWorld, stepWorld, projectFactory } from "./world";
import { editFactory, toSave, validateSave, newMachine } from "./state";
import { recordCraft } from "./industry";
import { itemID } from "./catalog";
const user = {
  id: "discovery",
  username: "discovery",
  display_name: "图鉴",
  created_at: "now",
  last_login_at: "now",
};
describe("persistent obtained-item history", () => {
  it("remembers spent pickups across factory switches and complete save reloads without granting crafting credit", () => {
    let f = createWorld(user, "图鉴");
    const trash = itemID("垃圾包");
    f = editFactory(f, { kind: "industry", action: { type: "scavenge" } });
    f.simulation.warehouse[trash] = 0;
    f = actWorld(f, { type: "select_district", id: f.districts![0].id });
    expect(projectFactory(f).simulation.industry?.discovered_items).toContain(
      trash,
    );
    const restored = validateSave(toSave(f), user.id);
    expect(restored.simulation.industry?.discovered_items).toContain(trash);
    expect(restored.simulation.industry?.crafted[trash]).toBeUndefined();
  });
  it("discovers actual production and automatic garbage output only once without changing the previous snapshot", () => {
    let f = createWorld(user, "产物");
    recordCraft(f, { [itemID("基础铁板")]: 1 });
    f.buildings.push({
      id: "source",
      factory_id: f.id,
      building_type: "waste_port",
      x: 0,
      y: 10,
      rotation: 0,
      configuration: {},
    });
    f.simulation.buildings.source = newMachine();
    f.simulation.buildings.source.progress = 9;
    const old = structuredClone(f);
    f = stepWorld(f);
    expect(old.simulation.industry!.discovered_items).not.toContain(
      itemID("垃圾包"),
    );
    expect(f.simulation.industry!.discovered_items).toEqual([
      itemID("基础铁板"),
      itemID("垃圾包"),
    ]);
    expect(f.simulation.industry!.crafted[itemID("垃圾包")]).toBeUndefined();
  });
  it("backfills old saves from crafted history and all districts, preserving consumed warehouse keys", () => {
    const f = createWorld(user, "旧档");
    delete f.simulation.industry!.discovered_items;
    f.simulation.industry!.crafted[itemID("基础铁板")] = 1;
    f.simulation.warehouse[itemID("垃圾包")] = 0;
    f.districts![0].simulation.warehouse[itemID("粗铜丝")] = 2;
    const restored = validateSave(toSave(f), user.id);
    expect(restored.simulation.industry!.discovered_items).toEqual(
      expect.arrayContaining([
        itemID("基础铁板"),
        itemID("垃圾包"),
        itemID("粗铜丝"),
      ]),
    );
    expect(f.simulation.industry!.discovered_items).toBeUndefined();
    for (const bad of [
      null,
      ["unknown"],
      [itemID("垃圾包"), itemID("垃圾包")],
    ]) {
      const invalid = toSave(structuredClone(restored));
      Object.assign(invalid.factory.simulation!.industry!, {
        discovered_items: bad,
      });
      expect(() => validateSave(invalid, user.id)).toThrow();
    }
  });
});
