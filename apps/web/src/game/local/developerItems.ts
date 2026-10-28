import { itemDefinitions } from "./catalog";

export function validateDeveloperItemGrant(item: string, count: number) {
  const definition = itemDefinitions.get(item);
  if (!definition) throw new Error("请选择当前目录中的物品");
  if (!Number.isSafeInteger(count) || count <= 0)
    throw new Error("物品数量必须为正安全整数");
}
