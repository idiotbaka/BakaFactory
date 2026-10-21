import type { LocalFactory } from "./state";
import { buildingDefinitions, itemID } from "./catalog";
import { store } from "./inventory";
import { validTransportConfig } from "./transportConfig";

export type UtilityAction =
  | {
      type: "power_config";
      id: string;
      enabled?: boolean;
      priority?: number;
      power_side?: number;
      battery_mode?: "auto" | "charge" | "discharge" | "hold";
      reserve_kj?: number;
    }
  | { type: "prime"; id: string; count: number }
  | { type: "drain_medium"; id: string };
export function applyUtilityAction(f: LocalFactory, action: UtilityAction) {
  const b = f.buildings.find((b) => b.id === action.id);
  if (!b) throw new Error("能源设备不存在");
  const m = f.simulation.buildings[b.id],
    d = buildingDefinitions.get(b.building_type)!;
  if (action.type === "power_config") {
    for (const key of [
      "enabled",
      "priority",
      "power_side",
      "battery_mode",
      "reserve_kj",
    ] as const)
      if (action[key] !== undefined) b.configuration[key] = action[key];
    if (!validTransportConfig(b))
      throw new Error("能源优先级、连接方向或储能设置无效");
    m.powered = false;
    m.status = b.configuration.enabled === false ? "disabled" : "idle";
  } else {
    if (d.id !== "m21") throw new Error("仅液压动力站需要启动工作液");
    const id = itemID("液压工作液");
    if (action.type === "prime") {
      if (
        !Number.isSafeInteger(action.count) ||
        action.count < 1 ||
        (m.medium ?? 0) + action.count > 10
      )
        throw new Error("工作液容量 10，数量必须是正整数");
      store(f.simulation.warehouse, { [id]: -action.count });
      m.medium = (m.medium ?? 0) + action.count;
    } else {
      store(f.simulation.warehouse, { [id]: m.medium ?? 0 });
      m.medium = 0;
    }
  }
}
