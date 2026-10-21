import type { components } from "../../api/schema";
import type { FactoryDetail } from "../../api/client";
type Robot = components["schemas"]["RobotState"];
export const robotBusy = (r: Robot) =>
  !!(
    r.task ||
    r.service ||
    r.construction ||
    r.cargo ||
    r.transit ||
    r.returning
  );
export function requiredRobotZones(r: Robot): Set<string> {
  return new Set(
    [
      r.home_factory_id,
      r.factory_id,
      r.transit?.to_factory_id,
      r.task?.source.factory_id,
      r.task?.target.factory_id,
      r.service?.target.factory_id,
      r.construction?.factory_id,
    ].filter((id): id is string => typeof id === "string"),
  );
}
export function robotAtHome(r: Robot, f: FactoryDetail) {
  const station =
    f.id === r.home_factory_id &&
    f.buildings.find((b) => b.id === r.home_station);
  return (
    !!station &&
    !r.transit &&
    r.factory_id === f.id &&
    Math.abs(r.x - station.x) + Math.abs(r.y - station.y) === 1
  );
}
export const robotStatusNames: Record<string, string> = {
  idle: "待命",
  charging: "正在补能",
  paused: "机器人已暂停",
  charged: "能量充足",
  no_energy: "等待实际能源",
  moving: "逐格移动",
  in_transit: "跨区行程",
  no_path: "通路不可达",
  congested: "机器人占格等待",
  loading: "装货中",
  unloading: "卸货中",
  source_empty: "等待来源库存",
  blocked: "接收容量不足",
  rejected: "端口 / 物品拒收",
  waiting_charge: "等待归属站补满",
  range_exceeded: "路线超出储能范围",
  returning: "返站中",
  inspecting: "现场巡检",
  maintaining: "清理积压",
  constructing: "现场施工",
};
export function robotStateHint(r: Robot, paused = false): string {
  if (paused)
    return "世界已暂停；位置、携货、工时和过境余秒保留，恢复在线后继续。";
  if (!r.enabled)
    return r.returning
      ? "机器人已暂停；启用后继续实际返仓 / 返站。"
      : "机器人已暂停；启用后继续当前任务，自主派单开关不替代机器人启停。";
  if (r.returning) {
    const reason = {
      cancelled: "任务已取消",
      energy: "保留返程能量后中止作业",
      complete: "作业已完成",
      invalid_target: "目标已失效或现场已恢复",
    }[r.returning];
    const retained = r.service || (r.task && (r.task.repeat || !r.cargo));
    return `${reason}；${r.cargo ? "携货先送归属 WH，再回补能站" : "继续回归属补能站"}。${r.returning === "energy" && retained ? "保留的任务补满后可继续。" : "本次任务不会重新派发；智能自主调度启用时返站后可接新任务。"}`;
  }
  return (
    (
      {
        no_path:
          "保留物品与工时；检查建筑、蓝图、WH 邻格和工作点是否留有空地。",
        congested:
          "通路存在，当前被其他机器人占用；等待不耗行动能量，可调整站口和通道。",
        source_empty: "实际来源库存不足；保留已取货物，补货或取消任务。",
        blocked: "目标缓存 / 容器 / 仓库无法接收；腾空后继续，携货不会丢弃。",
        rejected: "检查物品白名单、配方、燃料用途及 WH 输入 / 输出面设置。",
        waiting_charge: "在归属补能站等待补满；需要真实供能和站内已付能量。",
        range_exceeded: "完整行程无法在储能范围内完成；调整路线或取消后改派。",
        no_energy: "需要真实补能；不会免费救援或瞬移货物。",
      } as Record<string, string>
    )[r.status] ?? "按确认的 1 秒游戏刻行动；路线预览不预留库存或保证未来通行。"
  );
}
