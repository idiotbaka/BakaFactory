import { describe, expect, it } from "vitest";
import { clampWorkshopBatches, workshopDuration } from "./workshop";

describe("manual workshop modifiers", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [6, 3],
    [7, 3],
    [15, 7],
  ])("takes %i recipe seconds to %i manual ticks", (seconds, ticks) => {
    const recipe = { duration_ms: seconds * 1000 };
    expect(workshopDuration(recipe)).toBe(ticks);
    expect(recipe.duration_ms).toBe(seconds * 1000);
  });
  it("clamps only positive integer counts, leaves editable invalid values alone and supports an empty warehouse", () => {
    expect(clampWorkshopBatches("999", 2)).toBe("2");
    expect(clampWorkshopBatches("1e100", 100)).toBe("100");
    expect(clampWorkshopBatches("2", 0)).toBe("0");
    for (const raw of ["", "-1", "0", "1.5"])
      expect(clampWorkshopBatches(raw, 3)).toBe(raw);
  });
});
