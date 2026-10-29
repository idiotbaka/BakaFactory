import type { Robot } from "./local/robotRoutes";

export const robotMapNames: Readonly<Record<string, string>> = {
  i0108: "发条车",
  i0168: "液压车",
  i0169: "巡检机",
  i0226: "电运车",
  i0227: "分拣机",
  i0279: "高速机",
  i0280: "维修机",
  i0295: "高温机",
  i0341: "智能机",
};
export function robotMapStatus(r: Robot, paused = false): string {
  if (paused || !r.enabled) return "已暂停";
  if (r.returning && ["moving", "returning"].includes(r.status))
    return "返站中";
  if (r.status === "moving")
    return r.cargo ? "搬运中" : r.task ? "去取货" : "去作业";
  return (
    (
      {
        idle: "待命中",
        charged: "待命中",
        charging: "补能中",
        no_energy: "待补能",
        waiting_charge: "待充满",
        in_transit: "跨厂中",
        no_path: "无通路",
        congested: "等让路",
        loading: "取货中",
        unloading: "交货中",
        source_empty: "等库存",
        blocked: "等容量",
        rejected: "目标拒收",
        range_exceeded: "超出航程",
        returning: "返站中",
        inspecting: "巡检中",
        maintaining: "维修中",
        constructing: "施工中",
        paused: "已暂停",
      } as Record<string, string>
    )[r.status] ?? "作业中"
  );
}
