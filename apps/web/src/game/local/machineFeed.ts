import { count, type Inventory } from "./inventory";

// Target complete batches, including material already inside the machine.
// Bound warehouse contributions before addition to keep arithmetic small even
// when a player's warehouse is near the maximum safe integer.
export function machineBatchLimit(
  recipe: { inputs: Record<string, number> },
  input: Inventory,
  warehouse: Record<string, number>,
  slots = 12,
  stackLimit = 100,
) {
  const ingredients = Object.entries(recipe.inputs);
  if (!ingredients.length) return 0;
  const existing = new Set(input.map((stack) => stack.item));
  if (
    input.length + ingredients.filter(([id]) => !existing.has(id)).length >
    slots
  )
    return 0;
  const capacity = Math.min(100, stackLimit);
  return Math.max(
    0,
    Math.min(
      ...ingredients.map(([id, required]) => {
        const current = count(input, id);
        const available = Math.min(
          warehouse[id] ?? 0,
          Math.max(0, capacity - current),
        );
        return Math.floor(Math.min(capacity, current + available) / required);
      }),
    ),
  );
}

export const validFeedBatches = (batches: number) =>
  Number.isFinite(batches) && Number.isInteger(batches) && batches >= 1;
