import { describe, expect, it } from "vitest";
import type { BuildingInstance } from "../../api/client";
import { catalog, itemID } from "./catalog";
import {
  createLocalFactory,
  editFactory,
  newMachine,
  toSave,
  validateSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import { pickupType } from "./warehouseIO";
import { validTransportConfig, warehouseOutputCount } from "./transportConfig";
import { count } from "./inventory";

const user = {
  id: "output-batch",
  username: "output-batch",
  display_name: "批量",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板"),
  copper = itemID("铜条"),
  water = itemID("净化水");
function start() {
  const f = createLocalFactory(user, "仓库输出");
  const p = f.simulation.industry!;
  p.stage = 6;
  const claimed = catalog
    .quests!.filter((q) => q.stage_final || q.id === "p2_crowded_hatch")
    .map((q) => q.id);
  p.quests!.completed = [...claimed];
  p.quests!.claimed = [...claimed];
  return f;
}
function node(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y = 0,
  configuration: BuildingInstance["configuration"] = {},
  rotation: BuildingInstance["rotation"] = 0,
) {
  const b = {
    id,
    factory_id: f.id,
    building_type: type,
    x,
    y,
    rotation,
    configuration,
  };
  f.buildings.push(b);
  f.simulation.buildings[id] = newMachine();
  return b;
}
function total(f: LocalFactory, id = iron) {
  return (
    (f.simulation.warehouse[id] ?? 0) +
    Object.values(f.simulation.buildings).reduce(
      (n, m) =>
        n +
        count(m.input, id) +
        count(m.output, id) +
        (m.belt?.item === id ? (m.belt.count ?? 1) : 0) +
        (m.fluid?.item === id ? m.fluid.count : 0),
      0,
    )
  );
}

describe("warehouse per-action output stack limits", () => {
  it("defaults old WH and terminal configurations to one and caps feeder pulls too", () => {
    for (const terminal of [false, true]) {
      let f = start();
      const source = terminal
        ? node(f, "pickup", pickupType, 3, 0, { output_items: [iron] })
        : f.buildings[0];
      if (!terminal)
        source.configuration.face_0 = { mode: "output", filter: iron };
      node(f, "feeder", "feeder", source.x + 1);
      node(f, "target", "chest", source.x + 2);
      f.simulation.warehouse[iron] = 30;
      expect(warehouseOutputCount(source, 0)).toBe(1);
      f = step(f);
      expect(count(f.simulation.buildings.target.output, iron)).toBe(1);
      expect(total(f)).toBe(30);
    }
  });
  it("enforces independent WH faces while reserving scarce stock across all outputs", () => {
    let f = start();
    f.buildings[0].configuration.face_0 = {
      mode: "output",
      filter: iron,
      output_count: 8,
    };
    f.buildings[0].configuration.face_180 = {
      mode: "output",
      filter: iron,
      output_count: 3,
    };
    node(f, "east", "chest", 1);
    node(f, "west", "chest", -1);
    f.simulation.warehouse[iron] = 10;
    const previous = structuredClone(f);
    f = step(f);
    expect(count(f.simulation.buildings.east.output, iron)).toBeLessThanOrEqual(
      8,
    );
    expect(count(f.simulation.buildings.west.output, iron)).toBeLessThanOrEqual(
      3,
    );
    expect(f.simulation.warehouse[iron]).toBe(0);
    expect(total(f)).toBe(10);
    expect(previous.simulation.warehouse[iron]).toBe(10);
  });
  it("uses configured terminal batches, partial capacity and original success cooldown / item rotation", () => {
    let f = start();
    node(f, "pickup", pickupType, 3, 0, {
      output_items: [iron, copper],
      output_count: 20,
    });
    node(f, "target", "chest", 4);
    f.simulation.warehouse = { [iron]: 50, [copper]: 30 };
    f.simulation.buildings.target.output = [{ item: iron, count: 93 }];
    f = step(f);
    expect(count(f.simulation.buildings.target.output, iron)).toBe(100);
    expect(f.simulation.warehouse[iron]).toBe(43);
    expect(f.simulation.buildings.pickup.terminal_cursor).toBe(1);
    const afterFirst = structuredClone(f.simulation.warehouse);
    f = step(f);
    expect(f.simulation.warehouse).toEqual(afterFirst);
    f = step(f);
    expect(count(f.simulation.buildings.target.output, copper)).toBe(20);
    expect(total(f, copper)).toBe(30);
    expect(total(f)).toBe(143);
  });
  it("limits stacks to belt capacity and available inventory, leaving rejected transfers untouched", () => {
    for (const [stock, target, expected] of [
      [25, "hand_belt", 2],
      [3, "chest", 3],
      [25, "chest", 0],
    ] as const) {
      let f = start();
      node(f, "pickup", pickupType, 3, 0, {
        output_items: [iron],
        output_count: 20,
      });
      node(f, "target", target, 4, 0, expected === 0 ? { filter: copper } : {});
      f.simulation.warehouse[iron] = stock;
      f = step(f);
      expect(stock - f.simulation.warehouse[iron]).toBe(expected);
      expect(total(f)).toBe(stock);
      if (!expected) expect(f.simulation.transfers).toEqual([]);
    }
  });
  it("caps feeder requests by both the WH face and arm batch size", () => {
    let f = start();
    f.buildings[0].configuration.face_0 = {
      mode: "output",
      filter: iron,
      output_count: 7,
    };
    node(f, "feeder", "feeder", 1);
    node(f, "target", "chest", 2);
    f.simulation.warehouse[iron] = 50;
    f = step(f);
    expect(count(f.simulation.buildings.target.output, iron)).toBe(7);
    expect(total(f)).toBe(50);
  });
  it("keeps WH fluid output on its original one-second cadence with per-face and pipe limits", () => {
    let f = start();
    f.buildings[0].configuration.face_0 = {
      mode: "output",
      filter: water,
      output_count: 20,
    };
    node(f, "pipe", "pipe", 1);
    f.simulation.warehouse[water] = 30;
    f = step(f);
    expect(f.simulation.buildings.pipe.fluid).toBeUndefined();
    f = step(f);
    const rate = catalog.buildings.find((b) => b.id === "pipe")!.fluid_rate!;
    expect(f.simulation.buildings.pipe.fluid?.count).toBe(Math.min(20, rate));
    expect(total(f, water)).toBe(30);
  });
  it("persists independent face counts across mode/item edits and full save validation", () => {
    let f = start();
    const id = f.buildings[0].id;
    f = editFactory(f, {
      kind: "industry",
      action: {
        type: "bus_face",
        id,
        rotation: 0,
        mode: "output",
        filter: iron,
        output_count: 20,
      },
    });
    f = editFactory(f, {
      kind: "industry",
      action: {
        type: "bus_face",
        id,
        rotation: 0,
        mode: "closed",
        filter: iron,
      },
    });
    f = editFactory(f, {
      kind: "industry",
      action: {
        type: "bus_face",
        id,
        rotation: 0,
        mode: "output",
        filter: copper,
      },
    });
    expect(warehouseOutputCount(f.buildings[0], 0)).toBe(20);
    expect(warehouseOutputCount(f.buildings[0], 180)).toBe(1);
    node(f, "pickup", pickupType, 3, 0, {
      output_items: [iron, copper],
      output_count: 4,
    });
    f.simulation.buildings.pickup.terminal_cursor = 1;
    f = editFactory(f, {
      kind: "industry",
      action: { type: "transport", id: "pickup", output_count: 12 },
    });
    const restored = validateSave(
      JSON.parse(JSON.stringify(toSave(f))),
      user.id,
    );
    expect(restored.buildings[0].configuration.face_0?.output_count).toBe(20);
    expect(
      restored.buildings.find((b) => b.id === "pickup")!.configuration
        .output_count,
    ).toBe(12);
    expect(restored.simulation.buildings.pickup.terminal_cursor).toBe(1);
  });
  it("rejects unsafe output counts atomically and forbids counts on unsupported facilities", () => {
    const f = start(),
      id = f.buildings[0].id;
    const before = structuredClone(f);
    for (const n of [0, 21, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        editFactory(f, {
          kind: "industry",
          action: {
            type: "bus_face",
            id,
            rotation: 0,
            mode: "output",
            filter: iron,
            output_count: n,
          },
        }),
      ).toThrow();
      expect(f).toEqual(before);
    }
    for (const value of [null, "20", false]) {
      const configuration: Record<string, unknown> = {
        output_items: [iron],
        output_count: value,
      };
      expect(
        validTransportConfig({ building_type: pickupType, configuration }),
      ).toBe(false);
      expect(
        validTransportConfig({
          building_type: "bus",
          configuration: {
            face_0: { mode: "output", filter: iron, output_count: value },
          } as unknown as BuildingInstance["configuration"],
        }),
      ).toBe(false);
    }
    expect(
      validTransportConfig({
        building_type: "chest",
        configuration: { output_count: 20 },
      }),
    ).toBe(false);
  });
});
