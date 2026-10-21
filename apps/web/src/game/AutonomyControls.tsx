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
        每 5 秒检查已授权厂区，按设备优先级和同级轮换派单。补料需真实 WH
        库存、物品输出面和空闲通道；维护消耗实际备件。
      </p>
      {(
        [
          ["enabled", "启用自主派单"],
          ["refill", "补足所选配方的一批输入"],
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
        关闭派单保留已执行中的任务。立即停工可暂停机器人；携货取消后需实际返站。已有运输任务会预留需求，避免重复补足。
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
