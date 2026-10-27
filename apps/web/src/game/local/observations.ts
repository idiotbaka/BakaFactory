import { secondsToTicks } from "./simulationTime";
import type { LocalFactory } from "./state";
import { allDistricts } from "./world";
export type Observation = {
  ticks: number;
  produced: Record<string, number>;
  solid: number;
  fluid: number;
  freight: number;
};
export class Observations {
  private last?: { id: string; tick: number };
  private rows: Observation[] = [];
  clear() {
    this.rows = [];
    this.last = undefined;
  }
  record(before: LocalFactory, after: LocalFactory) {
    if (after.simulation.tick !== before.simulation.tick + 1) return;
    if (this.last?.id === after.id && this.last.tick === after.simulation.tick)
      return;
    if (
      this.last &&
      (this.last.id !== after.id || this.last.tick > after.simulation.tick)
    )
      this.clear();
    this.last = { id: after.id, tick: after.simulation.tick };
    const produced: Record<string, number> = {};
    for (const [id, n] of Object.entries(
      after.simulation.industry?.crafted ?? {},
    )) {
      const delta = n - (before.simulation.industry?.crafted[id] ?? 0);
      if (delta > 0) produced[id] = delta;
    }
    const rows = allDistricts(after),
      bots = new Map(
        (before.robots ?? []).map((r) => [r.id, r.completed_tasks ?? 0]),
      );
    this.rows.push({
      ticks: 1,
      produced,
      solid: rows.reduce(
        (n, f) =>
          n +
          (f.simulation.transfers ?? [])
            .filter((t) => t.tick === f.simulation.tick)
            .reduce((n, t) => n + (t.count ?? 1), 0),
        0,
      ),
      fluid: rows.reduce(
        (n, f) =>
          n +
          Object.values(f.simulation.buildings).reduce(
            (n, m) => n + (m.flow_out ?? 0),
            0,
          ),
        0,
      ),
      freight: (after.robots ?? []).reduce(
        (n, r) =>
          n + Math.max(0, (r.completed_tasks ?? 0) - (bots.get(r.id) ?? 0)),
        0,
      ),
    });
    this.rows = this.rows.slice(-secondsToTicks(60));
  }
  snapshot(): Observation {
    const result: Observation = {
      ticks: this.rows.length,
      produced: {},
      solid: 0,
      fluid: 0,
      freight: 0,
    };
    for (const row of this.rows) {
      for (const [id, n] of Object.entries(row.produced))
        result.produced[id] = (result.produced[id] ?? 0) + n;
      result.solid += row.solid;
      result.fluid += row.fluid;
      result.freight += row.freight;
    }
    return result;
  }
}
