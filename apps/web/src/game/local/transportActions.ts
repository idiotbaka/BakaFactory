import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  isChest,
  isFluid,
  itemDefinitions,
} from "./catalog";
import { add, store } from "./inventory";
import {
  isSolidTransport,
  validTransportConfig,
  itemFilter,
  face,
  type FaceMode,
  type Rotation,
} from "./transportConfig";

export type TransportAction =
  | {
      type: "transport";
      id: string;
      filter?: string;
      interval?: number;
      channel?: "input" | "fuel";
      enabled?: boolean;
      output_items?: string[];
      output_count?: number;
    }
  | {
      type: "bus_face";
      id: string;
      rotation: Rotation;
      mode: FaceMode;
      filter: string;
      output_count?: number;
    }
  | { type: "branch"; id: string; rotation: Rotation; filter: string }
  | { type: "deposit"; id: string; item: string; count: number };

export function applyTransportAction(f: LocalFactory, action: TransportAction) {
  const b = f.buildings.find((b) => b.id === action.id);
  if (!b) throw new Error("物流设施不存在");
  const d = buildingDefinitions.get(b.building_type)!,
    m = f.simulation.buildings[b.id];
  if (action.type === "deposit") {
    if (
      !isChest(b.building_type) ||
      !itemDefinitions.has(action.item) ||
      isFluid(action.item) ||
      !Number.isSafeInteger(action.count) ||
      action.count < 1 ||
      action.count > 100
    )
      throw new Error("箱子只能装入 1～100 个固体物品");
    if (itemFilter(b) && itemFilter(b) !== action.item)
      throw new Error("箱子的输入过滤不接受该物品");
    if (!add(m.output, action.item, action.count, d.output_slots))
      throw new Error("箱子已满");
    store(f.simulation.warehouse, { [action.item]: -action.count });
    return;
  }
  if (action.type === "transport") {
    if (!isSolidTransport(b.building_type))
      throw new Error("该设备不是固体物流设施");
    for (const key of [
      "filter",
      "interval",
      "channel",
      "enabled",
      "output_items",
    ] as const)
      if (action[key] !== undefined) b.configuration[key] = action[key];
    if (action.output_count !== undefined)
      b.configuration.output_count = action.output_count;
    if (action.output_items !== undefined) m.terminal_cursor = 0;
    if (action.enabled !== undefined)
      m.status = action.enabled ? "idle" : "disabled";
    if (action.filter && isFluid(action.filter))
      throw new Error("散装流体请使用管道和储罐");
  } else if (action.type === "bus_face") {
    if (b.building_type !== "bus") throw new Error("仅工厂仓库可配置各面");
    const outputCount =
      action.output_count !== undefined
        ? action.output_count
        : face(b, action.rotation).output_count;
    b.configuration[`face_${action.rotation}`] = {
      mode: action.mode,
      filter: action.filter,
      ...(outputCount !== undefined ? { output_count: outputCount } : {}),
    };
  } else {
    if (d.role !== "splitter") throw new Error("仅分流器可配置分支");
    if (action.filter && isFluid(action.filter))
      throw new Error("分流器不运输散装流体");
    b.configuration[`branch_${action.rotation}`] = action.filter;
  }
  if (!validTransportConfig(b))
    throw new Error("过滤物品、方向、速率或仓库面设置无效；输出面必须指定物品");
  // No gameplay inventory is affected by a route edit. Cancel its old cosmetic
  // receipts so they cannot depict successful deliveries after reconfiguration.
  f.simulation.transfers = (f.simulation.transfers ?? []).filter(
    (t) => t.source.id !== b.id && t.target.id !== b.id && t.via?.id !== b.id,
  );
}
