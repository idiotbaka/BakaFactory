import { describe, expect, it } from "vitest";
import type { BuildingInstance } from "../../api/client";
import { buildingDefinitions, itemID } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import { transferSolids } from "./logistics";
import { autoEject, canAutoEject } from "./machineOutput";
import type { IndustryAction } from "./industry";
import { LogisticsVisualStore } from "../logisticsVisuals";

const user = {
  id: "auto-eject",
  username: "auto-eject",
  display_name: "自动弹出",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("铁质碎片"),
  copper = itemID("废铜线"),
  garbage = itemID("垃圾包");
function node(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  rotation: BuildingInstance["rotation"] = 0,
  size = 1,
) {
  const b: BuildingInstance = {
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    rotation,
    ...(size === 2 ? { size: 2 } : {}),
    configuration: {},
  };
  f.buildings.push(b);
  f.simulation.buildings[id] = newMachine();
  return b;
}
function line(type = "chest", amount = 30) {
  const f = createLocalFactory(user, "弹出回归");
  const source = node(f, "source", "m02", 3, 3);
  source.configuration.auto_eject = true;
  node(f, "target", type, 4, 3);
  f.simulation.buildings.source.output = [{ item: iron, count: amount }];
  return f;
}
// Isolate routing tests from production / power. Timing cases below use step.
function transfer(current: LocalFactory) {
  const next = structuredClone(current);
  next.simulation.tick++;
  transferSolids(
    next,
    [...next.buildings].sort((a, b) => a.id.localeCompare(b.id)),
  );
  return next;
}
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
const setEject = (f: LocalFactory, enabled: boolean) =>
  editFactory(f, {
    kind: "industry",
    action: { type: "auto_eject", id: "source", enabled },
  });

describe("machine automatic product ejection", () => {
  it("defaults off for old machines and toggles without resetting inventory, power or in-progress work", () => {
    const f = line();
    const b = f.buildings.find((b) => b.id === "source")!;
    delete b.configuration.auto_eject;
    const m = f.simulation.buildings.source;
    Object.assign(m, {
      progress: 1.5,
      work_energy_kj: 2.5,
      powered: true,
      cooldown: 0.5,
      status: "working",
    });
    expect(autoEject(b)).toBe(false);
    expect(transfer(f).simulation.buildings.target.output).toEqual([]);
    const next = setEject(f, true);
    expect(next.simulation.buildings.source).toEqual(m);
    expect(b.configuration.auto_eject).toBeUndefined();
    expect(autoEject(next.buildings.find((b) => b.id === "source")!)).toBe(
      true,
    );
    expect(
      validateSave(
        JSON.parse(JSON.stringify(toSave(next))),
        user.id,
      ).buildings.find((b) => b.id === "source")!.configuration.auto_eject,
    ).toBe(true);
    const off = setEject(next, false);
    expect(
      off.buildings.find((b) => b.id === "source")!.configuration.auto_eject,
    ).toBe(false);
    expect(transfer(off).simulation.buildings.target.output).toEqual([]);
  });

  it("rejects malformed switches and unsupported facilities atomically on edits and save loading", () => {
    const f = line();
    const before = structuredClone(f);
    for (const value of [null, 1, "true", {}, []]) {
      const action = {
        type: "auto_eject",
        id: "source",
        enabled: value,
      } as unknown as IndustryAction;
      expect(() => editFactory(f, { kind: "industry", action })).toThrow();
      const save = structuredClone(toSave(f));
      save.factory.buildings.find(
        (b) => b.id === "source",
      )!.configuration.auto_eject = value;
      expect(() => validateSave(save, user.id)).toThrow();
    }
    for (const id of [
      f.buildings.find((b) => b.building_type === "bus")!.id,
      "target",
    ]) {
      expect(() =>
        editFactory(f, {
          kind: "industry",
          action: { type: "auto_eject", id, enabled: true },
        }),
      ).toThrow();
      const bad = structuredClone(toSave(f));
      bad.factory.buildings.find((b) => b.id === id)!.configuration.auto_eject =
        false;
      expect(() => validateSave(bad, user.id)).toThrow();
    }
    expect(f).toEqual(before);
    expect(canAutoEject("miner")).toBe(true);
    expect(canAutoEject("feeder")).toBe(false);
    expect(canAutoEject("waste_extractor")).toBe(false);
  });

  it("attempts exactly one batch of at most six each half second and preserves prior snapshots", () => {
    let f = line();
    const before = structuredClone(f);
    for (let tick = 1; tick <= 4; tick++) {
      f = step(f);
      expect(f.simulation.buildings.target.output).toEqual([
        { item: iron, count: tick * 6 },
      ]);
      expect(
        f.simulation.transfers!.filter((t) => t.tick === tick),
      ).toMatchObject([
        { count: 6, source: { id: "source" }, target: { id: "target" } },
      ]);
      expect(total(f, iron)).toBe(30);
    }
    expect(before.simulation.buildings.source.output).toEqual([
      { item: iron, count: 30 },
    ]);
  });

  it("can eject a newly completed batch, but never moves raw inputs or manufactures an extra batch", () => {
    let f = line("chest", 1);
    f.simulation.buildings.source.output = [];
    const source = f.buildings.find((b) => b.id === "source")!;
    source.configuration.recipe_id = "r1001";
    Object.assign(f.simulation.buildings.source, {
      input: [{ item: garbage, count: 24 }],
      progress: 9.5,
    });
    f = step(f);
    expect(f.simulation.buildings.target.output).toEqual([
      { item: iron, count: 3 },
    ]);
    expect(f.simulation.buildings.source.input).toEqual([
      { item: garbage, count: 12 },
    ]);
    expect(f.simulation.buildings.source.batches_completed).toBe(1);
    expect(f.simulation.buildings.source.progress).toBe(0);
    expect(total(f, iron)).toBe(3);
    expect(total(f, garbage)).toBe(12);
  });

  it.each([
    [0, 5, 4],
    [90, 4, 3],
    [180, 3, 4],
    [270, 4, 5],
  ] as const)(
    "ejects only to the facing cell at rotation %s",
    (rotation, x, y) => {
      const f = createLocalFactory(user, "四向");
      const source = node(f, "source", "m02", 4, 4, rotation);
      source.configuration.auto_eject = true;
      for (const [id, px, py] of [
        ["right", 5, 4],
        ["down", 4, 3],
        ["left", 3, 4],
        ["up", 4, 5],
      ] as const)
        node(f, id, "chest", px, py);
      f.simulation.buildings.source.output = [{ item: iron, count: 12 }];
      const next = transfer(f);
      for (const b of next.buildings.filter((b) => b.building_type === "chest"))
        expect(next.simulation.buildings[b.id].output).toEqual(
          b.x === x && b.y === y ? [{ item: iron, count: 6 }] : [],
        );
      expect(total(next, iron)).toBe(12);
    },
  );

  it.each([
    "hand_belt",
    "mechanical_belt",
    "hydraulic_belt",
    "electric_belt",
    "precision_belt",
    "flexible_belt",
  ])("respects %s capacity and creates one identified load", (type) => {
    const f = line(type);
    f.simulation.buildings.target.powered = true;
    const next = transfer(f),
      expected = Math.min(6, buildingDefinitions.get(type)!.batch_size!);
    expect(next.simulation.buildings.target.belt).toMatchObject({
      item: iron,
      count: expected,
      progress: 0,
    });
    expect(next.simulation.transfers).toMatchObject([
      {
        payload_id: next.simulation.buildings.target.belt!.id,
        count: expected,
      },
    ]);
    expect(total(next, iron)).toBe(30);
  });

  it("clamps to remaining container and selected recipe input space and skips rejected earlier products", () => {
    for (const type of ["chest", "m02"]) {
      const f = line(type);
      const target = f.buildings.find((b) => b.id === "target")!;
      if (type === "m02") target.configuration.recipe_id = "r1002";
      const field = type === "chest" ? "output" : "input";
      f.simulation.buildings.target[field] = [{ item: iron, count: 98 }];
      f.simulation.buildings.source.output = [
        { item: copper, count: 10 },
        { item: iron, count: 10 },
      ];
      if (type === "chest") target.configuration.filter = iron;
      const next = transfer(f);
      expect(next.simulation.buildings.target[field]).toEqual([
        { item: iron, count: 100 },
      ]);
      expect(next.simulation.buildings.source.output).toEqual([
        { item: copper, count: 10 },
        { item: iron, count: 8 },
      ]);
      expect(total(next, iron)).toBe(108);
      expect(total(next, copper)).toBe(10);
    }
  });

  it("keeps products on blocked, filtered, unconfigured, unpowered belt and nonreceiving targets", () => {
    for (const type of [
      "chest",
      "m02",
      "hand_belt",
      "mechanical_belt",
      "feeder",
      "cable",
    ]) {
      const f = line(type);
      const target = f.buildings.find((b) => b.id === "target")!;
      if (type === "chest") target.configuration.filter = copper;
      if (type === "hand_belt")
        f.simulation.buildings.target.belt = {
          id: "old",
          item: iron,
          count: 2,
          progress: 2,
        };
      const before = structuredClone(f);
      const next = transfer(f);
      expect(next.simulation.buildings.source.output).toEqual(
        before.simulation.buildings.source.output,
      );
      expect(next.simulation.transfers).toEqual([]);
      expect(total(next, iron)).toBe(total(before, iron));
    }
    const empty = line();
    empty.buildings = empty.buildings.filter((b) => b.id !== "target");
    delete empty.simulation.buildings.target;
    expect(transfer(empty).simulation.buildings.source.output).toEqual(
      empty.simulation.buildings.source.output,
    );
  });

  it("does not extract inputs, fuels or fluids and never uses the fuel channel", () => {
    const f = line("m06");
    const water = itemID("浑浊水"),
      fuel = itemID("干燥生物质");
    f.buildings.find((b) => b.id === "target")!.configuration.recipe_id =
      "r1020";
    f.simulation.buildings.source.input = [{ item: iron, count: 20 }];
    f.simulation.buildings.source.output = [
      { item: water, count: 20 },
      { item: fuel, count: 20 },
    ];
    const next = transfer(f);
    expect(next.simulation.buildings.source).toEqual(
      f.simulation.buildings.source,
    );
    expect(next.simulation.buildings.target.fuel ?? []).toEqual([]);
    expect(next.simulation.transfers).toEqual([]);
    const mixed = line();
    mixed.simulation.buildings.source.output.unshift({
      item: water,
      count: 10,
    });
    const moved = transfer(mixed);
    expect(moved.simulation.buildings.target.output).toEqual([
      { item: iron, count: 6 },
    ]);
    expect(total(moved, water)).toBe(10);
  });

  it("stops passive output while paused but permits external extraction; old products can eject without production power", () => {
    const f = line();
    const source = f.buildings.find((b) => b.id === "source")!;
    source.configuration.enabled = false;
    expect(step(f).simulation.buildings.target.output).toEqual([]);
    node(f, "arm", "feeder", 3, 2, 90);
    node(f, "box", "chest", 3, 1);
    const next = step(f);
    expect(next.simulation.buildings.box.output).toEqual([
      { item: iron, count: 20 },
    ]);
    expect(next.simulation.buildings.target.output).toEqual([]);
    source.configuration.enabled = true;
    source.building_type = "m10";
    source.configuration.recipe_id = "r2001";
    expect(step(f).simulation.buildings.target.output).toEqual([
      { item: iron, count: 6 },
    ]);
  });

  it("reserves old source stock for explicit extractors first regardless of rotation and returns unused stock to auto output", () => {
    for (let tick = 0; tick < 6; tick++) {
      for (const amount of [1, 7, 25, 45]) {
        const f = line("chest", amount);
        f.simulation.tick = tick;
        node(f, "arm-down", "feeder", 3, 2, 90);
        node(f, "box-down", "chest", 3, 1);
        node(f, "arm-up", "feeder", 3, 4, 270);
        node(f, "box-up", "chest", 3, 5);
        const next = step(f);
        const receipts = next.simulation.transfers!.filter(
          (t) => t.source.id === "source",
        );
        const armCount = receipts
          .filter((t) => t.via)
          .reduce((sum, t) => sum + (t.count ?? 0), 0);
        expect(armCount).toBe(Math.min(amount, 40));
        expect(
          receipts
            .filter((t) => !t.via)
            .reduce((sum, t) => sum + (t.count ?? 0), 0),
        ).toBe(Math.min(6, Math.max(0, amount - 40)));
        expect(total(next, iron)).toBe(amount);
        expect(
          next.simulation.buildings.source.output.every((s) => s.count > 0),
        ).toBe(true);
      }
    }
  });

  it("shares destination reservations with another source so a belt never receives two loads", () => {
    for (let tick = 0; tick < 4; tick++) {
      const f = line("hand_belt");
      f.simulation.tick = tick;
      node(f, "other", "chest", 4, 5);
      node(f, "arm", "feeder", 4, 4, 90);
      f.simulation.buildings.other.output = [{ item: copper, count: 20 }];
      const next = transfer(f);
      expect(next.simulation.buildings.target.belt?.count).toBe(2);
      expect(
        next.simulation.transfers!.filter((t) => t.target.id === "target"),
      ).toHaveLength(1);
      expect(total(next, iron)).toBe(30);
      expect(total(next, copper)).toBe(20);
    }
  });

  it("does not forward newly received chest products in the same tick", () => {
    let f = line();
    node(f, "arm", "feeder", 5, 3);
    node(f, "far", "chest", 6, 3);
    f = step(f);
    expect(f.simulation.buildings.target.output).toEqual([
      { item: iron, count: 6 },
    ]);
    expect(f.simulation.buildings.far.output).toEqual([]);
    f = step(f);
    expect(f.simulation.buildings.target.output).toEqual([
      { item: iron, count: 6 },
    ]);
    expect(f.simulation.buildings.far.output).toEqual([
      { item: iron, count: 6 },
    ]);
    expect(total(f, iron)).toBe(30);
  });

  it("receives on a belt only after its complete old load can vacate in the same reservation plan", () => {
    const f = line("hand_belt");
    node(f, "far", "chest", 5, 3);
    f.simulation.buildings.target.belt = {
      id: "old",
      item: copper,
      count: 2,
      progress: 2,
    };
    const next = step(f);
    expect(next.simulation.buildings.far.output).toEqual([
      { item: copper, count: 2 },
    ]);
    expect(next.simulation.buildings.target.belt).toMatchObject({
      item: iron,
      count: 2,
      progress: 0,
    });
    expect(total(next, copper)).toBe(2);
    expect(total(next, iron)).toBe(30);
    f.buildings.find((b) => b.id === "far")!.building_type = "cable";
    node(f, "slow-arm", "item_output", 4, 2, 90);
    node(f, "slow-box", "chest", 4, 1);
    const partial = step(f);
    expect(partial.simulation.buildings.target.belt).toMatchObject({
      id: "old",
      item: copper,
      count: 1,
    });
    expect(partial.simulation.buildings.source.output).toEqual([
      { item: iron, count: 30 },
    ]);
    expect(total(partial, copper)).toBe(2);
  });

  it.each([
    [0, 6, 4],
    [0, 6, 3],
    [90, 4, 2],
    [90, 5, 2],
    [180, 3, 4],
    [180, 3, 3],
    [270, 4, 5],
    [270, 5, 5],
  ] as const)(
    "uses a large machine's real forward edge at %s toward %s,%s",
    (rotation, x, y) => {
      const f = createLocalFactory(user, "大机器");
      const source = node(f, "source", "m02", 4, 4, rotation, 2);
      source.configuration.auto_eject = true;
      node(f, "target", "chest", x, y);
      f.simulation.buildings.source.output = [{ item: iron, count: 20 }];
      const next = transfer(f);
      expect(next.simulation.buildings.target.output).toEqual([
        { item: iron, count: 6 },
      ]);
      expect(next.simulation.transfers).toHaveLength(1);
      expect(next.simulation.transfers![0].source).toMatchObject({
        x: Math.max(4, Math.min(5, x)),
        y: Math.min(4, Math.max(3, y)),
      });
      expect(total(next, iron)).toBe(20);
    },
  );

  it("shares a single batch across two forward cells and retries a free cell when the first belt cannot vacate", () => {
    for (let tick = 0; tick < 4; tick++) {
      const f = createLocalFactory(user, "大机器阻塞");
      const source = node(f, "source", "m02", 4, 4, 0, 2);
      source.configuration.auto_eject = true;
      node(f, "blocked", "hand_belt", 6, 4);
      node(f, "free", "chest", 6, 3);
      f.simulation.tick = tick;
      f.simulation.buildings.source.output = [{ item: iron, count: 20 }];
      f.simulation.buildings.blocked.belt = {
        id: "old",
        item: copper,
        count: 2,
        progress: 2,
      };
      const next = transfer(f);
      expect(next.simulation.buildings.free.output).toEqual([
        { item: iron, count: 6 },
      ]);
      expect(next.simulation.transfers).toHaveLength(1);
      expect(total(next, iron)).toBe(20);
      delete f.simulation.buildings.blocked.belt;
      const both = transfer(f);
      expect(both.simulation.transfers).toHaveLength(1);
      expect(both.simulation.transfers![0].count).toBeLessThanOrEqual(6);
    }
  });

  it("respects WH face filtering and overflow and records actual automated deliveries", () => {
    const f = createLocalFactory(user, "入仓");
    const source = node(f, "source", "m02", -2, 0, 0, 2);
    source.configuration.auto_eject = true;
    f.simulation.buildings.source.output = [{ item: iron, count: 20 }];
    const bus = f.buildings.find((b) => b.building_type === "bus")!;
    bus.configuration.face_180 = { mode: "closed", filter: "" };
    expect(transfer(f).simulation.warehouse[iron] ?? 0).toBe(0);
    bus.configuration.face_180 = { mode: "input", filter: copper };
    expect(transfer(f).simulation.warehouse[iron] ?? 0).toBe(0);
    bus.configuration.face_180 = { mode: "input", filter: iron };
    f.simulation.warehouse[iron] = Number.MAX_SAFE_INTEGER - 2;
    const next = transfer(f);
    expect(next.simulation.warehouse[iron]).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.simulation.buildings.source.output).toEqual([
      { item: iron, count: 18 },
    ]);
    expect(next.simulation.industry!.quests!.warehouse_received?.[iron]).toBe(
      2,
    );
    expect(transfer(next).simulation.buildings.source.output).toEqual([
      { item: iron, count: 18 },
    ]);
  });

  it("routes a large machine into a forward underground entry without replaying a tunnel transfer", () => {
    const f = createLocalFactory(user, "地下弹出");
    const source = node(f, "source", "m02", 2, 3, 0, 2);
    source.configuration.auto_eject = true;
    const entry = node(f, "entry", "underground_belt", 4, 2);
    const exit = node(f, "exit", "underground_belt", 8, 2);
    entry.configuration = {
      underground_role: "entry",
      underground_peer: "exit",
    };
    exit.configuration = {
      underground_role: "exit",
      underground_peer: "entry",
    };
    f.simulation.buildings.source.output = [{ item: iron, count: 20 }];
    const next = transfer(f);
    expect(next.simulation.buildings.exit.belt).toMatchObject({
      item: iron,
      count: 6,
      progress: 0,
    });
    expect(next.simulation.buildings.entry.belt).toBeUndefined();
    expect(next.simulation.transfers).toEqual([]);
    expect(total(next, iron)).toBe(20);
    entry.rotation = 90;
    expect(transfer(f).simulation.buildings.exit.belt).toBeUndefined();
  });

  it("keeps settings through move/rotation and save reload, invalidates receipts on switch changes and recovers every remaining item on demolition", () => {
    let f = line();
    const visuals = new LogisticsVisualStore(f);
    visuals.accept(f, 0, true);
    f = step(f);
    visuals.accept(f, 500, true);
    expect(visuals.getSnapshot()).toHaveLength(1);
    expect(visuals.getSnapshot()[0].transfer?.count).toBe(6);
    expect(f.simulation.transfers).toHaveLength(1);
    f = setEject(f, false);
    expect(f.simulation.transfers).toEqual([]);
    visuals.accept(f, 600, true);
    expect(visuals.getSnapshot()).toEqual([]);
    f = setEject(f, true);
    f = editFactory(f, {
      kind: "move",
      id: "source",
      placement: { x: 3, y: 4, rotation: 90 },
    });
    expect(autoEject(f.buildings.find((b) => b.id === "source")!)).toBe(true);
    f = validateSave(JSON.parse(JSON.stringify(toSave(f))), user.id);
    expect(autoEject(f.buildings.find((b) => b.id === "source")!)).toBe(true);
    const before = total(f, iron);
    f = editFactory(f, { kind: "delete", id: "source" });
    expect(total(f, iron)).toBe(before);
    expect(f.simulation.warehouse[buildingDefinitions.get("m02")!.item!]).toBe(
      1,
    );
    expect(f.simulation.transfers).toEqual([]);
  });
});
