import type { components } from "../api/schema";
import type { FactoryDetail } from "../api/client";
import type { DistrictSummary, WorldAction } from "./local/world";
import type { RobotRoute } from "./local/robotNavigation";
import { robotDefinitions } from "./local/robots";
import { itemDefinitions, buildingDefinitions } from "./local/catalog";
import {
  robotStatusNames,
  robotStateHint,
  robotAtHome,
  robotBusy,
} from "./local/robotLifecycle";
export default function RobotInspector({
  robot,
  factory,
  districts,
  route,
  paused,
  act,
  onLocate,
  onManage,
}: {
  robot: components["schemas"]["RobotState"];
  factory: FactoryDetail;
  districts: DistrictSummary[];
  route?: RobotRoute;
  paused: boolean;
  act: (a: WorldAction) => void;
  onLocate: () => void;
  onManage: () => void;
}) {
  const d = robotDefinitions.get(robot.item)!;
  const zone = (id: string) => districts.find((f) => f.id === id)?.name ?? id;
  const target = route?.target;
  const b =
    target?.factory_id === factory.id
      ? factory.buildings.find((b) => b.id === target.building_id)
      : undefined;
  const routeLabel = {
    idle: "当前无任务路段",
    transit: "跨区途中，落地后重新规划",
    missing: "目标已不存在，机器人将返站",
    congested: "通道被占用，正在等待其他机器人让位",
    no_path: "当前没有可走通道",
    ready: "当前行走路线",
  };
  return (
    <section className="robot-inspector" aria-label="机器人检视">
      <h3>{d.name}</h3>
      <code>{robot.id}</code>
      <p>
        {paused
          ? "世界暂停"
          : !robot.enabled
            ? "机器人暂停"
            : robotStatusNames[robot.status]}{" "}
        · {robot.energy_kj} / {d.energy_capacity_kj} kJ
      </p>
      <p role="status">{robotStateHint(robot, paused)}</p>
      <p>
        归属：{zone(robot.home_factory_id)}
        <br />
        {robot.transit
          ? `前往 ${zone(robot.transit.to_factory_id)} (${robot.transit.x},${robot.transit.y}) · 剩余 ${robot.transit.remaining_ticks} 秒`
          : `所在：${zone(robot.factory_id)} (${robot.x},${robot.y})`}
      </p>
      <p>
        {route ? routeLabel[route.status] : "未选择路线"}
        {target && (
          <>
            {" "}
            · 目标 {zone(target.factory_id)} ·{" "}
            {b
              ? buildingDefinitions.get(b.building_type)?.name
              : robot.construction && !robot.returning
                ? "施工蓝图"
                : "设备 / WH"}
            {target.x !== undefined ? ` (${target.x},${target.y})` : ""}
          </>
        )}
      </p>
      {robot.cargo && (
        <p>
          正在携带：{itemDefinitions.get(robot.cargo.item)?.name} ×{" "}
          {robot.cargo.count}
        </p>
      )}
      {robot.service && (
        <p>
          现场{robot.service.kind === "inspect" ? "巡检" : "维护"} · 保留备件{" "}
          {robot.service.parts}
        </p>
      )}
      {(robot.task || robot.service || robot.construction) && (
        <p>
          {robot.construction ? "施工" : "作业"}工时 {robot.work_progress ?? 0}{" "}
          / {robot.construction ? 10 : d.action_ticks} 秒
        </p>
      )}
      <small>
        虚线显示当前前往目标的路线。跨区时先显示到 WH
        的路段，抵达后再显示下一段。
      </small>
      <div className="machine-actions">
        <button onClick={onLocate}>定位机器人 / 落点</button>
        <button onClick={onManage}>打开机器人管理</button>
        <button
          disabled={paused}
          onClick={() =>
            act({ type: "robot_config", id: robot.id, enabled: !robot.enabled })
          }
        >
          {robot.enabled ? "暂停机器人" : "启用机器人"}
        </button>
        <button
          disabled={paused || !robotBusy(robot)}
          onClick={() => act({ type: "robot_return", id: robot.id })}
        >
          取消任务并携货返站
        </button>
        <button
          disabled={paused || robotBusy(robot) || !robotAtHome(robot, factory)}
          onClick={() => act({ type: "robot_recall", id: robot.id })}
        >
          召回机器人到总仓库
        </button>
      </div>
    </section>
  );
}
