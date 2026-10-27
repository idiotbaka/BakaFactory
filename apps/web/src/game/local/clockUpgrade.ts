import type { LocalFactory } from "./state";
import { beltTicks } from "./catalog";
import { SIMULATION_TPS } from "./simulationTime";

// One development-era clock upgrade, on a clone. Inventories and second-based
// durations never change. Invalid values are left for the normal validator.
export function upgradeClock(factory: LocalFactory): LocalFactory {
  const next = structuredClone(factory);
  const scaleTick = (tick: number) =>
    Number.isSafeInteger(tick) && tick >= 0 ? tick * SIMULATION_TPS : tick;
  for (const f of [next, ...(next.districts ?? [])]) {
    const s = f.simulation;
    if (!s || s.tick_rate !== 1) continue;
    s.tick_rate = SIMULATION_TPS;
    s.tick = scaleTick(s.tick);
    if (Array.isArray(s.transfers)) s.transfers = [];
    for (const b of Array.isArray(f.buildings) ? f.buildings : []) {
      const m = s.buildings?.[b.id];
      if (!m) continue;
      if (m.incident) m.incident.since_tick = scaleTick(m.incident.since_tick);
      const oldDuration = b.building_type === "hand_belt" ? 3 : 1;
      if (
        m.belt &&
        Number.isInteger(m.belt.progress) &&
        m.belt.progress >= 0 &&
        m.belt.progress <= oldDuration
      )
        m.belt.progress = Math.floor(
          (m.belt.progress / oldDuration) * beltTicks(b.building_type),
        );
    }
    for (const receipt of s.industry?.work_receipts ?? [])
      receipt.last_tick = scaleTick(receipt.last_tick);
  }
  for (const r of next.robots ?? []) {
    if (r.service) r.service.since_tick = scaleTick(r.service.since_tick);
    if (r.autonomy) r.autonomy.next_tick = scaleTick(r.autonomy.next_tick);
    for (const log of r.behavior_log ?? []) log.tick = scaleTick(log.tick);
  }
  return next;
}
