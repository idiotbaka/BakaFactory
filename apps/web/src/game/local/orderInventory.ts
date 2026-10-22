import type { Catalog } from "../../api/client";
import type { components } from "../../api/schema";
import { store } from "./inventory";

export type WorkshopOrder = components["schemas"]["WorkshopOrder"];
export function nextOrderInventory(
  order: WorkshopOrder,
  recipe: Catalog["recipes"][number],
) {
  const inventory = { ...order.inventory };
  try {
    store(
      inventory,
      Object.fromEntries(
        Object.entries(recipe.inputs).map(([id, n]) => [id, -n]),
      ),
    );
    store(inventory, recipe.outputs);
    return inventory;
  } catch {
    return undefined;
  }
}
