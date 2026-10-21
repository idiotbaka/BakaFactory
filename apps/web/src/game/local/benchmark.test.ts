import { describe, it, expect } from "vitest";
import { benchmarkFixture, type BenchmarkOptions } from "./benchmark";
import { validateSave, toSave } from "./state";
describe("bounded reproducible measurement fixtures", () => {
  const options: BenchmarkOptions = {
    districts: 2,
    machines: 3,
    robots: 4,
    ticks: 2,
    warmup: 0,
    seed: 1,
    profile: "mixed",
  };
  it("creates real-format isolated factories, paid fixture robots and no duplicate occupied cells", () => {
    const a = benchmarkFixture(options),
      b = benchmarkFixture(options);
    expect(a).toEqual(b);
    expect(a.robots).toHaveLength(4);
    expect(() => validateSave(toSave(a), "benchmark")).not.toThrow();
  });
  it("rejects unbounded workload arguments rather than silently reducing an impossible robot population", () => {
    for (const change of [
      { districts: 101 },
      { machines: 81 },
      { robots: 501 },
      { districts: 1, robots: 50 },
      { seed: 0 },
    ])
      expect(() => benchmarkFixture({ ...options, ...change })).toThrow();
  });
});
