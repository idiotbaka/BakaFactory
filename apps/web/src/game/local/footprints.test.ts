import { describe, expect, it } from "vitest";
import type { BuildingPlacement } from "../../api/client";
import {
  buildingDefinitions,
  catalog,
  direction,
  itemID,
  recipeDefinitions,
} from "./catalog";
import {
  createLocalFactory,
  editFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { allocatePower } from "./power";
import { transferSolids } from "./logistics";
import { transferFluids } from "./fluids";
import { editWorld, actWorld, stepWorld } from "./world";
import { emptyCell, journey, plannedLayout } from "./robotRoutes";
import { stepFreight } from "./robotFreight";
import {
  containsCell,
  edgeCells,
  footprintCells,
  isAdjacent,
  occupancy,
  perimeterCells,
} from "../footprint";
import { placementIssue } from "../editorGeometry";
import { LogisticsVisualStore } from "../logisticsVisuals";

const user = {
  id: "footprint-owner",
  username: "footprint-owner",
  display_name: "占地",
  created_at: "now",
  last_login_at: "now",
};
function start() {
  const f = createLocalFactory(user, "占地回归");
  const p = f.simulation.industry!;
  p.stage = 6;
  const finals = catalog
    .quests!.filter((q) => q.stage_final && q.tier < 6)
    .map((q) => q.id);
  p.quests!.completed.push(...finals);
  p.quests!.claimed.push(...finals);
  p.milestones = catalog.stages!.slice(0, 5).map((s) => s.milestone_item);
  return f;
}
function place(
  f: LocalFactory,
  id: string,
  type: string,
  p: BuildingPlacement,
) {
  const item = buildingDefinitions.get(type)!.item;
  if (item)
    f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + 1;
  return editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: p,
  });
}
const square = { x: 4, y: 4, size: 2 as const };
const edges = [0, 90, 180, 270].flatMap((rotation) =>
  edgeCells(square, rotation).map((p) => ({
    ...p,
    rotation: rotation as BuildingPlacement["rotation"],
  })),
);
const opposite = (rotation: number) =>
  ((rotation + 180) % 360) as BuildingPlacement["rotation"];
const configure = (f: LocalFactory, recipe: string) => {
  f.buildings.find((b) => b.id === "machine")!.configuration.recipe_id = recipe;
};

