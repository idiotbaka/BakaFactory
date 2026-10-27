import { validSize, inBounds, overlaps } from "../footprint";
import type { BuildingPlacement } from "../../api/client";
import type { LocalFactory } from "./state";
import { buildingDefinitions } from "./catalog";
import { rotations } from "./transportConfig";
import { isWarehouseTerminal } from "./warehouseIO";
import { undergroundType } from "./underground";
export function validatePlacement(
  f: LocalFactory,
  type: string,
  id: string,
  p: BuildingPlacement,
  paired = false,
) {
  const d = buildingDefinitions.get(type),
    stage = f.simulation.industry?.stage ?? 1;
  if (
    !Number.isInteger(p.x) ||
    !Number.isInteger(p.y) ||
    !inBounds(p) ||
    !rotations.includes(p.rotation as (typeof rotations)[number])
  )
    throw new Error("建筑坐标或方向无效");
  if (
    !d ||
    d.fixed ||
    isWarehouseTerminal(type) ||
    (type === undergroundType && !paired) ||
    f.buildings.some((b) => b.id === id)
  )
    throw new Error("无法建造该模组");
  if (!validSize(d, p.size)) throw new Error("该机器不支持此占地尺寸");
  if (f.buildings.some((b) => overlaps(b, p)))
    throw new Error("目标格子已被占用");
  if ((d.tier ?? 1) > stage) throw new Error("该设备所属阶段尚未解锁");
  if (d.role === "source" && p.y !== 10)
    throw new Error("垃圾提取口必须安装在地图顶部垃圾堆");
  return d;
}
