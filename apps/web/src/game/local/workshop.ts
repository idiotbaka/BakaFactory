import type { components } from "../../api/schema";
import { recipeDefinitions } from "./catalog";
type Industry = components["schemas"]["IndustryState"];

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
