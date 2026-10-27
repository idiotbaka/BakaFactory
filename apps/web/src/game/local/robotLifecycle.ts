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
  no_energy: "等待补能",
  moving: "前往目标",
  in_transit: "跨区运输",
  no_path: "没有可走通道",
  congested: "通道被其他机器人占用",
  loading: "装货中",
  unloading: "卸货中",
  source_empty: "等待来源库存",
  blocked: "接收容量不足",
  rejected: "端口 / 物品拒收",
  waiting_charge: "等待补满能量",
  range_exceeded: "路线太长，能量不足",
  returning: "返站中",
  inspecting: "现场巡检",
  maintaining: "清理积压",
  constructing: "现场施工",
};
export function robotStateHint(r: Robot, paused = false): string {
  if (paused) return "世界已暂停；位置、携货和任务进度会保留，恢复在线后继续。";
  if (!r.enabled)
    return r.returning
      ? "机器人已暂停；启用后继续把物品送回仓库，再回补能站。"
      : "机器人已暂停；启用后继续当前任务。";
  if (r.returning) {
    const reason = {
      cancelled: "任务已取消",
      energy: "余电仅够返程，暂停手头任务先行回站",
      complete: "本趟作业已完成",
      invalid_target: "目标设备已变动或现场已恢复正常",
    }[r.returning];
    const retained = r.service || (r.task && (r.task.repeat || !r.cargo));
    return `${reason}；${r.cargo ? "会先把身上的物料交回归属厂 WH 仓库，再回补能站" : "正在返回归属补能站"}。${r.returning === "energy" && retained ? "等充满能量后会继续刚才的任务。" : "本趟任务到此结束；如果开启了智能自主调度，回站后会继续寻找新任务。"}`;
  }
  return (
    (
      {
        no_path:
          "找不到可走的通道。建筑、管线和施工位置都会占格，请给补能站和目标设备旁留出空地。",
        congested:
          "通道暂时被其他机器人占用，正在等待。经常拥堵时，可加宽站口和通道。",
        source_empty: "取货位置的物料不足。补充库存后会继续，也可以取消任务。",
        blocked:
          "目标位置装不下了。运走积压物料后会继续，机器人会保留手里的货。",
        rejected:
          "目标不接收这种物品。检查所选配方、原料 / 燃料用途和 WH 接口设置。",
        waiting_charge:
          "正在补能站等待充满。请检查站旁动力线路和动力源的燃料。",
        range_exceeded:
          "现有储能无法完成整条路线。请缩短路线，或换用储能更多的机型。",
        no_energy:
          "能量不足。请先检查归属补能站是否已接上动力，并为动力源补充燃料。",
        idle: "正在待命。可以在下方安排运输或现场作业。",
        charged: "能量充足，可以安排任务。",
        charging: "正在补能，充满后会继续已安排的任务。",
        moving: "正在沿通道前往目标设备。",
        loading: "正在取货，请等待装货完成。",
        unloading: "正在交货，请等待卸货完成。",
        in_transit: "正在前往另一厂区，抵达后继续任务。",
      } as Record<string, string>
    )[r.status] ?? "正在执行已安排的任务，当前位置和进度见下方。"
  );
}
