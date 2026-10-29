import { describe, expect, it } from "vitest";
import { catalog } from "./local/catalog";
import { robotStatuses } from "./local/robotFreight";
import type { Robot } from "./local/robotRoutes";
import { robotMapNames, robotMapStatus } from "./robotPresentation";

describe("compact robot map labels", () => {
  it("covers every model with at most three characters and every state with at most five", () => {
    for (const spec of catalog.robots!) {
      expect(robotMapNames[spec.item]).toBeTruthy();
      expect([...robotMapNames[spec.item]].length).toBeLessThanOrEqual(3);
    }
    for (const status of robotStatuses) {
      expect(
        [...robotMapStatus({ status, enabled: true } as Robot)].length,
      ).toBeLessThanOrEqual(5);
    }
  });
  it("distinguishes pickup, carrying, capacity waits and paused state", () => {
    const robot = {
      enabled: true,
      status: "moving",
      task: { phase: "pickup" },
    } as Robot;
    expect(robotMapStatus(robot)).toBe("去取货");
    expect(
      robotMapStatus({ ...robot, cargo: { item: "i0001", count: 1 } }),
    ).toBe("搬运中");
    expect(robotMapStatus({ ...robot, status: "blocked" })).toBe("等容量");
    expect(robotMapStatus(robot, true)).toBe("已暂停");
  });
});
