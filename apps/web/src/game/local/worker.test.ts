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
  it("requires a live permit for item grants and keeps failed grants atomic", () => {
    const item = "i0001";
    send({
      kind: "world",
      request: 1,
      action: { type: "developer_grant_item", item, count: 100 },
    });
    expect(post.mock.calls.at(-1)![0]).toMatchObject({
      kind: "error",
      request: 1,
      message: expect.stringContaining("暂停"),
    });
    send({ kind: "permit", enabled: true, validFor: 1000 });
    send({
      kind: "world",
      request: 2,
      action: { type: "developer_grant_item", item, count: 100 },
    });
    const granted = post.mock.calls.at(-1)![0] as Extract<
      WorkerEvent,
      { kind: "state" }
    >;
    expect(granted).toMatchObject({ kind: "state", request: 2 });
    expect(granted.root!.simulation.warehouse[item]).toBe(100);
    send({
      kind: "world",
      request: 3,
      action: { type: "developer_grant_item", item, count: -1 },
    });
    expect(post.mock.calls.at(-1)![0]).toMatchObject({
      kind: "error",
      request: 3,
    });
    send({
      kind: "world",
      request: 4,
      action: { type: "developer_grant_item", item, count: 1 },
    });
    const next = post.mock.calls.at(-1)![0] as typeof granted;
    expect(next.root!.simulation.warehouse[item]).toBe(101);
    expect(next.root!.revision).toBe(granted.root!.revision + 1);
    vi.advanceTimersByTime(1000);
    send({
      kind: "world",
      request: 5,
      action: { type: "developer_grant_item", item, count: 1 },
    });
    expect(post.mock.calls.at(-1)![0]).toMatchObject({
      kind: "error",
      request: 5,
      message: expect.stringContaining("暂停"),
    });
  });
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
  it.each([0, -1, 1, 1.5, 61, NaN, Infinity])(
    "rejects invalid TPS %s before enabling the timer",
    (tickRate) => {
      send({ kind: "permit", enabled: true, validFor: 30000, tickRate });
      expect(post.mock.calls.at(-1)![0]).toMatchObject({ kind: "error" });
      vi.advanceTimersByTime(1000);
      expect(ticks()).toHaveLength(0);
    },
  );
  it("runs exactly two ticks per second and never calculates while paused", () => {
    send({ kind: "permit", enabled: true, validFor: 30000 });
    vi.advanceTimersByTime(3000);
    expect(ticks()).toHaveLength(6);
    send({ kind: "permit", enabled: false, validFor: 0 });
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(ticks()).toHaveLength(6);
    send({ kind: "permit", enabled: true, validFor: 30000 });
    vi.advanceTimersByTime(1000);
    expect(ticks()).toHaveLength(8);
  });
  it("stops without another heartbeat even if the main thread cannot send a pause", () => {
    send({ kind: "permit", enabled: true, validFor: 3000 });
    vi.advanceTimersByTime(10000);
    expect(ticks()).toHaveLength(5);
  });
  it("does not replay missed ticks after a long event-loop stall", () => {
    send({ kind: "permit", enabled: true, validFor: 30000 });
    const now = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    // Execute the delayed wake once, rather than also executing the fresh
    // timer scheduled for the next half second after that wake.
    vi.advanceTimersByTime(500);
    expect(ticks()).toHaveLength(0);
    clock.mockReturnValue(now + 5500);
    vi.advanceTimersByTime(500);
    expect(ticks()).toHaveLength(1);
  });
});
