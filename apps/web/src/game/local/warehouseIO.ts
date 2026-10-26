import type { BuildingInstance, FactoryDetail } from "../../api/client";
import { catalog, itemID } from "./catalog";

export const ioQuestID = "p2_crowded_hatch";
export const pickupType = "warehouse_pickup";
export const intakeType = "warehouse_intake";
export const isWarehouseTerminal = (type: string) =>
  type === pickupType || type === intakeType;
export const ioUnlocked = (p: FactoryDetail["simulation"]) =>
  p?.industry?.quests?.claimed.includes(ioQuestID) ?? false;
export const ioLimit = (stage: number, type: string) =>
  stage < 2 ? 0 : Math.min(3, stage - 1) * (type === pickupType ? 2 : 1);
export const ioCost = (stage: number, type: string) => {
  const names =
    type === pickupType
      ? ["基础铁板", "标准钢板", "高强钢板"]
      : ["铜条", "工业钢板", "导热合金锭"];
  return { [itemID(names[Math.max(0, Math.min(2, stage - 2))])]: -30 };
};
export const terminalItems = (b: BuildingInstance): string[] =>
  Array.isArray(b.configuration.output_items)
    ? (b.configuration.output_items as string[])
    : [catalog.root_item!];
