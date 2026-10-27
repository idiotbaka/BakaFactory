import { describe, expect, it } from "vitest";
import {
  buildingDefinitions,
  catalog,
  itemID,
  recipeDefinitions,
} from "./catalog";
import {
  createLocalFactory,
  editFactory,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { simulationSecond as step } from "./testTime";
import { fuelAvailable } from "./fuel";
import type { IndustryAction } from "./industry";
import type { Rotation } from "./transportConfig";

const user = {
  id: "plumber",
  username: "plumber",
  display_name: "管网工程师",
  created_at: "now",
  last_login_at: "now",
};
function start() {
  const f = createLocalFactory(user, "流体厂");
  f.simulation.industry!.stage = 6;
  f.simulation.industry!.quests!.completed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  f.simulation.industry!.quests!.claimed.push(
    ...catalog
      .quests!.filter(
        (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
      )
      .map((q) => q.id),
  );
  f.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  return f;
}
function place(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y = 1,
  rotation: Rotation = 0,
) {
  const item = buildingDefinitions.get(type)!.item;
  if (item)
    f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + 1;
  return editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation },
  });
}
const act = (f: LocalFactory, action: IndustryAction) =>
  editFactory(f, { kind: "industry", action });
function advance(f: LocalFactory, n: number) {
  for (let i = 0; i < n; i++) f = step(f);
  return f;
}
function fill(f: LocalFactory, id: string, item: string, count: number) {
  f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + count;
  return act(f, { type: "fill_fluid", id, item, count });
}
function total(f: LocalFactory, item: string) {
  return (
    (f.simulation.warehouse[item] ?? 0) +
    Object.values(f.simulation.buildings).reduce(
      (sum, m) =>
        sum +
        [...m.input, ...m.output, ...(m.fuel ?? [])].reduce(
          (n, s) => n + (s.item === item ? s.count : 0),
          0,
        ) +
        (m.fluid?.item === item ? m.fluid.count : 0) +
        (item === itemID("液压工作液") ? (m.medium ?? 0) : 0),
      0,
    )
  );
}
const water = itemID("净化水"),
  oil = itemID("液体燃料"),
  steam = itemID("高压蒸汽");

