import { describe, expect, it } from "vitest";
import type {
  BuildingInstance,
  FactoryDetail,
  ItemTransfer,
  TransferEndpoint,
} from "../api/client";
import {
  beltEnds,
  LogisticsVisualStore,
  tileCenter,
  transferPath,
} from "./logisticsVisuals";

const source: TransferEndpoint = {
  id: "source",
  building_type: "m02",
  x: -2,
  y: 0,
  rotation: 0,
};
const out: TransferEndpoint = {
  id: "out",
  building_type: "feeder",
  x: -1,
  y: 0,
  rotation: 0,
};
const belt: TransferEndpoint = {
  id: "belt",
  building_type: "mechanical_belt",
  x: 0,
  y: 0,
  rotation: 0,
};
const input: TransferEndpoint = {
  id: "in",
  building_type: "feeder",
  x: 1,
  y: 0,
  rotation: 0,
};
const furnace: TransferEndpoint = {
  id: "furnace",
  building_type: "m05",
  x: 2,
  y: 0,
  rotation: 0,
};

it.each([
  [0, 12, 0],
  [90, 0, 12],
  [180, -12, 0],
  [270, 0, -12],
] as const)(
  "moves underground exit visuals toward the same screen edge as ground belts at %s degrees",
  (rotation, dx, dy) => {
    const ends = beltEnds(
      { ...belt, building_type: "underground_belt", rotation },
      21,
      21,
    );
    expect(ends.goal).toEqual({ x: ends.center.x + dx, y: ends.center.y + dy });
    expect(ends.entry).toEqual({
      x: ends.center.x - dx,
      y: ends.center.y - dy,
    });
    expect(ends).toEqual(
      beltEnds({ ...belt, building_type: "hand_belt", rotation }, 21, 21),
    );
  },
);
function event(
  tick: number,
  payload = "ore-1",
  terminal = false,
): ItemTransfer {
  return {
    id: `transfer-${tick}-${payload}`,
    tick,
    payload_id: payload,
    item: "i0002",
    source: terminal ? belt : source,
    via: terminal ? input : out,
    target: terminal ? furnace : belt,
  };
}
function snapshot(
  tick: number,
  payload?: string,
  transfers: ItemTransfer[] = [],
): FactoryDetail {
  return {
    id: "factory",
    owner_id: "owner",
    name: "Factory",
    width: 21,
    height: 21,
    created_at: "now",
    revision: tick,
    buildings: [source, out, belt, input, furnace].map((b) => ({
      ...b,
      factory_id: "factory",
      configuration: {},
    })) as BuildingInstance[],
    simulation: {
      tick,
      tick_rate: 1,
      warehouse: {},
      transfers,
      buildings: {
        belt: {
          input: [],
          output: [],
          status: payload ? "transporting" : "idle",
          progress: 0,
          duration: 0,
          cooldown: 0,
          belt: payload
            ? { id: payload, item: "i0002", progress: 0 }
            : undefined,
        },
      },
    },
  };
}

