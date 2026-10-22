import { describe, expect, it } from "vitest";
import { machineBatchLimit } from "./machineFeed";

describe("machine refill capacity", () => {
  it("includes existing stock, limits the scarcest ingredient and never counts another slot for the same item", () => {
    const recipe = { inputs: { iron: 3, copper: 2 } };
    const input = [{ item: "iron", count: 8 }];
    expect(machineBatchLimit(recipe, input, { iron: 4, copper: 100 }, 2)).toBe(
      4,
    );
    expect(
      machineBatchLimit(recipe, input, { iron: 1000, copper: 1000 }, 2),
    ).toBe(33);
    expect(input).toEqual([{ item: "iron", count: 8 }]);
  });

  it("reserves slots for all recipe inputs while retaining leftovers from other recipes", () => {
    const input = [
      { item: "old", count: 7 },
      { item: "iron", count: 8 },
    ];
    const recipe = { inputs: { iron: 3, copper: 2 } };
    expect(
      machineBatchLimit(recipe, input, { iron: 100, copper: 100 }, 2),
    ).toBe(0);
    expect(
      machineBatchLimit(recipe, input, { iron: 100, copper: 100 }, 4),
    ).toBe(33);
    expect(
      machineBatchLimit({ inputs: { iron: 101 } }, [], { iron: 1000 }),
    ).toBe(0);
    expect(machineBatchLimit({ inputs: {} }, [], {})).toBe(0);
  });

  it("bounds very large warehouse values before addition and honors a smaller defined stack limit", () => {
    const recipe = { inputs: { iron: 2, copper: 3 } };
    const input = [
      { item: "iron", count: 99 },
      { item: "copper", count: 100 },
    ];
    const warehouse = {
      iron: Number.MAX_SAFE_INTEGER,
      copper: Number.MAX_SAFE_INTEGER,
    };
    expect(machineBatchLimit(recipe, input, warehouse)).toBe(33);
    expect(machineBatchLimit(recipe, [], warehouse, 4, 60)).toBe(20);
  });
});
