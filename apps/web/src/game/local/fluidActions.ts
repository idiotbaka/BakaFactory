import type { LocalFactory } from "./state";
import { buildingDefinitions, isFluidNode } from "./catalog";
import { store } from "./inventory";
import { recordFluidReceipt } from "./quests";
import { acceptsFluid, type FluidTarget } from "./fluidConfig";
import {
  itemFilter,
  validTransportConfig,
  type Rotation,
} from "./transportConfig";

export type FluidAction =
  | {
      type: "fluid_config";
      id: string;
      enabled?: boolean;
      filter?: string;
      fluid_rate?: number;
      fluid_target?: FluidTarget;
      fluid_limit?: number;
      split_weights?: number[];
    }
  | { type: "fluid_branch"; id: string; rotation: Rotation; filter: string }
  | { type: "fill_fluid"; id: string; item: string; count: number }
  | { type: "drain_fluid"; id: string };
export function applyFluidAction(f: LocalFactory, action: FluidAction) {
  const b = f.buildings.find((b) => b.id === action.id);
  if (!b || !isFluidNode(b.building_type)) throw new Error("流体设施不存在");
  const m = f.simulation.buildings[b.id],
    d = buildingDefinitions.get(b.building_type)!;
  if (action.type === "fill_fluid") {
    if (
      !acceptsFluid(b.building_type, action.item) ||
      !Number.isSafeInteger(action.count) ||
      action.count < 1 ||
      action.count > 500
    )
      throw new Error("请存入该容器允许的流体，数量须为 1～500 整数");
    if (itemFilter(b) && itemFilter(b) !== action.item)
      throw new Error("流体过滤不接受该介质");
    if (m.fluid && m.fluid.item !== action.item)
      throw new Error("禁止混液，请先排回原流体");
    const n = (m.fluid?.count ?? 0) + action.count;
    if (n > (d.fluid_capacity ?? 0)) throw new Error("容器容量不足");
    store(f.simulation.warehouse, { [action.item]: -action.count });
    m.fluid = { item: action.item, count: n };
    recordFluidReceipt(f, b.building_type, action.item, action.count);
  } else if (action.type === "drain_fluid") {
    if (m.fluid)
      store(f.simulation.warehouse, { [m.fluid.item]: m.fluid.count });
    delete m.fluid;
  } else if (action.type === "fluid_branch") {
    if (d.role !== "valve") throw new Error("仅分液阀可配置分支");
    b.configuration[`branch_${action.rotation}`] = action.filter;
  } else {
    for (const key of [
      "enabled",
      "filter",
      "fluid_rate",
      "fluid_target",
      "fluid_limit",
      "split_weights",
    ] as const)
      if (action[key] !== undefined) b.configuration[key] = action[key];
  }
  if (!validTransportConfig(b))
    throw new Error("流体过滤、吞吐、目标或分配比例设置无效");
  m.flow_in = 0;
  m.flow_out = 0;
  if (d.role === "valve") m.fluid_cursor = 0;
  m.status =
    b.configuration.enabled === false
      ? "disabled"
      : m.fluid
        ? "fluid_stored"
        : "dry";
}
