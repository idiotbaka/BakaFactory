import { describe, expect, it } from "vitest";
import type { Robot } from "./local/robotRoutes";
import { RobotVisuals } from "./robotVisuals";
import { robotSpriteURL, robotSpriteURLs } from "./robotSprites";
import { catalog } from "./local/catalog";

const robot = (x = 0, y = 0) =>
  ({ id: "r", item: "i0108", factory_id: "f", x, y, enabled: true }) as Robot;
const sync = (
  model: RobotVisuals,
  r: Robot,
  tick: number,
  now: number,
  revision = tick,
  paused = false,
  hidden = false,
  stepMs = 500,
) => model.sync([r], "f", tick, revision, stepMs, now, paused, hidden);

describe("confirmed robot walking visuals", () => {
  it("covers all nine models with three PNGs and mirrors a shared side image", () => {
    expect(robotSpriteURLs).toHaveLength(27);
    for (const spec of catalog.robots!) {
      expect(robotSpriteURL(spec.item, "right")).toBe(
        robotSpriteURL(spec.item, "left"),
      );
      expect(
        new Set(
          ["right", "up", "down"].map((d) =>
            robotSpriteURL(spec.item, d as "right" | "up" | "down"),
          ),
        ).size,
      ).toBe(3);
    }
  });
  it("interpolates a confirmed cell over one half-second without writing the robot", () => {
    const model = new RobotVisuals(),
      r = robot();
    sync(model, r, 1, 0);
    expect(model.sample("r", 250)).toMatchObject({ x: 0, y: 0, moving: false });
    const moved = robot(1);
    sync(model, moved, 2, 500);
    expect(model.sample("r", 750)).toMatchObject({
      x: 0.5,
      y: 0,
      moving: true,
      direction: "right",
    });
    expect(model.sample("r", 1000)).toMatchObject({ x: 1, moving: false });
    expect(moved).toEqual(robot(1));
    sync(model, robot(1, 1), 3, 1000);
    expect(model.sample("r", 1250)).toMatchObject({
      x: 1,
      y: 0.5,
      direction: "up",
    });
  });
  it("does not restart on duplicate snapshots, selection or same-tick non-positional edits", () => {
    const model = new RobotVisuals();
    sync(model, robot(), 1, 0);
    sync(model, robot(1), 2, 500);
    sync(model, robot(1), 2, 700);
    sync(model, robot(1), 2, 700, 3);
    expect(model.sample("r", 750)?.x).toBe(0.5);
  });
  it("stops painting stationary robots and freezes individual pause immediately", () => {
    const model = new RobotVisuals(),
      drawn: string[] = [];
    sync(model, robot(), 1, 0);
    expect(model.paint(0, (id) => drawn.push(id))).toBe(false);
    model.paint(100, (id) => drawn.push(id));
    expect(drawn).toEqual(["r"]);
    sync(model, robot(1), 2, 500);
    expect(model.paint(750, () => {})).toBe(true);
    sync(model, { ...robot(1), enabled: false }, 2, 750, 3);
    expect(model.paint(750, () => {})).toBe(false);
    expect(model.sample("r", 750)).toMatchObject({ x: 1, moving: false });
  });
  it("snaps edits, missed ticks, factory changes, pause/resume and background returns", () => {
    for (const mode of [
      "edit",
      "missed",
      "factory",
      "pause",
      "hidden",
      "settle",
    ] as const) {
      const model = new RobotVisuals();
      sync(model, robot(), 1, 0);
      if (mode === "settle") model.settle();
      if (mode === "factory")
        model.sync([robot(1)], "other", 2, 2, 500, 500, false, false);
      else
        sync(
          model,
          robot(1),
          mode === "edit" ? 1 : mode === "missed" ? 4 : 2,
          500,
          2,
          mode === "pause",
          mode === "hidden",
        );
      expect(model.sample("r", 600)).toMatchObject({ x: 1, moving: false });
      sync(model, robot(1), 2, 750);
      expect(model.sample("r", 800)).toMatchObject({ x: 1, moving: false });
    }
  });
  it("uses the developer scheduling interval while sampling independently of display FPS", () => {
    const model = new RobotVisuals();
    sync(model, robot(), 1, 0, 1, false, false, 100);
    sync(model, robot(-1), 2, 100, 2, false, false, 100);
    expect(model.sample("r", 150)).toMatchObject({
      x: -0.5,
      direction: "left",
    });
    expect(model.sample("r", 200)).toMatchObject({ x: -1, moving: false });
    sync(model, robot(-1), 2, 160, 3, false, false, 50);
    expect(model.sample("r", 165)).toMatchObject({ x: -1, moving: false });
    model.sync([], "f", 3, 3, 100, 200, false, false);
    expect(model.sample("r", 250)).toBeUndefined();
  });
});