describe("multi-cell footprints", () => {
  it("exposes exactly the 36 reviewed machines and keeps the square anchor independent of facing", () => {
    expect(
      catalog.buildings.filter((b) => b.supported_sizes?.includes(2)),
    ).toHaveLength(36);
    expect(footprintCells(square)).toEqual([
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
    ]);
    expect(
      new Set(perimeterCells(square).map((p) => `${p.x},${p.y}`)).size,
    ).toBe(8);
    expect(isAdjacent(square, { x: 6, y: 3 })).toBe(true);
    expect(isAdjacent(square, { x: 6, y: 2 })).toBe(false);
    expect(occupancy([square]).size).toBe(4);
  });
  it("pays and refunds one device, preserves legacy saves and machine state on movement", () => {
    let f = place(start(), "machine", "m08", { ...square, rotation: 0 });
    const item = buildingDefinitions.get("m08")!.item!;
    expect(f.simulation.warehouse[item]).toBe(0);
    configure(f, "r1036");
    f.simulation.buildings.machine.progress = 1;
    const state = structuredClone(f.simulation.buildings.machine);
    f = editFactory(f, {
      kind: "move",
      id: "machine",
      placement: { x: 7, y: 6, rotation: 90 },
    });
    expect(f.buildings.find((b) => b.id === "machine")).toMatchObject({
      x: 7,
      y: 6,
      rotation: 90,
      size: 2,
      configuration: { recipe_id: "r1036" },
    });
    expect(f.simulation.buildings.machine).toEqual(state);
    expect(
      validateSave(toSave(f), user.id).buildings.find(
        (b) => b.id === "machine",
      )!.size,
    ).toBe(2);
    const legacy = place(start(), "machine", "m08", {
      x: 4,
      y: 4,
      rotation: 0,
    });
    expect(
      validateSave(toSave(legacy), user.id).buildings[1].size,
    ).toBeUndefined();
    f = editFactory(f, { kind: "delete", id: "machine" });
    expect(f.simulation.warehouse[item]).toBe(1);
  });
  it.each([
    { x: 10, y: 4 },
    { x: 4, y: -10 },
  ])("rejects a partially out-of-bounds footprint at $x/$y", (p) => {
    const f = start();
    expect(() =>
      place(f, "machine", "m08", { ...p, size: 2, rotation: 0 }),
    ).toThrow();
  });
  it("rejects unsupported sizes, covered cells, overlapping saves in either order and resizing by move", () => {
    const f = place(start(), "machine", "m08", { ...square, rotation: 0 });
    expect(() =>
      place(f, "x", "m03", { x: 7, y: 7, size: 2, rotation: 0 }),
    ).toThrow();
    expect(() =>
      place(f, "x", "hand_belt", { x: 5, y: 3, rotation: 0 }),
    ).toThrow();
    expect(placementIssue(f, { x: 5, y: 3 })).toMatch(/占用/);
    expect(() =>
      editFactory(f, {
        kind: "move",
        id: "machine",
        placement: { ...square, size: 1, rotation: 0 },
      }),
    ).toThrow();
    for (const size of [0, 3, null, 1.5]) {
      const bad = structuredClone(toSave(f));
      Object.assign(bad.factory.buildings[1], { size });
      expect(() => validateSave(bad, user.id)).toThrow();
    }
    for (const reversed of [false, true]) {
      const bad = structuredClone(toSave(f));
      bad.factory.buildings.push({
        id: "overlap",
        factory_id: f.id,
        building_type: "hand_belt",
        x: 5,
        y: 3,
        rotation: 0,
        configuration: {},
      });
      bad.factory.simulation!.buildings.overlap = newMachine();
      if (reversed) bad.factory.buildings.reverse();
      expect(() => validateSave(bad, user.id)).toThrow();
    }
  });

  it.each(edges)(
    "feeds and extracts solids through peripheral cell $x/$y",
    (edge) => {
      let f = place(start(), "machine", "m08", { ...square, rotation: 0 });
      configure(f, "r1036");
      f = place(f, "port", "item_input", {
        ...edge,
        rotation: opposite(edge.rotation),
      });
      const [dx, dy] = direction(edge.rotation);
      f = place(f, "source", "hand_belt", {
        x: edge.x + dx,
        y: edge.y + dy,
        rotation: opposite(edge.rotation),
      });
      const item = Object.keys(recipeDefinitions.get("r1036")!.inputs)[0];
      f.simulation.buildings.source.belt = {
        id: "payload",
        item,
        progress: 2,
        count: 1,
      };
      transferSolids(f, f.buildings);
      expect(f.simulation.buildings.machine.input).toEqual([
        { item, count: 1 },
      ]);
      expect(f.simulation.buildings.source.belt).toBeUndefined();
      expect(containsCell(square, f.simulation.transfers![0].target)).toBe(
        true,
      );
      const store = new LogisticsVisualStore({
        ...f,
        simulation: { ...f.simulation, tick: 0, transfers: [] },
      });
      store.accept(
        { ...f, simulation: { ...f.simulation, tick: 0, transfers: [] } },
        0,
        true,
      );
      f.simulation.tick = 1;
      f.simulation.transfers![0].tick = 1;
      store.accept(f, 1000, true);
      expect(
        store.getSnapshot().some((v) => v.transfer?.target.id === "machine"),
      ).toBe(true);
      // Reverse the same feeder, moving one real output back onto the belt.
      f.buildings.find((b) => b.id === "port")!.rotation = edge.rotation;
      f.simulation.buildings.port.cooldown = 0;
      f.simulation.buildings.machine.output = [{ item, count: 1 }];
      transferSolids(f, f.buildings);
      expect(f.simulation.buildings.machine.output).toEqual([]);
      expect(f.simulation.buildings.source.belt?.count).toBe(1);
    },
  );
  it("shares a single real output reserve between multiple adjacent feeders", () => {
    let f = place(start(), "machine", "m08", { ...square, rotation: 0 });
    const item = Object.keys(recipeDefinitions.get("r1036")!.inputs)[0];
    f.simulation.buildings.machine.output = [{ item, count: 1 }];
    for (const [i, edge] of edges.slice(0, 2).entries()) {
      f = place(f, `p${i}`, "item_output", edge);
      const [dx, dy] = direction(edge.rotation);
      f = place(f, `b${i}`, "hand_belt", {
        x: edge.x + dx,
        y: edge.y + dy,
        rotation: edge.rotation,
      });
    }
    transferSolids(f, f.buildings);
    expect(f.simulation.buildings.machine.output).toEqual([]);
    expect(
      [0, 1].reduce(
        (n, i) => n + (f.simulation.buildings[`b${i}`].belt?.count ?? 0),
        0,
      ),
    ).toBe(1);
  });
  it.each(edges)(
    "feeds fluids, fuel and startup medium through peripheral cell $x/$y",
    (edge) => {
      for (const [type, recipe, item, mode, field] of [
        ["m14", "r2025", itemID("浑浊水"), "input", "input"],
        ["m21", "r3013", itemID("液体燃料"), "fuel", "fuel"],
        ["m21", "r3013", itemID("液压工作液"), "medium", "medium"],
      ] as const) {
        let f = place(start(), "machine", type, { ...square, rotation: 0 });
        configure(f, recipe);
        f = place(f, "pipe", "pipe", {
          ...edge,
          rotation: opposite(edge.rotation),
        });
        f.buildings.find((b) => b.id === "pipe")!.configuration.fluid_target =
          mode;
        f.simulation.buildings.pipe.fluid = { item, count: 1 };
        transferFluids(f, f.buildings);
        expect(f.simulation.buildings.pipe.fluid).toBeUndefined();
        expect(
          field === "medium"
            ? f.simulation.buildings.machine.medium
            : f.simulation.buildings.machine[field],
        ).toEqual(field === "medium" ? 1 : [{ item, count: 1 }]);
      }
    },
  );
  it.each(edges)(
    "extracts a selected fluid without duplicating volume through $x/$y",
    (edge) => {
      let f = place(start(), "machine", "m20", { ...square, rotation: 0 });
      const item = itemID("液体燃料");
      f.simulation.buildings.machine.output = [{ item, count: 1 }];
      f = place(f, "pipe", "pipe", edge);
      f.buildings.find((b) => b.id === "pipe")!.configuration.filter = item;
      transferFluids(f, f.buildings);
      expect(f.simulation.buildings.machine.output).toEqual([]);
      expect(f.simulation.buildings.pipe.fluid).toEqual({ item, count: 1 });
    },
  );
  it.each(edges)(
    "attaches an energy network at $x/$y including non-anchor edges",
    (edge) => {
      let f = place(start(), "machine", "m32", { ...square, rotation: 0 });
      f = place(f, "wire", "cable", edge);
      f.buildings.find((b) => b.id === "machine")!.configuration.power_side =
        edge.rotation;
      allocatePower(f, f.buildings);
      expect(f.simulation.buildings.machine.network_id).toBe("electric:wire");
    },
  );
  it("supplies real power through the lower contact without multiplying machine demand", () => {
    let f = place(start(), "machine", "m32", { ...square, rotation: 0 });
    const recipe = catalog.recipes.find(
      (r) => r.building_type === "m32" && (r.power_kw ?? 0) > 0,
    )!;
    configure(f, recipe.id);
    f.simulation.buildings.machine.input = Object.entries(recipe.inputs).map(
      ([item, count]) => ({ item, count }),
    );
    f = place(f, "wire", "cable", { x: 6, y: 3, rotation: 0 });
    f = place(f, "generator", "m28", { x: 7, y: 3, rotation: 0 });
    f.simulation.buildings.generator.fuel = [
      { item: itemID("液体燃料"), count: 1 },
    ];
    allocatePower(f, f.buildings);
    expect(f.simulation.buildings.machine.supplied_kw).toBe(recipe.power_kw);
    expect(f.simulation.buildings.machine.work_energy_kj).toBe(
      recipe.power_kw! * 0.5,
    );
    expect(f.simulation.networks!.reduce((n, g) => n + g.demand_kw, 0)).toBe(
      recipe.power_kw,
    );
  });
  it("shares real fluid output volume across two edge pipes", () => {
    let f = place(start(), "machine", "m20", { ...square, rotation: 0 });
    const item = itemID("液体燃料");
    f.simulation.buildings.machine.output = [{ item, count: 1 }];
    for (const [i, edge] of edges.slice(0, 2).entries())
      f = place(f, `pipe${i}`, "pipe", edge);
    transferFluids(f, f.buildings);
    expect(f.simulation.buildings.machine.output).toEqual([]);
    expect(
      [0, 1].reduce(
        (n, i) => n + (f.simulation.buildings[`pipe${i}`].fluid?.count ?? 0),
        0,
      ),
    ).toBe(1);
  });
  it.each(edges)(
    "docks at $x/$y when the other seven perimeter cells are blocked",
    (edge) => {
      let f = place(start(), "machine", "m08", { ...square, rotation: 0 });
      for (const [i, other] of edges.entries()) {
        if (other.x === edge.x && other.y === edge.y) continue;
        f = place(f, `wall${i}`, "hand_belt", other);
      }
      const plan = journey(
        f,
        { factory_id: f.id, x: 8, y: 8 },
        { factory_id: f.id, building_id: "machine" },
      )!;
      expect(plan.end).toMatchObject({ x: edge.x, y: edge.y });
      expect(plan.route.every((p) => emptyCell(f, p))).toBe(true);
    },
  );
  it("selects one network among multiple edges and never bridges separate grids", () => {
    let f = place(start(), "machine", "m32", { ...square, rotation: 0 });
    f = place(f, "east", "cable", { x: 6, y: 3, rotation: 0 });
    f = place(f, "west", "cable", { x: 3, y: 4, rotation: 0 });
    allocatePower(f, f.buildings);
    expect(f.simulation.networks).toHaveLength(2);
    expect(f.simulation.buildings.machine.network_id).toBe("electric:east");
    f.buildings.find((b) => b.id === "machine")!.configuration.power_side = 180;
    allocatePower(f, f.buildings);
    expect(f.simulation.buildings.machine.network_id).toBe("electric:west");
  });
  it("blocks all four cells in paths and unloads from the far lower-right edge", () => {
    let f = place(start(), "machine", "m08", { ...square, rotation: 0 });
    configure(f, "r1036");
    f = place(f, "station", "charge_station", { x: 8, y: 0, rotation: 0 });
    const endpoint = { factory_id: f.id, building_id: "machine" };
    const plan = journey(f, { factory_id: f.id, x: 8, y: 3 }, endpoint)!;
    expect(plan.end).toMatchObject({ x: 6, y: 3 });
    expect(plan.route.every((p) => !containsCell(square, p))).toBe(true);
    expect(emptyCell(f, { x: 5, y: 3 })).toBe(false);
    const item = Object.keys(recipeDefinitions.get("r1036")!.inputs)[0];
    f.robots = [
      {
        id: "r",
        item: itemID("智能机器人"),
        home_factory_id: f.id,
        home_station: "station",
        factory_id: f.id,
        x: 6,
        y: 3,
        energy_kj: 30000,
        enabled: true,
        allowed_zones: [f.id],
        priority: 3,
        cooldown: 0,
        status: "unloading",
        work_progress: 1,
        cargo: { item, count: 1 },
        task: {
          id: "task",
          source: { factory_id: f.id, building_id: f.buildings[0].id },
          target: endpoint,
          item,
          count: 1,
          channel: "input",
          repeat: false,
          phase: "deliver",
          delivered: 0,
        },
      },
    ];
    for (let i = 0; i < 4; i++) stepFreight(f);
    expect(f.simulation.buildings.machine.input).toEqual([{ item, count: 1 }]);
    const bad = structuredClone(toSave(f));
    bad.factory.robots![0].x = 5;
    bad.factory.robots![0].y = 3;
    expect(() => validateSave(bad, user.id)).toThrow();
  });
  it("reserves all blueprint cells, prevents covered robot landing, and installs exactly one large device", () => {
    let f = place(start(), "station", "charge_station", {
      x: 8,
      y: 0,
      rotation: 0,
    });
    f.simulation.warehouse[itemID("智能机器人")] = 1;
    f = actWorld(f, {
      type: "robot_deploy",
      id: "r",
      item: itemID("智能机器人"),
      station: "station",
      factory_id: f.id,
    });
    f.robots![0].energy_kj = 30000;
    f.simulation.warehouse[buildingDefinitions.get("m08")!.item!] = 1;
    f = actWorld(f, {
      type: "robot_construct",
      id: "r",
      blueprint: {
        id: "site",
        factory_id: f.id,
        building_type: "m08",
        ...square,
        rotation: 90,
      },
    });
    expect(emptyCell(plannedLayout(f, f), { x: 5, y: 3 })).toBe(false);
    expect(() =>
      editWorld(f, {
        kind: "place",
        id: "x",
        building_type: "item_input",
        placement: { x: 5, y: 3, rotation: 0 },
      }),
    ).toThrow(/预留/);
    expect(validateSave(toSave(f), user.id).robots![0].construction!.size).toBe(
      2,
    );
    for (let i = 0; i < 80 && !f.buildings.some((b) => b.id === "site"); i++)
      f = stepWorld(f);
    expect(f.buildings.filter((b) => b.id === "site")).toHaveLength(1);
    expect(f.buildings.find((b) => b.id === "site")!.size).toBe(2);
    expect(
      validateSave(toSave(f), user.id).buildings.find((b) => b.id === "site")!
        .size,
    ).toBe(2);
  });
});