describe("confirmed logistics visuals", () => {
  it("cancels old receipts after filter edits without deleting the real payload", () => {
    const store = new LogisticsVisualStore(snapshot(0));
    store.accept(snapshot(0), 0, true);
    const next = snapshot(1, "ore-1", [event(1)]);
    store.accept(next, 1000, true);
    const epoch = store.getSnapshot()[0].epoch;
    const edited = structuredClone(next);
    edited.buildings.find((b) => b.id === "out")!.configuration.filter =
      "i0009";
    edited.simulation!.transfers = [];
    store.accept(edited, 1100, true);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].transfer).toBeUndefined();
    expect(store.getSnapshot()[0].epoch).not.toBe(epoch);
    expect(edited.simulation?.buildings.belt.belt?.id).toBe("ore-1");
  });
  it("ends a slow-belt incoming flight halfway through the cell and represents a batch with one icon", () => {
    const receipt = event(1);
    receipt.target = { ...receipt.target, building_type: "hand_belt" };
    receipt.count = 1;
    const path = transferPath(receipt, 21, 21),
      ends = beltEnds(receipt.target, 21, 21);
    expect(path.at(-1)).toEqual({
      x: ends.entry.x + (ends.goal.x - ends.entry.x) / 2,
      y: ends.entry.y,
    });
    const next = snapshot(1, "batch");
    next.buildings.find((b) => b.id === "belt")!.building_type =
      "electric_belt";
    next.simulation!.buildings.belt.belt!.count = 3;
    const store = new LogisticsVisualStore(next);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].belt?.payload.count).toBe(3);
    expect(store.getSnapshot()[0].belt?.moving).toBe(true);
  });
  it("does not replay initial history and keeps a single icon through both ports", () => {
    const store = new LogisticsVisualStore(snapshot(0));
    store.accept(snapshot(0), 0, true);
    const incoming = event(1);
    store.accept(snapshot(1, "ore-1", [incoming]), 1000, true);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].transfer).toEqual(incoming);
    // Completion can only remove a terminal flight, never a live belt item.
    store.finish("ore-1", incoming.id);
    expect(store.getSnapshot()).toHaveLength(1);
    store.accept(snapshot(1, "ore-1", [incoming]), 1100, true);
    expect(store.getSnapshot()[0].transfer?.id).toBe(incoming.id);
    const outgoing = event(2, "ore-1", true);
    const second = event(2, "ore-2");
    store.accept(
      snapshot(2, "ore-2", [incoming, outgoing, second]),
      2000,
      true,
    );
    expect(
      store
        .getSnapshot()
        .map((v) => v.id)
        .sort(),
    ).toEqual(["ore-1", "ore-2"]);
    const terminal = store.getSnapshot().find((v) => v.id === "ore-1")!;
    expect(terminal.belt).toBeUndefined();
    expect(terminal.transfer).toEqual(outgoing);
    expect(terminal.epoch).toBe(store.getSnapshot()[0].epoch);
    store.finish("ore-1", "outdated-event");
    expect(store.getSnapshot()).toHaveLength(2);
    store.finish("ore-1", outgoing.id);
    store.accept(snapshot(2, "ore-2", [outgoing, second]), 2100, true);
    expect(store.getSnapshot().map((v) => v.id)).toEqual(["ore-2"]);
  });

  it("suppresses old events on load, long gaps, background resume and factory changes", () => {
    const current = snapshot(1, "ore-1", [event(1)]);
    const store = new LogisticsVisualStore(current);
    expect(store.getSnapshot()[0].transfer).toBeUndefined();
    store.accept(current, 0, true);
    store.accept(snapshot(2, undefined, [event(2, "ore-1", true)]), 4000, true);
    expect(store.getSnapshot()).toEqual([]);
    store.accept(snapshot(3, "ore-2", [event(3, "ore-2")]), 5000, true);
    expect(store.getSnapshot()[0].transfer).toBeDefined();
    store.suspend();
    expect(store.getSnapshot()[0].transfer).toBeUndefined();
    store.accept(snapshot(4, undefined, [event(4, "ore-2", true)]), 5100, true);
    expect(store.getSnapshot()).toEqual([]);
    store.accept(snapshot(5, "ore-3", [event(5, "ore-3")]), 6100, true);
    store.accept(
      { ...snapshot(6, "ore-4", [event(6, "ore-4")]), id: "other" },
      6200,
      true,
    );
    expect(store.getSnapshot()[0].transfer).toBeUndefined();
  });

  it("preserves a confirmed input flight when a normal poll skips one tick", () => {
    const store = new LogisticsVisualStore(snapshot(1, "ore-1"));
    store.accept(snapshot(1, "ore-1"), 0, true);
    store.accept(
      snapshot(3, undefined, [event(1), event(2, "ore-1", true)]),
      2050,
      true,
    );
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0].transfer?.tick).toBe(2);
    store.finish("ore-1", event(2, "ore-1", true).id);
    store.accept(snapshot(3, undefined, [event(2, "ore-1", true)]), 2100, true);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("invalidates flights when a source, port or target moves or disappears", () => {
    for (const id of ["belt", "in", "furnace"]) {
      const store = new LogisticsVisualStore(snapshot(1, "ore-1"));
      store.accept(snapshot(1, "ore-1"), 0, true);
      const next = snapshot(2, undefined, [event(2, "ore-1", true)]);
      store.accept(next, 1000, true);
      expect(store.getSnapshot()).toHaveLength(1);
      store.accept(
        {
          ...next,
          buildings: next.buildings.map((b) =>
            b.id === id ? { ...b, y: 3 } : b,
          ),
        },
        1100,
        true,
      );
      expect(store.getSnapshot()).toEqual([]);
    }
    const store = new LogisticsVisualStore(snapshot(1));
    store.accept(snapshot(1), 0, true);
    const next = snapshot(2, "ore-2", [event(2, "ore-2")]);
    store.accept(next, 900, true);
    const epoch = store.getSnapshot()[0].epoch;
    next.buildings = next.buildings.filter((b) => b.id !== "out");
    store.accept(next, 1000, true);
    expect(store.getSnapshot()[0].transfer).toBeUndefined();
    expect(store.getSnapshot()[0].epoch).not.toBe(epoch);
    expect(next.simulation?.buildings.belt.belt?.id).toBe("ore-2");
  });

  it("routes four directions through the port then joins the target belt", () => {
    const directions = [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ];
    for (const [i, [dx, dy]] of directions.entries()) {
      const transfer = event(1);
      transfer.source = { ...source, x: -2 * dx, y: -2 * dy };
      const rotation = ([0, 90, 180, 270] as const)[i];
      const via = { ...out, x: -dx, y: -dy, rotation };
      transfer.via = via;
      transfer.target = { ...belt, rotation };
      const path = transferPath(transfer, 21, 21);
      expect(path[1]).toEqual(tileCenter(via, 21, 21));
      expect(path[2]).toEqual(tileCenter(transfer.target, 21, 21));
      expect(path.at(-1)).toEqual(beltEnds(transfer.target, 21, 21).goal);
    }
  });

  it("continues the drawn source position into a machine or directly into Bus", () => {
    const transfer = event(2, "ore-1", true);
    const start = { x: 324, y: 315 };
    const path = transferPath(transfer, 21, 21, start);
    expect(path[0]).toEqual(start);
    expect(path[1]).toEqual(tileCenter(input, 21, 21));
    expect(path.at(-1)).toEqual(tileCenter(furnace, 21, 21));
    const direct = {
      ...transfer,
      via: undefined,
      target: { ...furnace, building_type: "bus", x: 1 },
    };
    expect(transferPath(direct, 21, 21)).toEqual([
      beltEnds(belt, 21, 21).goal,
      { x: 333, y: 315 },
      { x: 345, y: 315 },
    ]);
  });
});
