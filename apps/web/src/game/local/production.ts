import type { BuildingInstance } from "../../api/client";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  selectedRecipe,
  recipeDefinitions,
} from "./catalog";
import { canAddAll, count } from "./inventory";
import { enabled } from "./transportConfig";
import { fuelAvailable, spendFuel } from "./fuel";
import { claimWork } from "./workLedger";
import { STEP_SECONDS } from "./simulationTime";

export function recipeAvailable(f: LocalFactory, id: string) {
  // Use the shared index, never infer a machine/recipe from its display name.
  const r = recipeDefinitions.get(id);
  return (
    !!r &&
    (r.tier ?? 1) <= (f.simulation.industry?.stage ?? 1) &&
    (!r.gate || !!f.simulation.industry?.milestones.includes(r.gate))
  );
}
export const workDemand = (b: BuildingInstance) =>
  selectedRecipe(b)?.power_kw ?? 0;
export function workKind(
  b: BuildingInstance,
): "shaft" | "hydraulic" | "electric" | undefined {
  if (b.building_type === "m21" && workDemand(b) > 0) return "hydraulic";
  const energy = buildingDefinitions.get(b.building_type)?.energy;
  return energy === "steam_or_hydraulic"
    ? "hydraulic"
    : energy === "shaft" || energy === "hydraulic" || energy === "electric"
      ? energy
      : undefined;
}
export function productionReady(f: LocalFactory, b: BuildingInstance): string {
  const r = selectedRecipe(b),
    m = f.simulation.buildings[b.id];
  if (!enabled(b)) return "disabled";
  if (!r) return "no_recipe";
  if (!recipeAvailable(f, r.id)) return "locked";
  if (Object.entries(r.inputs).some(([id, n]) => count(m.input, id) < n))
    return "no_input";
  if (!claimWork(f, r)) return "condition_required";
  const d = buildingDefinitions.get(b.building_type)!;
  if (
    !canAddAll(m.output, r.outputs, d.output_slots) ||
    Object.entries(r.outputs).some(
      ([id, n]) =>
        !Number.isSafeInteger((f.simulation.industry?.crafted[id] ?? 0) + n),
    )
  )
    return "output_full";
  return "working";
}
export function canProcess(
  f: LocalFactory,
  b: BuildingInstance,
  preview = false,
) {
  const ready = productionReady(f, b);
  if (ready !== "working") return ready;
  const m = f.simulation.buildings[b.id],
    d = buildingDefinitions.get(b.building_type)!,
    need = workDemand(b);
  if (!need) return "working";
  if (d.energy === "heat")
    return fuelAvailable(m, d) >= need * STEP_SECONDS ? "working" : "no_energy";
  if (!workKind(b)) return "working";
  const credit = m.work_energy_kj ?? 0;
  const energy = need * STEP_SECONDS;
  if (
    credit >= energy ||
    (d.energy === "steam_or_hydraulic" &&
      credit + fuelAvailable(m, d) >= energy) ||
    (preview && (m.supplied_kw ?? 0) >= need)
  )
    return "working";
  return "no_energy";
}
export function consumeWorkEnergy(f: LocalFactory, b: BuildingInstance) {
  const m = f.simulation.buildings[b.id],
    d = buildingDefinitions.get(b.building_type)!,
    need = workDemand(b) * STEP_SECONDS;
  if (d.energy === "heat") {
    if (!spendFuel(m, d, need)) return false;
    m.supplied_kw = need / STEP_SECONDS;
  } else if (workKind(b) && need) {
    const fromCredit = Math.min(need, m.work_energy_kj ?? 0),
      missing = need - fromCredit;
    if (
      missing &&
      (d.energy !== "steam_or_hydraulic" || !spendFuel(m, d, missing))
    )
      return false;
    m.work_energy_kj = (m.work_energy_kj ?? 0) - fromCredit;
    m.supplied_kw = (m.supplied_kw ?? 0) + missing / STEP_SECONDS;
  }
  m.powered = true;
  return true;
}
