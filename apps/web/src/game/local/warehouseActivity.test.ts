import { describe, expect, it } from "vitest";
import {
  actWorld,
  createWorld,
  editWorld,
  projectFactory,
  stepWorld,
} from "./world";
import { newMachine, toSave, validateSave, type LocalFactory } from "./state";
import {
  bindWarehouse,
  captureWarehouse,
  warehouseAttempt,
  warehouseSummary,
  validWarehouseActivity,
} from "./warehouseActivity";
import { store } from "./inventory";
import { itemID } from "./catalog";
import { applyWorldFrame, worldFrame } from "./worldFrame";

const user = {
  id: "warehouse-history",
  username: "history",
  display_name: "统计",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板");
function advance(f: LocalFactory, n: number) {
  for (let i = 0; i < n; i++) f = stepWorld(f);
  return f;
}
function sample(f: LocalFactory, received: number, withdrawn = 0, id = f.id) {
  return captureWarehouse(f, () => {
    const next = structuredClone(f);
    bindWarehouse(next.simulation.warehouse, id);
    if (received) store(next.simulation.warehouse, { [iron]: received });
    if (withdrawn) store(next.simulation.warehouse, { [iron]: -withdrawn });
    return next;
  });
}

describe("persisted warehouse game-time window", () => {
  it("waits exactly 120 game ticks, merges edits, expires boundary buckets and preserves old snapshots", () => {
    let f = advance(createWorld(user, "一分钟"), 1);
    const previous = structuredClone(f);
    f = sample(sample(f, 25), 0, 12);
    expect(previous.warehouse_activity?.buckets).toEqual([]);
    expect(f.warehouse_activity!.buckets).toHaveLength(1);
    f = advance(f, 118);
    expect(
      warehouseSummary(f.warehouse_activity, f.simulation.tick).ready,
    ).toBe(false);
    f = stepWorld(f);
    expect(warehouseSummary(f.warehouse_activity, 120)).toMatchObject({
      ready: true,
      delta: { [iron]: 13 },
    });
    const snapshot = structuredClone(f);
    f = stepWorld(f);
    expect(f.warehouse_activity!.buckets).toEqual([]);
    expect(snapshot.warehouse_activity!.buckets).toHaveLength(1);
    expect(warehouseSummary(f.warehouse_activity, 121).delta).toEqual({});
  });
  it("records gross IO even when two factories cancel each other's net inventory change", () => {
    let f = stepWorld(createWorld(user, "双向"));
    const child = f.districts![0].id;
    f = sample(f, 9, 0, child);
    f = sample(f, 0, 9);
    expect(warehouseSummary(f.warehouse_activity, 1).delta).toEqual({});
    expect(
      warehouseSummary(f.warehouse_activity, 1, child).received[iron],
    ).toBe(9);
    expect(
      warehouseSummary(f.warehouse_activity, 1, f.id).withdrawn[iron],
    ).toBe(9);
    expect(f.districts![0].simulation.warehouse).toEqual({});
  });
  it("attributes child manual edits to the selected factory and commits only successful actions", () => {
    let f = createWorld(user, "编辑");
    const child = f.districts![0].id;
    f = actWorld(f, { type: "select_district", id: child });
    f = editWorld(f, { kind: "industry", action: { type: "scavenge" } });
    const trash = itemID("垃圾包");
    expect(
      f.warehouse_activity!.buckets[0].factories[child].received[trash],
    ).toBe(1);
    const previous = structuredClone(f);
    expect(() =>
      editWorld(f, {
        kind: "industry",
        action: { type: "workshop", recipe: "r1001" },
      }),
    ).toThrow();
    expect(f).toEqual(previous);
    expect(() => sample(f, 0, 1)).toThrow();
    expect(f).toEqual(previous);
  });
  it("discards speculative robot samples and rebinds a rolled back ledger", () => {
    const f = createWorld(user, "试探");
    const next = captureWarehouse(f, () => {
      const draft = structuredClone(f);
      bindWarehouse(draft.simulation.warehouse, draft.id);
      const backup = { ...draft.simulation.warehouse };
      expect(() =>
        warehouseAttempt(() => {
          store(draft.simulation.warehouse, { [iron]: 7 });
          throw new Error("proposal rejected");
        }),
      ).toThrow();
      draft.simulation.warehouse = backup;
      bindWarehouse(backup, draft.id);
      warehouseAttempt(() => store(backup, { [iron]: 3 }));
      return draft;
    });
    expect(
      next.warehouse_activity!.buckets[0].factories[next.id].received[iron],
    ).toBe(3);
    expect(next.warehouse_activity!.buckets[0].delta[iron]).toBe(3);
  });
  it("records WH and intake terminal deposits and pickup withdrawals in the actual district", () => {
    const f = createWorld(user, "物流");
    const child = f.districts![0];
    const nodes = [
      ["intake", "warehouse_intake", -5, -5, 0],
      ["belt", "hand_belt", -6, -5, 0],
      ["pickup", "warehouse_pickup", 3, 3, 0],
      ["target", "chest", 4, 3, 0],
      ["wh-belt", "hand_belt", -1, 0, 0],
    ] as const;
    for (const [id, building_type, x, y, rotation] of nodes) {
      child.buildings.push({
        id,
        factory_id: child.id,
        building_type,
        x,
        y,
        rotation,
        configuration:
          building_type === "warehouse_pickup" ? { output_items: [iron] } : {},
      });
      child.simulation.buildings[id] = newMachine();
    }
    for (const id of ["belt", "wh-belt"])
      child.simulation.buildings[id].belt = {
        id: `payload:${id}`,
        item: iron,
        count: 2,
        progress: 2,
      };
    f.simulation.warehouse[iron] = 3;
    const next = stepWorld(f);
    const flow = warehouseSummary(next.warehouse_activity, 1, child.id);
    expect(flow.received[iron]).toBe(4);
    expect(flow.withdrawn[iron]).toBe(1);
    expect(next.simulation.warehouse[iron]).toBe(6);
    const frame = structuredClone(worldFrame(f, next));
    expect(frame.warehouse_activity?.bucket?.tick).toBe(1);
    expect(applyWorldFrame(f, frame)).toEqual(next);
    expect(
      warehouseSummary(next.warehouse_activity, 1, next.id).received,
    ).toEqual({});
  });
  it("restores a complete history across saves, projection and incremental frames without replay", () => {
    let f = sample(advance(createWorld(user, "恢复"), 119), 25, 12);
    const restored = validateSave(
      JSON.parse(JSON.stringify(toSave(f))),
      user.id,
    );
    expect(restored.warehouse_activity).toEqual(f.warehouse_activity);
    expect(warehouseSummary(restored.warehouse_activity, 119).ready).toBe(
      false,
    );
    const next = stepWorld(restored);
    const frame = structuredClone(worldFrame(restored, next));
    expect(frame.warehouse_activity?.bucket).toBeUndefined();
    expect(applyWorldFrame(restored, frame)).toEqual(next);
    expect(warehouseSummary(next.warehouse_activity, 120).delta[iron]).toBe(13);
    f = actWorld(next, { type: "select_district", id: next.districts![0].id });
    expect(projectFactory(f).warehouse_activity).toEqual(f.warehouse_activity);
    expect(f.districts!.every((d) => d.warehouse_activity === undefined)).toBe(
      true,
    );
  });
  it("caps only extreme gross statistics without changing exact physical stock or net deltas", () => {
    const f = stepWorld(createWorld(user, "极端周转"));
    f.simulation.warehouse[iron] = 10;
    const amount = Number.MAX_SAFE_INTEGER - 10;
    const next = sample(sample(f, amount, amount), amount, amount);
    const summary = warehouseSummary(next.warehouse_activity, 1, f.id);
    expect(summary.received[iron]).toBe(Number.MAX_SAFE_INTEGER);
    expect(summary.withdrawn[iron]).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.simulation.warehouse[iron]).toBe(10);
    expect(warehouseSummary(next.warehouse_activity, 1).delta).toEqual({});
  });

  it("starts old saves at their current tick and rejects malformed or foreign history", () => {
    const f = createWorld(user, "旧档");
    f.simulation.tick = 500;
    f.districts!.forEach((d) => (d.simulation.tick = 500));
    const next = stepWorld(validateSave(toSave(f), user.id));
    expect(next.warehouse_activity!.started_tick).toBe(500);
    expect(warehouseSummary(next.warehouse_activity, 501).ready).toBe(false);
    const valid = {
      started_tick: 0,
      buckets: [
        {
          tick: 1,
          delta: { [iron]: -2 },
          factories: { [f.id]: { received: {}, withdrawn: { [iron]: 2 } } },
        },
      ],
    };
    const ids = new Set([f.id]);
    expect(validWarehouseActivity(valid, 120, ids)).toBe(true);
    for (const invalid of [
      null,
      { ...valid, started_tick: 121 },
      { ...valid, buckets: [valid.buckets[0], valid.buckets[0]] },
      { ...valid, buckets: [{ ...valid.buckets[0], tick: 0 }] },
      {
        ...valid,
        buckets: [
          {
            ...valid.buckets[0],
            factories: { missing: { received: {}, withdrawn: {} } },
          },
        ],
      },
      { ...valid, buckets: [{ ...valid.buckets[0], delta: { unknown: 1 } }] },
      { ...valid, buckets: [{ ...valid.buckets[0], delta: { [iron]: 0.5 } }] },
    ])
      expect(validWarehouseActivity(invalid, 120, ids)).toBe(false);
    const save = toSave(next);
    save.factory.districts![0].warehouse_activity = next.warehouse_activity;
    expect(() => validateSave(save, user.id)).toThrow();
  });
});
