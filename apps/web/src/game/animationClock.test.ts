import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationClock } from "./animationClock";
let now = 0,
  id = 0;
let callbacks: Map<number, FrameRequestCallback>;
beforeEach(() => {
  now = 0;
  id = 0;
  callbacks = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame(at: number) {
  now = at;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(at);
}
describe("shared visual clock", () => {
  it("samples the configured tick interval and keeps repeated accelerated ticks from rewinding", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 10, 250);
    now = 100;
    clock.sync("factory", 10, 250);
    expect(clock.frame()).toMatchObject({ phase: 0.4, stepMs: 250 });
    now = 400;
    expect(clock.frame().phase).toBe(1);
    clock.sync("factory", 10, 1000);
    now = 900;
    expect(clock.frame().phase).toBe(0.5);
    clock.dispose();
  });
  it("keeps the same tick clock across repeated polls and edits", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 10);
    now = 400;
    clock.sync("factory", 10);
    expect(clock.frame().phase).toBe(0.4);
    now = 800;
    clock.sync("factory", 10);
    expect(clock.frame().phase).toBe(0.8);
    clock.sync("factory", 11);
    expect(clock.frame().phase).toBe(0);
    now = 10000;
    expect(clock.frame().phase).toBe(1);
    clock.dispose();
  });
  it("shares one RAF and stops once all visuals finish", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 1);
    const phases: number[] = [];
    const first = clock.subscribe((value) => {
      phases.push(value.phase);
      return value.phase < 1;
    });
    const second = clock.subscribe((value) => value.phase < 1);
    expect(callbacks.size).toBe(1);
    frame(500);
    expect(phases.at(-1)).toBe(0.5);
    expect(callbacks.size).toBe(1);
    frame(1100);
    expect(phases.at(-1)).toBe(1);
    expect(callbacks.size).toBe(0);
    first();
    second();
    clock.dispose();
  });
  it("does not run continuous frames for inactive machines", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 1);
    clock.subscribe(() => false);
    frame(16);
    expect(callbacks.size).toBe(0);
    clock.sync("factory", 2);
    expect(callbacks.size).toBe(0);
    clock.dispose();
  });
  it("caps high-refresh rendering without changing the one-second clock", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 1);
    const phases: number[] = [];
    clock.subscribe((value) => {
      phases.push(value.phase);
      return value.phase < 1;
    });
    frame(7);
    frame(14);
    expect(phases).toEqual([0]);
    frame(21);
    expect(phases).toEqual([0, 0.021]);
    frame(1000);
    expect(phases.at(-1)).toBe(1);
    expect(callbacks.size).toBe(0);
    clock.dispose();
  });
  it("limits energy-saving paints while preserving duration and idle stopping", () => {
    const clock = new AnimationClock();
    clock.sync("factory", 1);
    clock.setPowerSaving(true);
    const phases: number[] = [];
    clock.subscribe((value) => {
      phases.push(value.phase);
      return value.phase < 1;
    });
    frame(16);
    const painted = phases.length;
    frame(32);
    frame(48);
    frame(64);
    expect(phases).toHaveLength(painted);
    frame(84);
    expect(phases.at(-1)).toBe(0.084);
    clock.setPowerSaving(false);
    frame(100);
    expect(phases.at(-1)).toBe(0.1);
    frame(1100);
    expect(phases.at(-1)).toBe(1);
    expect(callbacks.size).toBe(0);
    clock.dispose();
  });
});
