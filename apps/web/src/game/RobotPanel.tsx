import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { DistrictSummary, WorldAction } from "./local/world";
import { buildingDefinitions } from "./local/catalog";
import RobotTaskForm from "./RobotTaskForm";
import WorkPanel from "./WorkPanel";
import AutonomyControls from "./AutonomyControls";
import ConstructionForm from "./ConstructionForm";
import {
  requiredRobotZones,
  robotAtHome,
  robotBusy,
  robotStateHint,
  robotStatusNames,
} from "./local/robotLifecycle";
import type { components } from "../api/schema";

const energyNames: Record<string, string> = {
  shaft: "轴功",
  hydraulic: "液压",
  electric: "电力",
};
const statuses = robotStatusNames;
export default function RobotPanel({
  factory,
  catalog,
  districts,
  disabled,
  act,
  selectedRobotID,
  onSelectRobot,
  onLocateRobot,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  districts: DistrictSummary[];
  disabled: boolean;
  act: (action: WorldAction) => void;
  selectedRobotID?: string | null;
  onSelectRobot?: (id: string) => void;
  onLocateRobot?: (robot: components["schemas"]["RobotState"]) => void;
}) {
  const [item, setItem] = useState(""),
    [stationID, setStationID] = useState(""),
    [selectedID, setSelectedID] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const definitions = catalog.robots ?? [],
    robots = factory.robots ?? [],
    stage = factory.simulation?.industry?.stage ?? 1;
  const definition =
    definitions.find((d) => d.item === item) ??
    definitions.find((d) => d.tier <= stage);
  const stations = factory.buildings.filter((b) => {
    const d = buildingDefinitions.get(b.building_type);
    return d?.role === "station" && d.energy === definition?.energy;
  });
  const station = stations.find((b) => b.id === stationID) ?? stations[0];
  const selected =
      robots.find((r) => r.id === (selectedRobotID ?? selectedID)) ?? robots[0],
    spec = definitions.find((d) => d.item === selected?.item);
  const lockedZones = selected
    ? requiredRobotZones(selected)
    : new Set<string>();
  const visible = robots.filter(
    (r) =>
      (filter !== "current" ||
        r.factory_id === factory.id ||
        r.transit?.to_factory_id === factory.id) &&
      (filter !== "attention" ||
        !r.enabled ||
        [
          "no_energy",
          "no_path",
          "congested",
          "blocked",
          "rejected",
          "source_empty",
          "range_exceeded",
        ].includes(r.status)) &&
      `${definitions.find((d) => d.item === r.item)?.name} ${r.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const zoneName = (id: string) =>
    districts.find((f) => f.id === id)?.name ?? "当前厂区";
  const endpointName = (e: { factory_id: string; building_id: string }) => {
    const b =
      e.factory_id === factory.id
        ? factory.buildings.find((b) => b.id === e.building_id)
        : undefined;
    const name = b
      ? `${buildingDefinitions.get(b.building_type)?.name ?? b.building_type} (${b.x},${b.y})`
      : districts.find((d) => d.id === e.factory_id)?.warehouse_id ===
          e.building_id
        ? "WH"
        : `设备 ${e.building_id.slice(0, 8)}`;
    return `${zoneName(e.factory_id)} · ${name}`;
  };
  return (
    <section className="robot-panel" aria-label="机器人管理">
      <h3>机器人 · {robots.length} / 500</h3>
      <p>
        部署从当前厂区仓库消耗一本体，初始能量为零；补能站从真实网络蓄能，电动机器人充电效率
        88%。运输、巡检和清理积压按实际路径与工时执行；现场作业产生可消费训练凭据。
      </p>
      <fieldset>
        <legend>部署到当前厂区</legend>
        <label>
          机器人
          <select
            aria-label="部署机器人类型"
            disabled={disabled}
            value={definition?.item ?? ""}
            onChange={(e) => setItem(e.target.value)}
          >
            {definitions.map((d) => (
              <option key={d.item} value={d.item} disabled={d.tier > stage}>
                {d.name} · P{d.tier} · 仓库{" "}
                {factory.simulation?.warehouse[d.item] ?? 0}
              </option>
            ))}
          </select>
        </label>
        <label>
          归属补能站
          <select
            aria-label="归属补能站"
            disabled={disabled}
            value={station?.id ?? ""}
            onChange={(e) => setStationID(e.target.value)}
          >
            <option value="" disabled>
              请选择兼容补能站
            </option>
            {stations.map((b) => (
              <option key={b.id} value={b.id}>
                {buildingDefinitions.get(b.building_type)?.name} ({b.x},{b.y})
              </option>
            ))}
          </select>
        </label>
        {definition && (
          <small>
            {energyNames[definition.energy]} · 载重 {definition.capacity} u ·
            储能 {definition.energy_capacity_kj} kJ ·{" "}
            {definition.cross_district ? "可授权跨厂区" : "仅归属厂区"}
          </small>
        )}
        <button
          disabled={
            disabled ||
            !station ||
            !definition ||
            definition.tier > stage ||
            !(factory.simulation?.warehouse[definition.item] ?? 0)
          }
          onClick={() =>
            act({
              type: "robot_deploy",
              factory_id: factory.id,
              station: station.id,
              item: definition!.item,
              id: crypto.randomUUID(),
            })
          }
        >
          消耗 1 本体并部署
        </button>
        {!stations.length && (
          <small>需建兼容该能源的补能站，并在站旁留出未占用空格。</small>
        )}
      </fieldset>
      <label>
        查找机器人
        <input
          aria-label="查找机器人"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="机型或实体 ID"
        />
      </label>
      <label>
        显示范围
        <select
          aria-label="机器人显示范围"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部厂区</option>
          <option value="current">当前厂区 / 正在前往</option>
          <option value="attention">暂停 / 等待处理</option>
        </select>
      </label>
      <p>
        显示 {visible.length} / {robots.length} 台
      </p>
      <div className="robot-list" aria-label="已部署机器人">
        {visible.map((r) => (
          <button
            key={r.id}
            aria-pressed={selected?.id === r.id}
            onClick={() => {
              setSelectedID(r.id);
              onSelectRobot?.(r.id);
            }}
          >
            {definitions.find((d) => d.item === r.item)?.name} ·{" "}
            {r.id.slice(0, 8)}
            <small>
              {r.transit
                ? `前往${zoneName(r.transit.to_factory_id)}`
                : zoneName(r.factory_id)}{" "}
              ·{" "}
              {disabled
                ? "世界暂停"
                : !r.enabled
                  ? "机器人暂停"
                  : (statuses[r.status] ?? r.status)}{" "}
              · {r.energy_kj} kJ
            </small>
          </button>
        ))}
      </div>
      <WorkPanel
        factory={factory}
        robot={selected}
        disabled={disabled}
        act={act}
      />
      {selected && spec && (
        <fieldset>
          <legend>{spec.name}</legend>
          <p role="status">{robotStateHint(selected, disabled)}</p>
          {onLocateRobot && (
            <button onClick={() => onLocateRobot(selected)}>
              在地图查看机器人 / 过境落点
            </button>
          )}
          {spec.role === "smart" && (
            <AutonomyControls robot={selected} disabled={disabled} act={act} />
          )}
          <p>
            归属：{zoneName(selected.home_factory_id)} ·{" "}
            {selected.transit
              ? `前往${zoneName(selected.transit.to_factory_id)}，剩余 ${selected.transit.remaining_ticks} 秒`
              : `${zoneName(selected.factory_id)} (${selected.x},${selected.y})`}
            <br />
            {disabled
              ? "世界暂停"
              : !selected.enabled
                ? "机器人暂停"
                : statuses[selected.status]}{" "}
            · {selected.energy_kj} / {spec.energy_capacity_kj} kJ
          </p>
          <p>
            完成运输 {selected.completed_tasks ?? 0} 趟 ·{" "}
            {selected.construction ? "施工工时" : "作业工时"}{" "}
            {selected.work_progress ?? 0} /{" "}
            {selected.construction ? 10 : spec.action_ticks} 秒
          </p>
          {selected.task && (
            <p>
              {endpointName(selected.task.source)} →{" "}
              {endpointName(selected.task.target)} ·{" "}
              {catalog.items.find((i) => i.id === selected.task!.item)?.name} ·{" "}
              {selected.task.phase === "pickup" ? "取货" : "交货"} ·{" "}
              {selected.task.repeat ? "循环" : "单趟"} · 每趟{" "}
              {selected.task.count}，已交 {selected.task.delivered}
            </p>
          )}
          {selected.cargo && (
            <p>
              实际携货：
              {
                catalog.items.find((i) => i.id === selected.cargo!.item)?.name
              } × {selected.cargo.count}
            </p>
          )}
          {selected.service && (
            <p>
              {selected.service.kind === "inspect" ? "现场巡检" : "积压维护"}：
              {endpointName(selected.service.target)} · 携带备件{" "}
              {selected.service.parts}
            </p>
          )}
          {selected.construction && (
            <p>
              蓝图：{zoneName(selected.construction.factory_id)} ·{" "}
              {
                buildingDefinitions.get(selected.construction.building_type)
                  ?.name
              }{" "}
              ({selected.construction.x},{selected.construction.y}) ·{" "}
              {selected.returning ? "已中止，实际回收中" : "格位已预留"}
            </p>
          )}
          {selected.returning && (
            <p>返站途中；携货先送回归属厂 WH，再停靠补能站。</p>
          )}
          <button
            disabled={disabled}
            onClick={() =>
              act({
                type: "robot_config",
                id: selected.id,
                enabled: !selected.enabled,
              })
            }
          >
            {selected.enabled ? "暂停机器人" : "启用机器人"}
          </button>
          <label>
            补能 / 任务优先级
            <select
              aria-label="机器人优先级"
              disabled={disabled}
              value={selected.priority}
              onChange={(e) =>
                act({
                  type: "robot_config",
                  id: selected.id,
                  priority: Number(e.target.value),
                })
              }
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 1 ? " · 最高" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="robot-zones" aria-label="可作业厂区">
            {districts.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  disabled={
                    disabled ||
                    (selected.allowed_zones.includes(d.id) &&
                      lockedZones.has(d.id)) ||
                    !spec.cross_district
                  }
                  title={
                    lockedZones.has(d.id)
                      ? "归属、当前、任务或过境仍使用此厂区，完成返站后才能撤销"
                      : "授权此机器人使用该厂区"
                  }
                  checked={selected.allowed_zones.includes(d.id)}
                  onChange={(e) =>
                    act({
                      type: "robot_config",
                      id: selected.id,
                      allowed_zones: e.target.checked
                        ? [...selected.allowed_zones, d.id]
                        : selected.allowed_zones.filter((id) => id !== d.id),
                    })
                  }
                />
                {d.name}
                {d.id === selected.home_factory_id ? "（归属）" : ""}
                {d.id !== selected.home_factory_id && lockedZones.has(d.id)
                  ? "（任务使用中）"
                  : ""}
              </label>
            ))}
          </div>
          <small>
            当前所在、任务端点或过境涉及的厂区，须取消任务并实际返站后再撤销授权。
          </small>
          <button
            disabled={
              disabled ||
              !(
                selected.task ||
                selected.service ||
                selected.construction ||
                selected.cargo ||
                selected.transit ||
                selected.returning
              )
            }
            onClick={() => act({ type: "robot_return", id: selected.id })}
          >
            取消任务并携货返站
          </button>
          <RobotTaskForm
            key={`${factory.id}:${selected.id}`}
            factory={factory}
            catalog={catalog}
            robot={selected}
            districts={districts}
            disabled={disabled}
            act={act}
          />
          {spec.role === "smart" && (
            <ConstructionForm
              key={`build:${factory.id}:${selected.id}`}
              factory={factory}
              catalog={catalog}
              robot={selected}
              disabled={disabled}
              act={act}
            />
          )}
          <button
            disabled={
              disabled ||
              !robotAtHome(selected, factory) ||
              !!(
                selected.task ||
                selected.service ||
                selected.construction ||
                selected.cargo ||
                selected.transit ||
                selected.returning
              )
            }
            onClick={() => act({ type: "robot_recall", id: selected.id })}
          >
            返还本体至归属厂仓库
          </button>
          <small>
            {factory.id !== selected.home_factory_id
              ? "请先定位到归属厂检视停靠状态，再召回本体。"
              : robotBusy(selected)
                ? "当前仍有任务 / 携货，先取消并实际返站。"
                : "须实际停靠归属站；召回散失已储能量，再部署从零补能。"}
          </small>
        </fieldset>
      )}
    </section>
  );
}
