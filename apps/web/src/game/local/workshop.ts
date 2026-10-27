import type { components } from "../../api/schema";
import { recipeDefinitions, buildingDefinitions, catalog } from "./catalog";
import { nextOrderInventory } from "./orderInventory";
import earlyMachineNames from "../earlyMachineNames.json";
type Industry = components["schemas"]["IndustryState"];
const names: Readonly<Record<string, { name: string; workshop: string }>> =
  earlyMachineNames;
export const workshopMachineName = (id: string) => names[id]?.workshop;

export const workshopMachines = [
  "m02",
  "m07",
  "m01",
  "m03",
  "m04",
  "m08",
] as const;

// Machine recipes keep their catalog duration. Only the shared manual queue
// gets the bonus, rounded down to complete one-second simulation ticks.
export const workshopDuration = (recipe: { duration_ms: number }) =>
  Math.max(1, Math.floor(recipe.duration_ms / 2000));

export function clampWorkshopBatches(raw: string, maximum: number) {
  const value = Number(raw);
  return raw.trim() !== "" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1
    ? String(Math.min(value, maximum))
    : raw;
}

// Extra manual workbench access is a permanent first-manufacture achievement;
// holding, installing or recovering an equipment item does not unlock it.
export function workshopMachineAvailable(
  crafted: Record<string, unknown> | undefined,
  machine: string,
) {
  if (catalog.starting_machines?.includes(machine)) return true;
  if (!["m03", "m04", "m08"].includes(machine)) return false;
  const item = buildingDefinitions.get(machine)?.item;
  const count = item ? crafted?.[item] : undefined;
  return typeof count === "number" && count >= 1;
}

export function workshopBatchLimit(
  recipe: { inputs: Record<string, number> },
  warehouse: Record<string, number>,
) {
  return Math.max(
    0,
    Math.min(
      100,
      ...Object.entries(recipe.inputs).map(([id, n]) =>
        Math.floor((warehouse[id] ?? 0) / n),
      ),
    ),
  );
}

export function validWorkshopCounts(job: Record<string, unknown>) {
  if (job.remaining === undefined && job.total === undefined) return true;
  return (
    Number.isInteger(job.remaining) &&
    Number.isInteger(job.total) &&
    (job.remaining as number) >= 1 &&
    (job.remaining as number) <= (job.total as number) &&
    (job.total as number) <= 100
  );
}

export function workshopOutputFits(
  p: Industry | undefined,
  warehouse: Record<string, number>,
) {
  const job = p?.workshop;
  if (!job) return true;
  const r = recipeDefinitions.get(job.recipe_id)!;
  if (job.order) {
    const next = nextOrderInventory(job.order, r);
    if (
      !next ||
      Object.entries(r.outputs).some(
        ([id, n]) => !Number.isSafeInteger((p?.crafted[id] ?? 0) + n),
      )
    )
      return false;
    const last =
      job.remaining === 1 &&
      job.order.step_index === job.order.steps.length - 1;
    return (
      !last ||
      Object.entries(next).every(([id, n]) =>
        Number.isSafeInteger((warehouse[id] ?? 0) + n),
      )
    );
  }
  return Object.entries(r.outputs).every(
    ([id, n]) =>
      Number.isSafeInteger((warehouse[id] ?? 0) + n) &&
      Number.isSafeInteger((p.crafted[id] ?? 0) + n),
  );
}
