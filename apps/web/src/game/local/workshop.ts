import type { components } from "../../api/schema";
import { recipeDefinitions, buildingDefinitions, catalog } from "./catalog";
type Industry = components["schemas"]["IndustryState"];

export const workshopMachines = [
  "m02",
  "m07",
  "m01",
  "m03",
  "m04",
  "m08",
] as const;

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
  return Object.entries(r.outputs).every(
    ([id, n]) =>
      Number.isSafeInteger((warehouse[id] ?? 0) + n) &&
      Number.isSafeInteger((p.crafted[id] ?? 0) + n),
  );
}
