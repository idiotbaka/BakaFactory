import type { components } from "../api/schema";
import type { Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import ItemSprite from "./ItemSprite";
import RobotTaskForm from "./RobotTaskForm";
import type { RobotTaskDraftControls } from "./robotTaskDraft";
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
  catalog,
  districts,
  route,
  paused,
  act,
  onLocate,
  onManage,
  taskDraft,
  onTaskDraftChange,
  onPickEndpoints,
  pickingEndpoints,
}: {
  robot: components["schemas"]["RobotState"];
  factory: FactoryDetail;
  catalog: Catalog;
  districts: DistrictSummary[];
  route?: RobotRoute;
  paused: boolean;
  act: (a: WorldAction) => void;
  onLocate: () => void;
  onManage: () => void;
} & RobotTaskDraftControls) {
  const d = robotDefinitions.get(robot.item)!;
  const zone = (id: string) => districts.find((f) => f.id === id)?.name ?? id;
  const target = route?.target;
  const b =
    target?.factory_id === factory.id
      ? factory.buildings.find((b) => b.id === target.building_id)
      : undefined;
  const routeLabel = {
    idle: "当前没有出行路线",
    transit: "跨区赶路中，抵达后再规划厂内路线",
    missing: "目标设备已拆除，正在返站",
    congested: "前方通道被其他机器人挡住，正在等候让路",
    no_path: "通道被堵死，找不到可走的路线",
    ready: "当前行进路线",
  };
  return (
    <section className="robot-inspector" aria-label="机器人检视">
      <div className="inspector-hero">
        <DefinitionIcon definition={itemDefinitions.get(robot.item)!} />
        <div>
          <h3>{d.name}</h3>
          <code>
            P{d.tier} · <span>{robot.id}</span>
          </code>
        </div>
      </div>
      <p className="definition-description">
        {itemDefinitions.get(robot.item)?.description}
      </p>
      <section className="robot-inspector-card" aria-label="机器人运行状态">
        <div className="robot-inspector-status">
          <span>
            {paused
              ? "世界暂停"
              : !robot.enabled
                ? "机器人暂停"
                : robotStatusNames[robot.status]}{" "}
          </span>
          <span>{d.capacity > 0 ? `载量 ${d.capacity}` : "现场巡检"}</span>
        </div>
        <label className="robot-energy-label">
          剩余能量{" "}
          <span>
            {robot.energy_kj} / {d.energy_capacity_kj} kJ
          </span>
          <meter
            min={0}
            max={d.energy_capacity_kj}
            value={robot.energy_kj}
            aria-label="机器人剩余能量"
          />
        </label>
        <p role="status">{robotStateHint(robot, paused)}</p>
      </section>
      <dl className="definition-properties">
        <div>
          <dt>归属厂区</dt>
          <dd>{zone(robot.home_factory_id)}</dd>
        </div>
        <div>
          <dt>当前位置</dt>
          <dd>
            {robot.transit
              ? `前往 ${zone(robot.transit.to_factory_id)} (${robot.transit.x},${robot.transit.y}) · 剩余 ${robot.transit.remaining_ticks} 秒`
              : `${zone(robot.factory_id)} (${robot.x},${robot.y})`}
          </dd>
        </div>
        <div>
          <dt>完成任务</dt>
          <dd>{robot.completed_tasks ?? 0} 趟</dd>
        </div>
        <div>
          <dt>跨厂作业</dt>
          <dd>{d.cross_district ? "支持 · 需授权" : "仅归属厂"}</dd>
        </div>
      </dl>
      <section className="robot-inspector-card" aria-label="当前任务与携货">
        <h4>当前任务</h4>
        {robot.task && (
          <p>
            {robot.task.item
              ? itemDefinitions.get(robot.task.item)?.name
              : "任意物品"}{" "}
            · 每趟 {robot.task.count} ·{" "}
            {robot.task.repeat ? "循环往返" : "单次运输"}
          </p>
        )}
        {!robotBusy(robot) && <p>暂无任务，可在下方安排运输。</p>}
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
          <p className="robot-cargo-summary">
            <ItemSprite id={robot.cargo.item} />
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
            {robot.construction ? "施工" : "作业"}工时{" "}
            {robot.work_progress ?? 0} /{" "}
            {robot.construction ? 10 : d.action_ticks} 秒
          </p>
        )}
        <small>
          地图上的虚线是当前行进路线；跨厂区作业时会先走到本厂 WH
          仓库，抵达目标厂区后再显示下一段路线。
        </small>
      </section>
      {!["carrier", "smart"].includes(d.role) && !robotBusy(robot) && (
        <p className="definition-description">
          请打开机器人管理，安排巡检或维修作业。
        </p>
      )}
      {["carrier", "smart"].includes(d.role) && !robotBusy(robot) && (
        <RobotTaskForm
          key={robot.id}
          factory={factory}
          catalog={catalog}
          robot={robot}
          districts={districts}
          disabled={paused}
          act={act}
          taskDraft={taskDraft}
          onTaskDraftChange={onTaskDraftChange}
          onPickEndpoints={onPickEndpoints}
          pickingEndpoints={pickingEndpoints}
        />
      )}
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
