import { type LocalFactory } from "./state";
import {
  selectedRecipe,
  buildingDefinitions,
  isPort,
  isBelt,
  isChest,
  isFluidNode,
} from "./catalog";
import { canProcess, recordCraft, stepWorkshop } from "./industry";
import { add, remove } from "./inventory";
import { consumeWorkEnergy, workKind } from "./production";
import { allocatePower } from "./power";
import { advanceTransport, transferSolids } from "./logistics";
import { enabled } from "./transportConfig";
import { transferFluids } from "./fluids";
import { claimWork } from "./workLedger";
import { recordFactoryOutput, recordQuestEvent, syncQuests } from "./quests";

// Deterministic single-second transition, with no clock, DOM, network or disk.
// Production settles first; transport reads that stock, plans once and commits.
export function step(
  current: LocalFactory,
  workshop = true,
  sharedWarehouse?: Record<string, number>,
): LocalFactory {
  if (
    current.simulation.tick >= Number.MAX_SAFE_INTEGER ||
    current.revision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("游戏时间已达到上限");
  const { industry, warehouse, ...local } = current.simulation;
  const f: LocalFactory = {
    ...current,
    revision: current.revision + 1,
    simulation: {
      ...structuredClone(local),
      warehouse: sharedWarehouse ?? { ...warehouse },
      ...(industry
        ? { industry: workshop ? structuredClone(industry) : industry }
        : {}),
    },
  };
  const s = f.simulation;
  s.tick++;
  if (workshop) stepWorkshop(f);
  s.transfers = (s.transfers ?? []).filter((t) => t.tick >= s.tick - 2);
  const ordered = [...f.buildings].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  allocatePower(f, ordered);
  advanceTransport(f, ordered);
  for (const b of ordered) {
    if (
      b.building_type === "bus" ||
      isBelt(b.building_type) ||
      isPort(b.building_type) ||
      isChest(b.building_type) ||
      isFluidNode(b.building_type) ||
      buildingDefinitions.get(b.building_type)?.role === "source"
    )
      continue;
    const m = s.buildings[b.id],
      r = selectedRecipe(b);
    if (!enabled(b)) {
      m.status = "disabled";
      continue;
    }
    if (!r) {
      m.status =
        buildingDefinitions.get(b.building_type)?.role === "production"
          ? "no_recipe"
          : m.status;
      continue;
    }
    m.duration = r.duration_ms / 1000;
    m.status = canProcess(f, b);
    if (m.status !== "working") continue;
    if (!consumeWorkEnergy(f, b)) {
      m.status = "no_energy";
      continue;
    }
    m.progress++;
    if (m.progress >= m.duration) {
      if (!claimWork(f, r, true)) {
        m.status = "condition_required";
        continue;
      }
      const output = structuredClone(m.output);
      for (const item of Object.keys(r.outputs).sort())
        add(
          output,
          item,
          r.outputs[item],
          buildingDefinitions.get(b.building_type)?.output_slots,
        );
      for (const [item, n] of Object.entries(r.inputs))
        remove(m.input, item, n);
      m.output = output;
      m.progress = 0;
      m.batches_completed = Math.min(
        Number.MAX_SAFE_INTEGER,
        (m.batches_completed ?? 0) + 1,
      );
      recordCraft(f, r.outputs);
      recordFactoryOutput(f, r.outputs);
      if (workKind(b) === "shaft" && (r.power_kw ?? 0) > 0)
        recordQuestEvent(f, "shaft_craft");
    }
  }
  transferSolids(f, ordered);
  transferFluids(f, ordered);
  // Status describes the next interval, after confirmed logistics arrivals.
  for (const b of ordered) {
    const r = selectedRecipe(b),
      m = s.buildings[b.id];
    if (!r || !enabled(b)) continue;
    m.status = canProcess(f, b, true);
  }
  if (workshop) syncQuests(f);
  return f;
}