describe("bounded fluid routing and conserved volume", () => {
  it("records real pipe deliveries into WH without treating manual drainage as automation", () => {
    let f = fill(place(start(), "p", "pipe", -1, 0), "p", water, 3);
    const bus = f.buildings[0].id;
    f = act(f, {
      type: "bus_face",
      id: bus,
      rotation: 180,
      mode: "closed",
      filter: water,
    });
    f = advance(f, 3);
    expect(f.simulation.industry!.quests!.automated_received).toBe(0);
    f = act(f, {
      type: "bus_face",
      id: bus,
      rotation: 180,
      mode: "input",
      filter: water,
    });
    f = step(f);
    const remaining = f.simulation.buildings.p.fluid!.count;
    const received = 3 - remaining;
    expect(received).toBeGreaterThan(0);
    expect(f.simulation.industry!.quests!.automated_received).toBe(received);
    f = act(f, { type: "drain_fluid", id: "p" });
    expect(f.simulation.warehouse[water]).toBe(3);
    expect(f.simulation.industry!.quests!.automated_received).toBe(received);
  });
  it("moves one cell per tick and preserves all volume over a long blocked run", () => {
    let f = place(
      place(place(start(), "a", "tank", 1), "b", "pipe", 2),
      "c",
      "tank",
      3,
    );
    f = fill(f, "a", water, 450);
    f = step(f);
    expect(f.simulation.buildings.b.fluid?.count).toBe(2);
    expect(f.simulation.buildings.c.fluid).toBeUndefined();
    f = step(f);
    expect(f.simulation.buildings.c.fluid?.count).toBe(2);
    f = advance(f, 300);
    expect(total(f, water)).toBe(450);
    expect(f.simulation.buildings.c.fluid?.count).toBe(450);
    expect(f.simulation.buildings.a.fluid).toBeUndefined();
  });
  it("reserves the last free unit, blocks without loss, and resumes after drainage", () => {
    let f = place(place(start(), "a", "tank", 1), "b", "tank", 2);
    f = fill(fill(f, "a", water, 500), "b", water, 499);
    f = step(f);
    expect(f.simulation.buildings.b.fluid?.count).toBe(500);
    expect(f.simulation.buildings.a.fluid?.count).toBe(499);
    f = advance(f, 15);
    expect(total(f, water)).toBe(999);
    f = act(f, { type: "drain_fluid", id: "b" });
    expect(f.simulation.warehouse[water]).toBe(500);
    f = step(f);
    expect(f.simulation.buildings.b.fluid?.count).toBe(4);
    expect(total(f, water)).toBe(999);
  });
  it("rejects mixing, solids and incompatible steam vessels without changing the original state", () => {
    let f = place(
      place(place(start(), "a", "tank", 1), "b", "tank", 2),
      "steam",
      "steam_tank",
      4,
    );
    f = fill(fill(f, "a", water, 8), "b", oil, 8);
    f = step(f);
    expect(f.simulation.buildings.a.status).toBe("mixed");
    expect(total(f, water)).toBe(8);
    expect(total(f, oil)).toBe(8);
    f.simulation.warehouse[water] = 1;
    const before = structuredClone(f);
    expect(() =>
      act(f, { type: "fill_fluid", id: "b", item: water, count: 1 }),
    ).toThrow(/混液/);
    expect(() =>
      act(f, { type: "fill_fluid", id: "steam", item: water, count: 1 }),
    ).toThrow();
    expect(() =>
      act(f, { type: "fill_fluid", id: "a", item: itemID("垃圾包"), count: 1 }),
    ).toThrow();
    expect(f).toEqual(before);
  });
  it("uses weighted unit scheduling, closes zero-weight branches and waits for the selected full branch", () => {
    let f = place(
      place(
        place(place(start(), "v", "valve", 3, 2), "front", "tank", 4, 2),
        "right",
        "tank",
        3,
        1,
        90,
      ),
      "left",
      "tank",
      3,
      3,
      270,
    );
    f = act(f, { type: "fluid_config", id: "v", split_weights: [1, 3, 0] });
    f = fill(f, "v", water, 8);
    f = advance(f, 2);
    expect(f.simulation.buildings.front.fluid?.count).toBe(2);
    expect(f.simulation.buildings.right.fluid?.count).toBe(6);
    expect(f.simulation.buildings.left.fluid).toBeUndefined();
    expect(total(f, water)).toBe(8);
    f = fill(f, "front", water, 498);
    f = fill(f, "v", water, 4);
    f = advance(f, 3);
    expect(f.simulation.buildings.v.fluid?.count).toBe(4);
    expect(f.simulation.buildings.v.fluid_cursor).toBe(0);
    expect(f.simulation.buildings.right.fluid?.count).toBe(6);
    f = act(f, { type: "drain_fluid", id: "front" });
    f = step(f);
    expect(f.simulation.buildings.front.fluid?.count).toBe(1);
    expect(f.simulation.buildings.right.fluid?.count).toBe(9);
  });
  it("supplies actual boiler steam through pipes to start fractional distillation", () => {
    let f = place(
      place(
        place(place(start(), "boiler", "m14", 1), "p1", "pipe", 2),
        "p2",
        "pipe",
        3,
      ),
      "tower",
      "m20",
      4,
    );
    f = act(f, { type: "recipe", id: "boiler", recipe: "r2026" });
    f = act(f, { type: "recipe", id: "tower", recipe: "r3007" });
    f.simulation.buildings.boiler.input = Object.entries(
      recipeDefinitions.get("r2026")!.inputs,
    ).map(([item, n]) => ({ item, count: n * 2 }));
    f.simulation.buildings.boiler.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    f.simulation.buildings.tower.input = Object.entries(
      recipeDefinitions.get("r3007")!.inputs,
    ).map(([item, count]) => ({ item, count }));
    f = advance(f, 40);
    expect(
      f.simulation.buildings.tower.output.find((s) => s.item === oil)?.count,
    ).toBe(2);
    expect(f.simulation.buildings.tower.energy_kj).toBe(80);
    expect(total(f, steam)).toBe(0);
    expect(
      fuelAvailable(
        f.simulation.buildings.boiler,
        buildingDefinitions.get("m14")!,
      ),
    ).toBe(2940);
  });
  it("primes only one real working-fluid unit and distinguishes recipe input from medium", () => {
    let f = place(place(start(), "p", "pipe", 2), "hyd", "m21", 3);
    const working = itemID("液压工作液");
    f = fill(f, "p", working, 8);
    f = advance(f, 4);
    expect(f.simulation.buildings.hyd.medium).toBe(1);
    expect(f.simulation.buildings.p.fluid?.count).toBe(7);
    f = act(f, { type: "recipe", id: "hyd", recipe: "r3013" });
    f = step(f);
    expect(
      f.simulation.buildings.hyd.input.find((s) => s.item === working)?.count,
    ).toBe(2);
    expect(total(f, working)).toBe(8);
  });
  it("requires actual pump power and freezes retained fluid when the hydraulic line is disabled", () => {
    let f = place(
      place(
        place(
          place(place(start(), "src", "m20", 2), "pump", "pump", 3),
          "dst",
          "tank",
          4,
        ),
        "line",
        "hydraulic_line",
        3,
        0,
      ),
      "hyd",
      "m21",
      2,
      0,
    );
    f.simulation.buildings.src.output = [{ item: water, count: 20 }];
    f = step(f);
    expect(f.simulation.buildings.pump.fluid).toBeUndefined();
    f.simulation.buildings.hyd.medium = 1;
    f.simulation.buildings.hyd.fuel = [{ item: oil, count: 1 }];
    f = advance(f, 2);
    expect(f.simulation.buildings.pump.fluid?.count).toBe(16);
    expect(f.simulation.buildings.dst.fluid?.count).toBe(4);
    expect(total(f, water)).toBe(20);
    expect(
      fuelAvailable(
        f.simulation.buildings.hyd,
        buildingDefinitions.get("m21")!,
      ),
    ).toBe(6070);
    f = act(f, { type: "power_config", id: "line", enabled: false });
    f = advance(f, 3);
    expect(f.simulation.buildings.pump.fluid?.count).toBe(16);
    expect(
      fuelAvailable(
        f.simulation.buildings.hyd,
        buildingDefinitions.get("m21")!,
      ),
    ).toBe(6070);
  });
  it("uses WH face filters and per-face rate without double-deducting warehouse stock", () => {
    let f = place(start(), "p", "pipe", 1, 0);
    const bus = f.buildings.find((b) => b.building_type === "bus")!;
    f = act(f, {
      type: "bus_face",
      id: bus.id,
      rotation: 0,
      mode: "output",
      filter: water,
    });
    f.simulation.warehouse[water] = 3;
    f = step(f);
    expect(f.simulation.buildings.p.fluid?.count).toBe(1);
    expect(f.simulation.warehouse[water]).toBe(2);
    f = advance(f, 10);
    expect(f.simulation.buildings.p.fluid?.count).toBe(3);
    expect(total(f, water)).toBe(3);
  });
  it("preserves full vessels during save, relocation and atomic demolition, rejects corrupt bounds", () => {
    let f = fill(place(start(), "tank", "tank", 2), "tank", water, 500);
    f = validateSave(toSave(f), user.id);
    f = editFactory(f, {
      kind: "move",
      id: "tank",
      placement: { x: 5, y: 1, rotation: 90 },
    });
    expect(f.simulation.buildings.tank.fluid?.count).toBe(500);
    for (const count of [0, 501, -1, 0.5]) {
      const bad = toSave(structuredClone(f));
      bad.factory.simulation!.buildings.tank.fluid!.count = count;
      expect(() => validateSave(bad, user.id)).toThrow();
    }
    const device = buildingDefinitions.get("tank")!.item!;
    f = editFactory(f, { kind: "delete", id: "tank" });
    expect(f.simulation.warehouse[water]).toBe(500);
    expect(f.simulation.warehouse[device]).toBe(1);
    expect(() => editFactory(f, { kind: "delete", id: "tank" })).toThrow();
    expect(f.simulation.warehouse[water]).toBe(500);
  });
});
