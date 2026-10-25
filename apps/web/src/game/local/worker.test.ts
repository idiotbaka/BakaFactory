import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalFactory, editFactory } from "./state";
import type { WorkerCommand, WorkerEvent } from "./workerProtocol";
const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
let original: typeof self.onmessage;
const post = vi.fn();
function send(command: WorkerCommand) {
  self.onmessage!({ data: command } as MessageEvent);
}
function ticks() {
  return post.mock.calls
    .map((call) => call[0] as WorkerEvent)
    .filter((event) => event.kind === "delta");
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  original = self.onmessage;
  vi.stubGlobal("postMessage", post);
  await import("./simulation.worker");
  const factory = editFactory(createLocalFactory(user, "暂停"), {
    kind: "place",
    id: "miner",
    building_type: "miner",
    placement: { x: 1, y: 1, rotation: 0 },
  });
  send({ kind: "init", factory });
});
afterEach(() => {
  self.onmessage = original;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  post.mockReset();
});
describe("bounded local worker clock", () => {
  it("changes only the tick interval, replacing the pending timer when TPS changes", () => {
    send({ kind: "permit", enabled: true, validFor: 30000, tickRate: 4 });
    vi.advanceTimersByTime(1000);
    expect(ticks()).toHaveLength(4);
    send({ kind: "permit", enabled: true, validFor: 29000, tickRate: 2 });
    vi.advanceTimersByTime(499);
    expect(ticks()).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(ticks()).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(1);
    send({ kind: "permit", enabled: false, validFor: 0, tickRate: 2 });
    vi.advanceTimersByTime(10000);
    expect(ticks()).toHaveLength(5);
  });
  it("keeps heartbeat renewals from postponing ticks and expires permits in real time at high speed", () => {
    send({ kind: "permit", enabled: true, validFor: 1000, tickRate: 4 });
    vi.advanceTimersByTime(100);
    send({ kind: "permit", enabled: true, validFor: 900, tickRate: 4 });
    vi.advanceTimersByTime(150);
    expect(ticks()).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(ticks()).toHaveLength(3);
  });
  it("does not catch up after a stall at accelerated TPS", () => {
    send({ kind: "permit", enabled: true, validFor: 30000, tickRate: 10 });
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    vi.advanceTimersByTime(100);
    expect(ticks()).toHaveLength(0);
  });
  it.each([0, -1, 1.5, 61, NaN, Infinity])(
    "rejects invalid TPS %s before enabling the timer",
    (tickRate) => {
      send({ kind: "permit", enabled: true, validFor: 30000, tickRate });
      expect(post.mock.calls.at(-1)![0]).toMatchObject({ kind: "error" });
      vi.advanceTimersByTime(1000);
      expect(ticks()).toHaveLength(0);
    },
  );
  it("runs exactly one tick per second and never calculates while paused", () => {
    send({ kind: "permit", enabled: true, validFor: 30000 });
    vi.advanceTimersByTime(3000);
    expect(ticks()).toHaveLength(3);
    send({ kind: "permit", enabled: false, validFor: 0 });
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(ticks()).toHaveLength(3);
    send({ kind: "permit", enabled: true, validFor: 30000 });
    vi.advanceTimersByTime(1000);
    expect(ticks()).toHaveLength(4);
  });
  it("stops without another heartbeat even if the main thread cannot send a pause", () => {
    send({ kind: "permit", enabled: true, validFor: 3000 });
    vi.advanceTimersByTime(10000);
    expect(ticks()).toHaveLength(2);
  });
  it("does not replay missed ticks after a long event-loop stall", () => {
    send({ kind: "permit", enabled: true, validFor: 30000 });
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    vi.advanceTimersByTime(1000);
    expect(ticks()).toHaveLength(0);
  });
});
