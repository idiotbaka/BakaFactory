import type { BuildingPlacement } from "../../api/client";
import type { LocalFactory } from "./state";
import { buildingDefinitions } from "./catalog";
import { rotations } from "./transportConfig";
export function validatePlacement(
  f: LocalFactory,
  type: string,
  id: string,
  p: BuildingPlacement,
) {
  const d = buildingDefinitions.get(type),
    stage = f.simulation.industry?.stage ?? 1;
  if (
    !Number.isInteger(p.x) ||
    !Number.isInteger(p.y) ||
    Math.abs(p.x) > 10 ||
    Math.abs(p.y) > 10 ||
    !rotations.includes(p.rotation as (typeof rotations)[number])
  )
    throw new Error("建筑坐标或方向无效");
  if (!d || d.fixed || f.buildings.some((b) => b.id === id))
    throw new Error("无法建造该模组");
  if (f.buildings.some((b) => b.x === p.x && b.y === p.y))
    throw new Error("目标格子已被占用");
  if ((d.tier ?? 1) > stage) throw new Error("该设备所属阶段尚未解锁");
  if (d.role === "source") {
    if (p.y !== 10) throw new Error("垃圾提取口必须安装在地图顶部垃圾堆");
    if (
      f.buildings.filter(
        (b) => buildingDefinitions.get(b.building_type)?.role === "source",
      ).length >= [1, 2, 4, 8, 12, 16][stage - 1]
    )
      throw new Error(
        `当前阶段最多安装 ${[1, 2, 4, 8, 12, 16][stage - 1]} 个垃圾提取口`,
      );
  }
  return d;
}
