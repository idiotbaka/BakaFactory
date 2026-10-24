import { describe, expect, it, vi } from "vitest";
import { AssetPreloader, type GameAsset } from "./assetPreloader";

const image = (url: string): GameAsset => ({ kind: "image", url });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("game resource queue", () => {
  it("deduplicates URLs and bounds requests while counting real completions", async () => {
    const gate = deferred();
    let active = 0,
      peak = 0;
    const load = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      return {};
    });
    const queue = new AssetPreloader(
      ["a", "b", "a", "c", "d"].map(image),
      load,
      2,
    );
    const counts: number[] = [];
    queue.subscribe(() => counts.push(queue.getSnapshot().completed));
    const first = queue.start();
    expect(queue.start()).toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot()).toEqual({
      phase: "loading",
      total: 4,
      completed: 0,
      failed: 0,
    });
    gate.resolve();
    await first;
    expect(peak).toBe(2);
    expect(load).toHaveBeenCalledTimes(4);
    expect(counts).toContain(1);
    expect(counts).toContain(3);
    expect(queue.getSnapshot()).toEqual({
      phase: "ready",
      total: 4,
      completed: 4,
      failed: 0,
    });
    await queue.start();
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("blocks readiness on failure and retries only unfinished resources", async () => {
    let fail = true;
    const load = vi.fn(async (asset: GameAsset) => {
      if (asset.url === "font" && fail) throw new Error("network");
      return { url: asset.url };
    });
    const queue = new AssetPreloader(
      [{ url: "font", kind: "font" }, image("a"), image("b")],
      load,
    );
    await queue.start();
    expect(queue.getSnapshot()).toEqual({
      phase: "failed",
      total: 3,
      completed: 2,
      failed: 1,
    });
    fail = false;
    const retry = queue.start();
    expect(queue.getSnapshot().completed).toBe(2);
    await retry;
    expect(load.mock.calls.map(([asset]) => asset.url)).toEqual([
      "font",
      "a",
      "b",
      "font",
    ]);
    expect(queue.getSnapshot()).toEqual({
      phase: "ready",
      total: 3,
      completed: 3,
      failed: 0,
    });
  });
});
