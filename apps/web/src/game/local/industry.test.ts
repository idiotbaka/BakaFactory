import { describe, expect, it } from "vitest";
import { catalog, itemID, recipeDefinitions } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import type { IndustryAction } from "./industry";
import { step } from "./simulation";

const user = {
  id: "recycler",
  username: "recycler",
  display_name: "回收员",
  created_at: "now",
  last_login_at: "now",
};
const start = () => createLocalFactory(user, "回收厂");
const act = (f: LocalFactory, action: IndustryAction) =>
  editFactory(f, { kind: "industry", action });
const advance = (f: LocalFactory, seconds: number) => {
  for (let i = 0; i < seconds; i++) f = step(f);
  return f;
};
const install = (f: LocalFactory, type: string) => {
  const d = catalog.buildings.find((b) => b.id === type)!;
  f.simulation.warehouse[d.item!] = 1;
  return editFactory(f, {
    kind: "place",
    id: type,
    building_type: type,
    placement: { x: 1, y: 0, rotation: 0 },
  });
};

describe("recycling gameplay", () => {
  it("bootstraps from zero, reserves one batch and preserves all nine sorting products across reload", () => {
    let f = start();
    for (let n = 0; n < 12; n++) f = act(f, { type: "scavenge" });
    f = act(f, { type: "workshop", recipe: "r1001" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(0);
    expect(() => act(f, { type: "workshop", recipe: "r1001" })).toThrow();
    f = advance(f, 7);
    const reloaded = validateSave(toSave(f), user.id);
    expect(advance(reloaded, 3)).toEqual(advance(f, 3));
    f = advance(f, 3);
    expect(f.simulation.industry?.workshop).toBeUndefined();
    for (const [id, n] of Object.entries(
      recipeDefinitions.get("r1001")!.outputs,
    ))
      expect(f.simulation.warehouse[id]).toBe(n);
    expect(
      Object.values(f.simulation.warehouse).reduce((a, n) => a + n, 0),
    ).toBe(12);
  });
  it("refunds a cancelled reserved batch once, and failed starts cannot mutate the original", () => {
    let f = start();
    expect(() => act(f, { type: "workshop", recipe: "r1001" })).toThrow();
    expect(f.simulation.warehouse).toEqual({});
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "workshop", recipe: "r1001" });
    f = advance(f, 4);
    f = act(f, { type: "cancel_workshop" });
    f = act(f, { type: "cancel_workshop" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(12);
    expect(f.simulation.industry?.crafted).toEqual({});
  });
  it("installs a crafted device, needs a selected recipe and settles a nine-output batch atomically", () => {
    let f = start();
    expect(() =>
      editFactory(f, {
        kind: "place",
        id: "m02",
        building_type: "m02",
        placement: { x: 1, y: 0, rotation: 0 },
      }),
    ).toThrow();
    f = install(f, "m02");
    f = step(f);
    expect(f.simulation.buildings.m02.status).toBe("no_recipe");
    f = act(f, { type: "recipe", id: "m02", recipe: "r1001" });
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "feed_batch", id: "m02" });
    f = advance(f, 9);
    expect(f.simulation.buildings.m02.output).toEqual([]);
    expect(f.simulation.buildings.m02.input[0].count).toBe(12);
    f = step(f);
    expect(f.simulation.buildings.m02.output).toHaveLength(9);
    expect(f.simulation.buildings.m02.input).toEqual([]);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
    f = editFactory(f, { kind: "delete", id: "m02" });
    expect(
      f.simulation.warehouse[
        catalog.buildings.find((b) => b.id === "m02")!.item!
      ],
    ).toBe(1);
    expect(f.simulation.warehouse[itemID("铁质碎片")]).toBe(3);
  });
  it("holds production for any blocked byproduct, and switching recipes never consumes unfinished inputs", () => {
    let f = act(install(start(), "m02"), {
      type: "recipe",
      id: "m02",
      recipe: "r1001",
    });
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    f = act(f, { type: "feed_batch", id: "m02" });
    f.simulation.buildings.m02.output = [
      { item: itemID("混合塑料"), count: 100 },
    ];
    f = advance(f, 20);
    expect(f.simulation.buildings.m02.status).toBe("output_full");
    expect(f.simulation.buildings.m02.progress).toBe(0);
    expect(f.simulation.buildings.m02.input[0].count).toBe(12);
    f = act(f, { type: "recipe", id: "m02", recipe: "r1002" });
    f = act(f, { type: "collect_input", id: "m02" });
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(12);
  });
  it("charges heat separately from chemical ingredients, retains burn energy and rejects batteries as fuel", () => {
    let f = act(install(start(), "m05"), {
      type: "recipe",
      id: "m05",
      recipe: "r1017",
    });
    const r = recipeDefinitions.get("r1017")!;
    Object.assign(f.simulation.warehouse, r.inputs);
    f = act(f, { type: "feed_batch", id: "m05" });
    f = advance(f, 4);
    expect(f.simulation.buildings.m05.status).toBe("no_energy");
    f.simulation.warehouse[itemID("干燥生物质")] = 1;
    f = act(f, {
      type: "fuel",
      id: "m05",
      item: itemID("干燥生物质"),
      count: 1,
    });
    f = advance(f, r.duration_ms / 1000);
    expect(f.simulation.buildings.m05.input).toEqual([]);
    expect(f.simulation.buildings.m05.energy_kj).toBe(
      280 - (r.power_kw! * r.duration_ms) / 1000,
    );
    expect(f.simulation.buildings.m05.fuel).toEqual([]);
    expect(() =>
      act(f, { type: "fuel", id: "m05", item: itemID("废电池"), count: 1 }),
    ).toThrow();
    expect(
      validateSave(toSave(f), user.id).simulation.buildings.m05.energy_kj,
    ).toBe(f.simulation.buildings.m05.energy_kj);
  });
  it("unlocks the next stage on first actual completion, without consuming the milestone as an installation fee", () => {
    let f = act(install(start(), "m08"), {
      type: "recipe",
      id: "m08",
      recipe: "r1040",
    });
    const r = recipeDefinitions.get("r1040")!;
    Object.assign(f.simulation.warehouse, r.inputs);
    f = act(f, { type: "feed_batch", id: "m08" });
    f = advance(f, r.duration_ms / 1000);
    expect(f.simulation.industry?.stage).toBe(2);
    f = act(f, { type: "collect", id: "m08" });
    expect(f.simulation.warehouse[itemID("机械启动套件")]).toBe(1);
    expect(f.simulation.industry?.milestones).toEqual([itemID("机械启动套件")]);
  });
  it("upgrades old rules without deleting legacy machines, inventories or tick", () => {
    let f = editFactory(start(), {
      kind: "place",
      id: "legacy",
      building_type: "miner",
      placement: { x: 1, y: 0, rotation: 0 },
    });
    f = advance(f, 3);
    const old = {
      format_version: 1,
      rules_version: 1,
      factory: structuredClone(f),
    };
    delete old.factory.simulation.industry;
    const upgraded = validateSave(old, user.id);
    expect(upgraded.simulation.tick).toBe(3);
    expect(upgraded.simulation.buildings.legacy.output[0].count).toBe(3);
    expect(upgraded.simulation.industry?.stage).toBe(1);
    expect(toSave(upgraded).rules_version).toBe(2);
  });
});
