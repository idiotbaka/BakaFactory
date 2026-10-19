import { describe, expect, it } from "vitest";
import type { MachineState } from "../api/client";
import { productionProgress, sampleMotion } from "./animationMath";
const machine: MachineState = {
  input: [],
  output: [],
  progress: 2,
  duration: 4,
  cooldown: 0,
  status: "working",
};
describe("client-only bounded visual prediction", () => {
  it("draws fractional seconds without advancing more than one confirmed interval", () => {
    expect(productionProgress(machine, 0.5)).toBe(2.5);
    expect(productionProgress(machine, 5)).toBe(3);
    expect(productionProgress(machine, -1)).toBe(2);
    expect(productionProgress({ ...machine, progress: 3 }, 1)).toBe(4);
    expect(machine.progress).toBe(2);
    expect(machine.output).toEqual([]);
  });
  it("holds blocked and starved machines rather than predicting new work", () => {
    for (const status of ["no_input", "output_full", "idle"])
      expect(productionProgress({ ...machine, status }, 0.8)).toBe(2);
  });
  it("interpolates turns along the route and clamps stalled or resumed frames", () => {
    const motion = {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
      ],
      startedAt: 100,
      duration: 1000,
    };
    expect(sampleMotion(motion, 350)).toEqual({ x: 15, y: 0 });
    expect(sampleMotion(motion, 850)).toEqual({ x: 30, y: 15 });
    expect(sampleMotion(motion, 5000)).toEqual({ x: 30, y: 30 });
    expect(sampleMotion(motion, 0)).toEqual({ x: 0, y: 0 });
    expect(
      sampleMotion(
        {
          ...motion,
          points: [
            { x: 10, y: 10 },
            { x: 10, y: 10 },
          ],
          duration: 0,
        },
        100,
      ),
    ).toEqual({ x: 10, y: 10 });
  });
});
