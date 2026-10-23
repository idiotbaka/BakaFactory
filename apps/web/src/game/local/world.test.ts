import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import { workshopDuration } from "./workshop";
import { createLocalFactory, toSave, validateSave } from "./state";
import {
  actWorld,
  allDistricts,
  createWorld,
  districtSummary,
  editWorld,
  expansionCost,
  initializeWorld,
  projectFactory,
  stepWorld,
} from "./world";

const user = {
  id: "district-owner",
  username: "district-owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
describe("one worker world with independent districts", () => {
  it("starts six independent districts and upgrades the legacy factory without losing its identity or stock", () => {
    const old = createLocalFactory(user, "原厂");
    old.simulation.warehouse[itemID("垃圾包")] = 13;
    old.simulation.tick = 27;
    const root = initializeWorld(old);
    expect(allDistricts(root)).toHaveLength(6);
    expect(root.id).toBe(old.id);
    expect(root.simulation.warehouse[itemID("垃圾包")]).toBe(13);
    expect(
      root.districts!.every(
        (f) =>
          f.simulation.tick === 27 &&
          Object.keys(f.simulation.warehouse).length === 0,
      ),
    ).toBe(true);
    expect(initializeWorld(root)).toBe(root);
    expect(new Set(allDistricts(root).map((f) => f.id)).size).toBe(6);
    expect(districtSummary(root).filter((f) => f.headquarters)).toHaveLength(1);
  });
  it("advances a paid batch queue once per world tick while another district is selected", () => {
    let root = createWorld(user, "批量世界");
    const garbage = itemID("垃圾包"),
      iron = itemID("铁质碎片");
    root.simulation.warehouse[garbage] = 24;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "workshop", recipe: "r1001", batches: 2 },
    });
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    const duration = workshopDuration(recipeDefinitions.get("r1001")!);
    for (let i = 0; i < duration; i++) root = stepWorld(root);
    expect(root.simulation.industry!.workshop).toMatchObject({
      total: 2,
      remaining: 1,
      progress: 0,
    });
    expect(root.simulation.warehouse[iron]).toBe(3);
    expect(root.districts!.every((d) => d.simulation.tick === duration)).toBe(
      true,
    );
    for (let i = 0; i < duration; i++) root = stepWorld(root);
    expect(root.simulation.industry!.workshop).toBeUndefined();
    expect(root.simulation.warehouse[iron]).toBe(6);
  });
  it("advances all districts once, a single manual queue once, and aggregates genuine craft milestones", () => {
    let root = createWorld(user, "回收场");
    const garbage = itemID("垃圾包"),
      iron = itemID("铁质碎片"),
      machineItem = buildingDefinitions.get("m02")!.item!;
    root.simulation.warehouse[garbage] = 12;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "workshop", recipe: "r1001" },
    });
    const child = root.districts![0];
    root.simulation.warehouse[garbage] = 12;
    root.simulation.warehouse[machineItem] = 1;
    root = actWorld(root, { type: "select_district", id: child.id });
    root = editWorld(root, {
      kind: "place",
      id: "sorter",
      building_type: "m02",
      placement: { x: 1, y: 1, rotation: 0 },
    });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "recipe", id: "sorter", recipe: "r1001" },
    });
    root = editWorld(root, {
      kind: "industry",
      action: { type: "feed_batch", id: "sorter" },
    });
    root = stepWorld(root);
    expect(root.simulation.industry!.workshop?.progress).toBe(1);
    expect(allDistricts(root).map((f) => f.simulation.tick)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    for (let i = 0; i < 9; i++) root = stepWorld(root);
    expect(root.simulation.warehouse[iron]).toBe(3);
    expect(
      root.districts![0].simulation.buildings.sorter.output.find(
        (s) => s.item === iron,
      )?.count,
    ).toBe(3);
    expect(root.simulation.industry!.crafted[iron]).toBe(6);
    expect(root.districts![0].simulation.warehouse[iron] ?? 0).toBe(0);
    expect(root.districts![0].simulation.industry).toBeUndefined();
    expect(projectFactory(root).simulation.industry).toEqual(
      root.simulation.industry,
    );
    expect(projectFactory(root).districts).toBeUndefined();
  });
  it("rejects stale editor requests and duplicated garbage sources while allowing shared scavenging", () => {
    let root = createWorld(user, "回收场");
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    expect(() =>
      editWorld(
        root,
        {
          kind: "place",
          id: "stale",
          building_type: "miner",
          placement: { x: 1, y: 1, rotation: 0 },
        },
        root.id,
      ),
    ).toThrow(/切换/);
    expect(() =>
      editWorld(root, {
        kind: "place",
        id: "source",
        building_type: "waste_port",
        placement: { x: 1, y: 10, rotation: 0 },
      }),
    ).toThrow(/起始/);
    const before = root.simulation.warehouse[catalog.root_item!] ?? 0;
    root = editWorld(root, { kind: "industry", action: { type: "scavenge" } });
    expect(root.simulation.warehouse[catalog.root_item!]).toBe(before + 1);
    expect(root.districts![0].simulation.warehouse).toEqual({});
    expect(root.districts![0].buildings).toHaveLength(1);
  });
  it("expands with actual headquarters materials, obeys stage limits and preserves the original on failure", () => {
    let root = createWorld(user, "回收场");
    expect(() =>
      actWorld(root, { type: "expand_district", name: "新区" }),
    ).toThrow(/上限/);
    root.simulation.industry!.stage = 6;
    root.simulation.industry!.quests!.completed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    root.simulation.industry!.quests!.claimed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    root.simulation.industry!.milestones = catalog
      .stages!.slice(0, 5)
      .map((s) => s.milestone_item);
    expect(() =>
      actWorld(root, { type: "expand_district", name: "新区" }),
    ).toThrow();
    expect(root.districts).toHaveLength(5);
    for (const [item, n] of Object.entries(expansionCost()))
      root.simulation.warehouse[item] = -n * 94;
    for (let i = 6; i < 100; i++)
      root = actWorld(root, { type: "expand_district", name: `新区 ${i}` });
    expect(allDistricts(root)).toHaveLength(100);
    for (const item of Object.keys(expansionCost()))
      expect(root.simulation.warehouse[item]).toBe(0);
    expect(() =>
      actWorld(root, { type: "expand_district", name: "超额" }),
    ).toThrow(/上限/);
    expect(validateSave(toSave(root), user.id).districts).toHaveLength(99);
  });
  it("saves one global warehouse, active district and geometry; rejects nested, foreign and inconsistent worlds", () => {
    let root = createWorld(user, "回收场");
    const child = root.districts![0];
    root.simulation.warehouse[itemID("净化水")] = 500;
    root = actWorld(root, { type: "select_district", id: child.id });
    root = stepWorld(root);
    const loaded = validateSave(toSave(root), user.id);
    expect(loaded.active_district_id).toBe(child.id);
    expect(projectFactory(loaded).simulation.warehouse[itemID("净化水")]).toBe(
      500,
    );
    expect(loaded.simulation.warehouse[itemID("净化水")]).toBe(500);
    for (const mutate of [
      (r: typeof root) => {
        r.districts![0].owner_id = "other";
      },
      (r: typeof root) => {
        r.districts![0].districts = [];
      },
      (r: typeof root) => {
        r.districts![0].simulation.tick++;
      },
      (r: typeof root) => {
        r.districts![0].id = r.id;
      },
      (r: typeof root) => {
        r.active_district_id = "missing";
      },
      (r: typeof root) => {
        r.districts![0].simulation.industry = r.simulation.industry;
      },
    ]) {
      const bad = structuredClone(root);
      mutate(bad);
      expect(() => validateSave(toSave(bad), user.id)).toThrow();
    }
  });
});
