import { describe, expect, it } from "vitest";
import { catalog, buildingDefinitions, itemID, isPort } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import { transferSolids } from "./logistics";
import type { IndustryAction } from "./industry";

const user = {
  id: "logistics",
  username: "logistics",
  display_name: "物流员",
  created_at: "now",
  last_login_at: "now",
};
const start = (stage = 1) => {
  const f = createLocalFactory(user, "物流厂");
  f.simulation.industry!.stage = stage;
  if (stage > 1) {
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
  }
  f.simulation.industry!.milestones = catalog
    .stages!.slice(0, stage - 1)
    .map((s) => s.milestone_item);
  return f;
};
function place(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
) {
  const item = buildingDefinitions.get(type)?.item;
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
const advance = (f: LocalFactory, n: number) => {
  for (let i = 0; i < n * 2; i++) f = step(f);
  return f;
};
const total = (f: LocalFactory, item: string) =>
  (f.simulation.warehouse[item] ?? 0) +
  Object.values(f.simulation.buildings).reduce(
    (sum, m) =>
      sum +
      [...m.input, ...m.output, ...(m.fuel ?? [])]
        .filter((s) => s.item === item)
        .reduce((n, s) => n + s.count, 0) +
      (m.belt?.item === item ? (m.belt.count ?? 1) : 0),
    0,
  );
// Isolate the transport planner from generation/energy allocation. These
// fixtures explicitly grant power and present ready belts; network tests own
// the right to grant it, and step tests below own real half/one-second timing.
function transfer(f: LocalFactory) {
  const next = structuredClone(f);
  next.simulation.tick++;
  transferSolids(
    next,
    [...next.buildings].sort((a, b) => a.id.localeCompare(b.id)),
  );
  return next;
}

describe("solid logistics", () => {
  it("supplies ceramic powder for R1024 when the first source item is sand and its furnace input is full", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "furnace", "m06", 4, 0);
    f = act(f, { type: "recipe", id: "furnace", recipe: "r1024" });
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.buildings.box.output = [
      { item: sand, count: 100 },
      { item: powder, count: 100 },
    ];
    f.simulation.buildings.furnace.input = [{ item: sand, count: 100 }];
    f.simulation.buildings.furnace.fuel = [
      { item: itemID("干燥生物质"), count: 100 },
    ];
    const before = structuredClone(f);
    f = step(f);
    expect(f.simulation.buildings.port.status).toBe("transferring");
    expect(f.simulation.buildings.furnace.input).toEqual([
      { item: sand, count: 100 },
      { item: powder, count: 20 },
    ]);
    expect(f.simulation.buildings.box.output).toEqual([
      { item: sand, count: 100 },
      { item: powder, count: 80 },
    ]);
    expect(f.simulation.transfers).toHaveLength(1);
    expect(f.simulation.transfers![0]).toMatchObject({
      item: powder,
      count: 20,
    });
    expect(total(f, sand)).toBe(total(before, sand));
    expect(total(f, powder)).toBe(total(before, powder));
    expect(before.simulation.buildings.box.output[1].count).toBe(100);
    f = advance(f, 2);
    expect(f.simulation.buildings.furnace.status).toBe("working");
    expect(f.simulation.buildings.furnace.input).toContainEqual({
      item: powder,
      count: 100,
    });
    f = advance(f, 12);
    expect(f.simulation.buildings.furnace.output).toContainEqual({
      item: itemID("耐火砖"),
      count: 2,
    });
  });
  it.each(
    catalog.buildings
      .filter((d) => isPort(d.id))
      .map((d) => [d.id, d.batch_size ?? 1] as const),
  )(
    "tries later output stacks for %s without exceeding its batch size",
    (type, batch) => {
      let f = place(start(6), "box", "chest", 2, 0);
      f = place(f, "port", type, 3, 0);
      f = place(f, "furnace", "m06", 4, 0);
      f = act(f, { type: "recipe", id: "furnace", recipe: "r1024" });
      const sand = itemID("砂粒"),
        powder = itemID("陶瓷粉");
      f.simulation.buildings.box.output = [
        { item: sand, count: 100 },
        { item: powder, count: 100 },
      ];
      f.simulation.buildings.furnace.input = [{ item: sand, count: 100 }];
      f.simulation.buildings.port.powered = true;
      f = transfer(f);
      expect(f.simulation.buildings.furnace.input).toContainEqual({
        item: powder,
        count: batch,
      });
      expect(f.simulation.buildings.box.output).toContainEqual({
        item: powder,
        count: 100 - batch,
      });
      expect(f.simulation.transfers).toHaveLength(1);
      expect(total(f, sand)).toBe(200);
      expect(total(f, powder)).toBe(100);
    },
  );
  it("tries machine outputs against a target belt filter and does not take machine inputs", () => {
    let f = place(start(), "machine", "m02", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "belt", "hand_belt", 4, 0);
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.buildings.machine.output = [
      { item: sand, count: 2 },
      { item: powder, count: 1 },
    ];
    f.simulation.buildings.machine.input = [{ item: powder, count: 20 }];
    f = act(f, { type: "transport", id: "belt", filter: powder });
    f = transfer(f);
    expect(f.simulation.buildings.belt.belt).toMatchObject({
      item: powder,
      count: 1,
    });
    expect(f.simulation.buildings.machine.output).toEqual([
      { item: sand, count: 2 },
    ]);
    expect(f.simulation.buildings.machine.input).toEqual([
      { item: powder, count: 20 },
    ]);
    expect(total(f, powder)).toBe(21);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
  });
  it("persists the selected item through feeder, belt movement and repeated save reloads", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "belt", "hand_belt", 4, 0);
    f = place(f, "next", "hand_belt", 5, 0);
    const item = itemID("陶瓷粉");
    f.simulation.buildings.box.output = [{ item, count: 3 }];
    for (let tick = 0; tick < 12; tick++) {
      f = step(f);
      const saved = toSave(f);
      expect(() => validateSave(saved, user.id)).not.toThrow();
      expect(() =>
        validateSave(JSON.parse(JSON.stringify(saved)), user.id),
      ).not.toThrow();
      for (const machine of Object.values(f.simulation.buildings))
        if (machine.belt) expect(machine.belt.item).toBe(item);
      for (const receipt of f.simulation.transfers ?? [])
        expect(receipt.item).toBe(item);
      expect(total(f, item)).toBe(3);
      f = validateSave(structuredClone(saved), user.id);
    }
  });
  it("tries another fuel without using the recipe input channel or bypassing an explicit source filter", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "furnace", "m06", 4, 0);
    const biomass = itemID("干燥生物质"),
      carbon = itemID("生物炭");
    f.simulation.buildings.box.output = [
      { item: biomass, count: 2 },
      { item: carbon, count: 2 },
    ];
    f.simulation.buildings.furnace.fuel = [{ item: biomass, count: 100 }];
    f = act(f, {
      type: "transport",
      id: "port",
      channel: "fuel",
      filter: biomass,
    });
    f = transfer(f);
    expect(f.simulation.transfers).toEqual([]);
    expect(f.simulation.buildings.port.cooldown).toBe(0);
    f = act(f, { type: "transport", id: "port", filter: "" });
    f = transfer(f);
    expect(f.simulation.buildings.furnace.fuel).toContainEqual({
      item: carbon,
      count: 2,
    });
    expect(f.simulation.buildings.furnace.input).toEqual([]);
    expect(total(f, biomass)).toBe(102);
    expect(total(f, carbon)).toBe(2);
  });
  it("reserves a scarce later item once when two feeders draw from the same mixed box", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "east-port", "feeder", 3, 0);
    f = place(f, "east-furnace", "m06", 4, 0);
    f = place(f, "south-port", "feeder", 2, -1, 90);
    f = place(f, "south-furnace", "m06", 2, -2);
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.buildings.box.output = [
      { item: sand, count: 100 },
      { item: powder, count: 1 },
    ];
    for (const id of ["east-furnace", "south-furnace"]) {
      f = act(f, { type: "recipe", id, recipe: "r1024" });
      f.simulation.buildings[id].input = [{ item: sand, count: 100 }];
    }
    f = transfer(f);
    expect(f.simulation.transfers).toHaveLength(1);
    expect(f.simulation.buildings.box.output).toEqual([
      { item: sand, count: 100 },
    ]);
    expect(total(f, powder)).toBe(1);
    expect(total(f, sand)).toBe(300);
  });
  it("fills an existing stack in a full-slot box after skipping a full first stack", () => {
    let f = place(start(), "source", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "target", "chest", 4, 0);
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    const extras = catalog.items
      .filter(
        (i) => ![sand, powder].includes(i.id) && i.kind !== "fluid_or_gas",
      )
      .slice(0, 6);
    f.simulation.buildings.source.output = [
      { item: sand, count: 1 },
      { item: powder, count: 1 },
    ];
    f.simulation.buildings.target.output = [
      { item: sand, count: 100 },
      { item: powder, count: 99 },
      ...extras.map((i) => ({ item: i.id, count: 1 })),
    ];
    f = transfer(f);
    expect(f.simulation.buildings.target.output).toHaveLength(8);
    expect(f.simulation.buildings.target.output).toContainEqual({
      item: powder,
      count: 100,
    });
    expect(f.simulation.buildings.source.output).toEqual([
      { item: sand, count: 1 },
    ]);
  });
  it("tries other source items against the WH intake filter", () => {
    let f = place(start(), "source", "chest", -2, 0);
    f = place(f, "port", "feeder", -1, 0);
    const bus = f.buildings[0].id,
      sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.buildings.source.output = [
      { item: sand, count: 1 },
      { item: powder, count: 1 },
    ];
    f = act(f, {
      type: "bus_face",
      id: bus,
      rotation: 180,
      mode: "input",
      filter: powder,
    });
    f = transfer(f);
    expect(f.simulation.warehouse[powder]).toBe(1);
    expect(f.simulation.buildings.source.output).toEqual([
      { item: sand, count: 1 },
    ]);
    expect(f.simulation.transfers).toHaveLength(1);
  });
  it("reroutes a splitter to its free branch when its first choice is an occupied belt that cannot vacate", () => {
    let f = place(start(2), "box", "chest", 2, 0);
    f = place(f, "split", "m17", 3, 0);
    f = place(f, "blocked", "hand_belt", 4, 0);
    f = place(f, "open", "chest", 3, -1);
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.buildings.box.output = [{ item: powder, count: 2 }];
    f.simulation.buildings.blocked.belt = {
      id: "held",
      item: sand,
      count: 1,
      progress: 2,
    };
    f.simulation.buildings.split.powered = true;
    f = transfer(f);
    expect(f.simulation.buildings.open.output).toEqual([
      { item: powder, count: 1 },
    ]);
    expect(f.simulation.buildings.box.output).toEqual([
      { item: powder, count: 1 },
    ]);
    expect(f.simulation.buildings.blocked.belt?.id).toBe("held");
    expect(f.simulation.transfers).toHaveLength(1);
    expect(f.simulation.buildings.split.cooldown).toBe(1);
    expect(total(f, powder)).toBe(2);
    expect(total(f, sand)).toBe(1);
  });
  it("releases failed belt reservations for another feeder and never forwards new arrivals in the same tick", () => {
    let f = place(start(2), "box", "chest", 2, 0);
    f = place(f, "a-split", "m17", 3, 0);
    f = place(f, "blocked", "hand_belt", 4, 0);
    f = place(f, "z-port", "feeder", 2, 1, 270);
    f = place(f, "middle", "chest", 2, 2);
    f = place(f, "next-port", "feeder", 2, 3, 270);
    f = place(f, "last", "chest", 2, 4);
    const sand = itemID("砂粒"),
      powder = itemID("陶瓷粉");
    f.simulation.tick = 1;
    f.simulation.buildings.box.output = [{ item: powder, count: 1 }];
    f.simulation.buildings.blocked.belt = {
      id: "held",
      item: sand,
      count: 1,
      progress: 2,
    };
    f.simulation.buildings["a-split"].powered = true;
    f = transfer(f);
    expect(f.simulation.buildings.middle.output).toEqual([
      { item: powder, count: 1 },
    ]);
    expect(f.simulation.buildings.last.output).toEqual([]);
    expect(f.simulation.buildings.box.output).toEqual([]);
    expect(f.simulation.transfers).toHaveLength(1);
    expect(f.simulation.transfers![0].via?.id).toBe("z-port");
    expect(total(f, powder)).toBe(1);
  });
  it("extracts only at the top edge, allows multiple paid ports and produces twelve bags per ten active seconds", () => {
    let f = start();
    f.simulation.warehouse[itemID("初阶自动投料机")] = 2;
    const before = structuredClone(f);
    expect(() =>
      editFactory(f, {
        kind: "place",
        id: "bad",
        building_type: "waste_port",
        placement: { x: 1, y: 9, rotation: 0 },
      }),
    ).toThrow();
    expect(f).toEqual(before);
    f = place(f, "source", "waste_port", 0, 10);
    f = place(f, "extra", "waste_port", 1, 10);
    expect(() =>
      editFactory(f, {
        kind: "move",
        id: "source",
        placement: { x: 0, y: 9, rotation: 0 },
      }),
    ).toThrow();
    f = advance(f, 9);
    expect(total(f, itemID("垃圾包"))).toBe(0);
    f = advance(f, 1);
    expect(total(f, itemID("垃圾包"))).toBe(24);
    f = act(f, { type: "transport", id: "source", enabled: false });
    f = act(f, { type: "transport", id: "extra", enabled: false });
    expect(total(advance(f, 100), itemID("垃圾包"))).toBe(24);
  });
  it("moves a hand belt exactly one cell after two half-second ticks and atomically advances a full loop", () => {
    let f = place(start(), "slow", "hand_belt", -1, 0);
    f.simulation.buildings.slow.belt = {
      id: "bag",
      item: itemID("垃圾包"),
      count: 1,
      progress: 0,
    };
    f = step(f);
    expect(f.simulation.warehouse[itemID("垃圾包")] ?? 0).toBe(0);
    f = step(f);
    expect(f.simulation.warehouse[itemID("垃圾包")]).toBe(1);
    let loop = start();
    for (const [id, x, y, rotation] of [
      ["a", 2, 0, 0],
      ["b", 3, 0, 90],
      ["c", 3, -1, 180],
      ["d", 2, -1, 270],
    ] as const) {
      loop = place(loop, id, "hand_belt", x, y, rotation);
      loop.simulation.buildings[id].belt = {
        id,
        item: itemID("垃圾包"),
        progress: 2,
      };
    }
    loop = step(loop);
    expect(
      ["a", "b", "c", "d"].map((id) => loop.simulation.buildings[id].belt?.id),
    ).toEqual(["d", "a", "b", "c"]);
    expect(total(loop, itemID("垃圾包"))).toBe(4);
  });
  it("reserves warehouse stock across all faces, and never runs it negative", () => {
    let f = start();
    const bus = f.buildings[0].id,
      item = itemID("铁质碎片");
    for (const [id, x, y, r] of [
      ["e", 1, 0, 0],
      ["w", -1, 0, 180],
      ["n", 0, 1, 270],
    ] as const) {
      f = place(f, id, "hand_belt", x, y, r);
      f = act(f, {
        type: "bus_face",
        id: bus,
        rotation: r,
        mode: "output",
        filter: item,
      });
    }
    f.simulation.warehouse[item] = 1;
    f = step(f);
    expect(f.simulation.warehouse[item]).toBe(0);
    expect(
      Object.values(f.simulation.buildings).filter((m) => m.belt).length,
    ).toBe(1);
    expect(total(f, item)).toBe(1);
    expect(f.simulation.warehouse).not.toHaveProperty("undefined");
    expect(f.simulation.transfers?.[0]).toMatchObject({ item, count: 1 });
    expect(
      Object.values(f.simulation.buildings).find((m) => m.belt)?.belt?.item,
    ).toBe(item);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
  });
  it("checks the actual intake face and preserves refused items without cosmetic success", () => {
    let f = place(start(), "belt", "hand_belt", -1, 0);
    const item = itemID("垃圾包");
    const bus = f.buildings[0].id;
    f.simulation.buildings.belt.belt = { id: "bag", item, progress: 2 };
    f = act(f, {
      type: "bus_face",
      id: bus,
      rotation: 180,
      mode: "closed",
      filter: "",
    });
    f = step(f);
    expect(f.simulation.buildings.belt.belt?.id).toBe("bag");
    expect(f.simulation.transfers).toEqual([]);
    f = act(f, {
      type: "bus_face",
      id: bus,
      rotation: 180,
      mode: "input",
      filter: item,
    });
    f = step(f);
    expect(f.simulation.warehouse[item]).toBe(1);
    expect(f.simulation.transfers).toHaveLength(1);
  });
  it("uses finite box storage and respects explicit filters and the selected recipe", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "machine", "m02", 4, 0);
    f = act(f, { type: "recipe", id: "machine", recipe: "r1001" });
    const bag = itemID("垃圾包"),
      scrap = itemID("铁质碎片");
    Object.assign(f.simulation.warehouse, { [scrap]: 3, [bag]: 12 });
    f = act(f, { type: "deposit", id: "box", item: scrap, count: 3 });
    f = act(f, { type: "deposit", id: "box", item: bag, count: 12 });
    f = act(f, { type: "transport", id: "port", filter: scrap });
    f = step(f);
    expect(f.simulation.buildings.port.status).toBe("rejected");
    expect(f.simulation.buildings.machine.input).toEqual([]);
    f = act(f, { type: "transport", id: "port", filter: bag, interval: 3 });
    f = advance(f, 4);
    expect(f.simulation.buildings.machine.input).toEqual([
      { item: bag, count: 12 },
    ]);
    expect(total(f, bag)).toBe(12);
    expect(total(f, scrap)).toBe(3);
    const invalid = structuredClone(f);
    // The twenty-item feeder has already removed all twelve bags. Seed a
    // partial stack explicitly so adding another hundred really overflows.
    invalid.simulation.buildings.box.output.push({ item: bag, count: 1 });
    invalid.simulation.warehouse[bag] = 100;
    expect(() =>
      act(invalid, { type: "deposit", id: "box", item: bag, count: 100 }),
    ).toThrow();
    expect(invalid.simulation.warehouse[bag]).toBe(100);
  });
  it("sends fuel to its separate cache while leaving the same chemical ingredient in place", () => {
    let f = place(start(), "box", "chest", 2, 0);
    f = place(f, "port", "feeder", 3, 0);
    f = place(f, "furnace", "m05", 4, 0);
    f = act(f, { type: "recipe", id: "furnace", recipe: "r1017" });
    const biomass = itemID("干燥生物质");
    f.simulation.buildings.furnace.input = [{ item: biomass, count: 3 }];
    f.simulation.warehouse[biomass] = 1;
    f = act(f, { type: "deposit", id: "box", item: biomass, count: 1 });
    f = act(f, {
      type: "transport",
      id: "port",
      filter: biomass,
      channel: "fuel",
    });
    f = step(f);
    expect(f.simulation.buildings.furnace.input[0].count).toBe(3);
    expect(f.simulation.buildings.furnace.fuel).toEqual([
      { item: biomass, count: 1 },
    ]);
  });
  it("never loads fluids on belts or into solid boxes", () => {
    let f = place(start(), "box", "chest", 1, 0);
    const water = itemID("浑浊水");
    f.simulation.warehouse[water] = 2;
    expect(() =>
      act(f, { type: "deposit", id: "box", item: water, count: 1 }),
    ).toThrow();
    f = place(f, "belt", "hand_belt", 2, 0);
    const bad = toSave(f);
    bad.factory.simulation!.buildings.belt.belt = {
      id: "fluid",
      item: water,
      progress: 0,
    };
    expect(() => validateSave(bad, user.id)).toThrow();
  });
  it("moves powered batches and splits them onto slow belts without duplicate IDs or lost units", () => {
    let f = place(start(4), "fast", "electric_belt", -2, 0);
    f = place(f, "slow", "hand_belt", -1, 0);
    const item = itemID("铁质碎片");
    f.simulation.buildings.fast.supplied_kw = 2;
    f.simulation.buildings.fast.powered = true;
    f.simulation.buildings.fast.belt = {
      id: "batch",
      item,
      count: 3,
      progress: 1,
    };
    f = transfer(f);
    expect(f.simulation.buildings.fast.belt?.count).toBe(1);
    expect(f.simulation.buildings.slow.belt?.count).toBe(2);
    expect(f.simulation.buildings.slow.belt?.id).not.toBe("batch");
    expect(total(f, item)).toBe(3);
    f.simulation.buildings.slow.belt!.progress = 2;
    f = transfer(f);
    expect(f.simulation.warehouse[item]).toBe(2);
    expect(f.simulation.buildings.fast.belt).toBeUndefined();
    expect(total(f, item)).toBe(3);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
    f = editFactory(f, { kind: "delete", id: "fast" });
    expect(total(f, item)).toBe(3);
  });
  it.each([
    ["electric_feeder", "electric_belt", 3, 5],
    ["precision_feeder", "precision_belt", 5, 8],
    ["flexible_feeder", "flexible_belt", 6, 12],
  ] as const)(
    "%s commits its powered batch exactly once",
    (armType, beltType, quantity, power) => {
      let f = place(start(6), "box", "chest", 2, 0);
      f = place(f, "arm", armType, 3, 0);
      f = place(f, "belt", beltType, 4, 0);
      const item = itemID("基础铁板");
      f.simulation.buildings.box.output = [{ item, count: 7 }];
      f.simulation.buildings.arm.supplied_kw = power;
      f.simulation.buildings.arm.powered = true;
      f.simulation.buildings.belt.powered = true;
      f.simulation.buildings.belt.supplied_kw =
        buildingDefinitions.get(beltType)!.power_kw;
      f = transfer(f);
      expect(f.simulation.buildings.box.output[0].count).toBe(7 - quantity);
      expect(f.simulation.buildings.belt.belt?.count).toBe(quantity);
      expect(f.simulation.transfers?.[0].count).toBe(quantity);
      expect(total(f, item)).toBe(7);
      f.simulation.buildings.arm.cooldown = 0;
      const held = transfer(f);
      expect(held.simulation.buildings.box.output[0].count).toBe(7 - quantity);
      expect(total(held, item)).toBe(7);
    },
  );
  it("uses branch filters, distributes distinct batches fairly and keeps blocked sources", () => {
    let f = place(start(2), "box", "chest", 2, 0);
    f = place(f, "split", "m17", 3, 0);
    f = place(f, "iron", "chest", 4, 0);
    f = place(f, "plastic", "chest", 3, -1);
    const iron = itemID("铁质碎片"),
      plastic = itemID("混合塑料");
    f.simulation.buildings.box.output = [
      { item: iron, count: 2 },
      { item: plastic, count: 2 },
    ];
    f.simulation.buildings.split.supplied_kw = 5;
    f.simulation.buildings.split.powered = true;
    f = act(f, { type: "branch", id: "split", rotation: 0, filter: iron });
    f = act(f, { type: "branch", id: "split", rotation: 90, filter: plastic });
    for (let n = 0; n < 4; n++) {
      f.simulation.buildings.split.cooldown = 0;
      f = transfer(f);
    }
    expect(f.simulation.buildings.iron.output).toEqual([
      { item: iron, count: 2 },
    ]);
    expect(f.simulation.buildings.plastic.output).toEqual([
      { item: plastic, count: 2 },
    ]);
    expect(total(f, iron)).toBe(2);
    expect(total(f, plastic)).toBe(2);
  });
  it("keeps paused/blocked/powerless transport stationary and preserves validated configuration", () => {
    let f = place(start(4), "belt", "electric_belt", -1, 0);
    f.simulation.buildings.belt.belt = {
      id: "batch",
      item: itemID("铁质碎片"),
      count: 3,
      progress: 0,
    };
    f = advance(f, 10);
    expect(f.simulation.buildings.belt.status).toBe("no_energy");
    expect(f.simulation.buildings.belt.belt?.progress).toBe(0);
    f = act(f, { type: "transport", id: "belt", enabled: false });
    const restored = validateSave(toSave(f), user.id);
    expect(
      restored.buildings.find((b) => b.id === "belt")?.configuration.enabled,
    ).toBe(false);
    expect(() =>
      act(f, { type: "transport", id: "belt", interval: 0 }),
    ).toThrow();
  });
});
