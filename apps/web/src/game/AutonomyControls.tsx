import type { components } from "../api/schema";
import type { WorldAction } from "./local/world";
type Robot = components["schemas"]["RobotState"];
const kinds: Record<string, string> = {
  configured: "配置",
  refill: "补料派单",
  inspect: "巡检派单",
  maintain: "维护派单",
  waiting: "等待目标",
  construct: "施工派单",
  built: "完成安装",
};
export default function AutonomyControls({
  robot,
  disabled,
  act,
}: {
  robot: Robot;
  disabled: boolean;
  act: (a: WorldAction) => void;
}) {
  const a = robot.autonomy ?? {
    enabled: false,
    refill: true,
    inspect: true,
    maintain: false,
  };
  return (
    <fieldset>
      <legend>智能自主调度</legend>
      <p>
        开启后，机器人每 5
        秒会自动巡视已授权的厂区，优先帮高优先级设备补料、巡检或排障。出发前请确保总仓库有对应物料或备件箱、WH
        仓库打开了对应输出面，且沿途留有可走的空地。
      </p>
      {(
        [
          ["enabled", "启用自主派单"],
          ["refill", "自动补足设备一批原料"],
          ["inspect", "现场巡检"],
          ["maintain", "消耗备件清理积压"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={a[key]}
            onChange={(e) =>
              act({
                type: "robot_autonomy",
                id: robot.id,
                config: {
                  enabled: a.enabled,
                  refill: a.refill,
                  inspect: a.inspect,
                  maintain: a.maintain,
                  [key]: e.target.checked,
                },
              })
            }
          />
          {label}
        </label>
      ))}
      <small>
        关闭自动派单后，正在做的任务会继续完成。需要立即停下时暂停机器人；需要换任务时取消并等待返站。
      </small>
      <p>最近调度记录</p>
      {[...(robot.behavior_log ?? [])].reverse().map((e, i) => (
        <p key={`${e.tick}:${i}`}>
          T{e.tick} · {kinds[e.kind]} · {e.detail}
        </p>
      ))}
    </fieldset>
  );
}
