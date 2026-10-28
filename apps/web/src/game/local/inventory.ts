import type { MachineState } from "../../api/client";
import { recordWarehouseChange } from "./warehouseActivity";
export type Inventory = MachineState["input"];
export const count = (inv: Inventory, item: string) =>
  inv.find((s) => s.item === item)?.count ?? 0;
export function canAddAll(
  inv: Inventory,
  values: Record<string, number>,
  slots = 12,
) {
  const existing = new Map(inv.map((s) => [s.item, s.count]));
  let used = inv.length;
  for (const [id, n] of Object.entries(values)) {
    if ((existing.get(id) ?? 0) + n > 100) return false;
    if (!existing.has(id)) used++;
  }
  return used <= slots;
}
export function add(inv: Inventory, item: string, n = 1, slots = 12) {
  const stack = inv.find((s) => s.item === item);
  if (
    !Number.isSafeInteger(n) ||
    n <= 0 ||
    (stack ? stack.count + n > 100 : inv.length >= slots || n > 100)
  )
    return false;
  if (stack) stack.count += n;
  else inv.push({ item, count: n });
  return true;
}
export function remove(inv: Inventory, item: string, n = 1) {
  const i = inv.findIndex((s) => s.item === item);
  if (i < 0 || inv[i].count < n) throw new Error("物品数量不足");
  inv[i].count -= n;
  if (!inv[i].count) inv.splice(i, 1);
}
export function store(
  warehouse: Record<string, number>,
  values: Record<string, number>,
  factory?: string,
) {
  for (const [id, n] of Object.entries(values)) {
    const value = (warehouse[id] ?? 0) + n;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("仓库数量不足或超出上限");
    warehouse[id] = value;
    recordWarehouseChange(warehouse, id, n, factory);
  }
}
