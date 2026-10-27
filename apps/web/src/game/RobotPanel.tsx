import { useState } from "react";
import { createCatalogSearch } from "./catalogSearch";
import type { Catalog, FactoryDetail } from "../api/client";
import type { DistrictSummary, WorldAction } from "./local/world";
import { buildingDefinitions } from "./local/catalog";
import RobotTaskForm from "./RobotTaskForm";
import WorkPanel from "./WorkPanel";
import AutonomyControls from "./AutonomyControls";
import ConstructionForm from "./ConstructionForm";
import RobotOverview, { robotAttention } from "./RobotOverview";
import {
  requiredRobotZones,
  robotAtHome,
  robotBusy,
  robotStateHint,
  robotStatusNames,
} from "./local/robotLifecycle";
import type { components } from "../api/schema";

const energyNames: Record<string, string> = {
  shaft: "机械动力（传动轴）",
  hydraulic: "液压",
  electric: "电力",
};
const statuses = robotStatusNames;
const roles: Record<string, string> = {
  carrier: "搬运物品",
  inspector: "检查设备",
  repair: "清理积压",
  smart: "运输 / 巡检 / 维护 / 施工",
};
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
  const unlocked = definitions.filter((d) => d.tier <= stage);
  const definition = unlocked.find((d) => d.item === item) ?? unlocked[0];
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
  const matchesCatalog = createCatalogSearch(query);
  const visible = robots.filter(
    (r) =>
      (filter !== "current" ||
        r.factory_id === factory.id ||
        r.transit?.to_factory_id === factory.id) &&
      (filter !== "attention" ||
        !r.enabled ||
        robotAttention.includes(r.status)) &&
      matchesCatalog({
        name: definitions.find((d) => d.item === r.item)?.name,
        id: r.id,
      }),
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
      <RobotOverview
        factory={factory}
        catalog={catalog}
        item={definition?.item}
      />
      {definition && (
        <fieldset className="operations-card robot-deploy">
          <legend>01 · 部署到「{factory.name}」</legend>
          <div className="robot-form-grid">
            <label>
              机器人
              <select
                aria-label="部署机器人类型"
                disabled={disabled}
                value={definition?.item ?? ""}
                onChange={(e) => setItem(e.target.value)}
              >
                {unlocked.map((d) => (
                  <option key={d.item} value={d.item}>
                    {d.name} · P{d.tier} · 总仓库{" "}
                    {factory.simulation?.warehouse[d.item] ?? 0}
                  </option>
                ))}
              </select>
            </label>
            <label>
              补能站（机器人返回这里补能）
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
                    {buildingDefinitions.get(b.building_type)?.name} ({b.x},
                    {b.y})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {definition && (
            <div className="robot-capabilities">
              <span>{roles[definition.role]}</span>
              <span>{energyNames[definition.energy]}</span>
              {definition.capacity > 0 && (
                <span>
                  每趟最多 {definition.capacity}{" "}
                  {definition.energy === "hydraulic" ||
                  definition.role === "smart"
                    ? "件 / u"
                    : "件"}
                </span>
              )}
              <span>
                {definition.cross_district ? "支持跨厂区" : "只在本厂工作"}
              </span>
            </div>
          )}
          <button
            className="operations-primary"
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
            部署 1 台机器人
          </button>
          {!stations.length && (
            <p className="operations-notice">
              本厂还没有这种机型可用的补能站。先按上方连接顺序建站，再回来部署。
            </p>
          )}
          {!(factory.simulation?.warehouse[definition.item] ?? 0) && (
            <p className="operations-notice">
              总仓库还没有「{definition.name}
              」。可到图鉴的物品分类查看制作来源。
            </p>
          )}
          <details className="operations-details">
            <summary>机型参数与补能规则</summary>
            <p>
              储能上限 {definition.energy_capacity_kj} kJ · 装卸 / 作业{" "}
              {definition.action_ticks} 秒。
            </p>
            <p>
              刚部署的机器人空电上岗，需要先在归属站旁充满能量才会出发。记得给补能站接通对应动力网；电动机型的充电转换效率为
              88%。
            </p>
          </details>
        </fieldset>
      )}
      <section className="operations-section operations-card">
        <header className="operations-section-heading">
          <h4>02 · 已部署机队</h4>
          <span>{robots.length} 台</span>
        </header>
        <div className="robot-filters">
          <label>
            查找机器人
            <input
              aria-label="查找机器人"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="机型 / 编号 / 拼音"
              title="支持全拼、拼音首字母和部分内容"
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
        </div>
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
              <strong>
                {definitions.find((d) => d.item === r.item)?.name} ·{" "}
                {r.id.slice(0, 8)}
              </strong>
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
        {!visible.length && (
          <div className="operations-empty">
            <strong>
              {robots.length ? "没有匹配的机器人" : "还没有机器人上岗"}
            </strong>
            <p>
              {robots.length
                ? "试试清空搜索，或把显示范围改为全部厂区。"
                : "准备本体和补能站后，在上方部署第一台。部署后会在这里显示能量和任务。"}
            </p>
          </div>
        )}
      </section>
      {selected && spec && (
        <fieldset className="operations-card robot-control">
          <legend>03 · {spec.name} · 任务控制</legend>
          <p role="status">{robotStateHint(selected, disabled)}</p>
          {onLocateRobot && (
            <button onClick={() => onLocateRobot(selected)}>
              在地图查看机器人 / 过境落点
            </button>
          )}
          {spec.role === "smart" && (
            <details className="operations-details">
              <summary>智能调度 · 自动寻找任务</summary>
              <AutonomyControls
                robot={selected}
                disabled={disabled}
                act={act}
              />
            </details>
          )}
          <dl className="operations-facts">
            <div>
              <dt>当前状态</dt>
              <dd>
                {disabled
                  ? "世界暂停"
                  : !selected.enabled
                    ? "机器人暂停"
                    : statuses[selected.status]}
              </dd>
            </div>
            <div>
              <dt>可用能量</dt>
              <dd>
                {selected.energy_kj} / {spec.energy_capacity_kj} kJ
              </dd>
            </div>
            <div>
              <dt>归属补能站所在厂区</dt>
              <dd>{zoneName(selected.home_factory_id)}</dd>
            </div>
            <div>
              <dt>当前位置</dt>
              <dd>
                {selected.transit
                  ? `前往${zoneName(selected.transit.to_factory_id)}，剩余 ${selected.transit.remaining_ticks} 秒`
                  : `${zoneName(selected.factory_id)} (${selected.x},${selected.y})`}
              </dd>
            </div>
          </dl>
          <p>
            已完成运输 {selected.completed_tasks ?? 0} 趟 ·{" "}
            {selected.construction ? "施工工时" : "作业工时"}{" "}
            {selected.work_progress ?? 0} /{" "}
            {selected.construction ? 10 : spec.action_ticks} 秒
          </p>
          {selected.task && (
            <p className="robot-mission">
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
              正在携带：
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
              {selected.returning
                ? "已取消，设备正在运回仓库"
                : "施工位置已保留"}
            </p>
          )}
          {selected.returning && (
            <p>正在返站；如果身上带了物料，会先交回仓库再回补能站停靠。</p>
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
          <details className="operations-details">
            <summary>补能优先级与厂区授权</summary>
            <p>
              优先级 1
              最高，同站排队补能或自动派单时会优先照顾高优先级机器人。支持跨区的机型只能前往已勾选的厂区。
            </p>
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
                        ? "机器人正停靠、途经或在该厂区执行任务，返站后才能取消勾选"
                        : "允许这台机器人前往该厂区作业"
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
              {spec.cross_district
                ? "正在使用的厂区暂时不能取消勾选；如需调整，请先取消当前任务等它回到站旁。"
                : "这款机型只在归属厂区内作业，无需配置跨厂区权限。"}
            </small>
          </details>
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
          {["carrier", "smart"].includes(spec.role) && (
            <RobotTaskForm
              key={`${factory.id}:${selected.id}`}
              factory={factory}
              catalog={catalog}
              robot={selected}
              districts={districts}
              disabled={disabled}
              act={act}
            />
          )}
          {["inspector", "repair"].includes(spec.role) && (
            <WorkPanel
              factory={factory}
              robot={selected}
              disabled={disabled}
              act={act}
            />
          )}
          {stage >= 3 && ["carrier", "smart"].includes(spec.role) && (
            <details className="operations-details">
              <summary>作业记录与训练</summary>
              <WorkPanel
                factory={factory}
                robot={selected}
                disabled={disabled}
                act={act}
              />
            </details>
          )}
          {spec.role === "smart" && (
            <details className="operations-details">
              <summary>蓝图施工 · 安装设备</summary>
              <ConstructionForm
                key={`build:${factory.id}:${selected.id}`}
                factory={factory}
                catalog={catalog}
                robot={selected}
                disabled={disabled}
                act={act}
              />
            </details>
          )}
          <details className="operations-details">
            <summary>召回与运行参数</summary>
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
              召回机器人到总仓库
            </button>
            <small>
              {factory.id !== selected.home_factory_id
                ? "请先切换到归属厂区，确认机器人已停靠在补能站旁后再召回。"
                : robotBusy(selected)
                  ? "机器人还在执行任务或携带着物品，请先取消任务等它回到站旁。"
                  : "停靠在补能站旁时即可召回，机器人本体会退回总仓库（体内余电会清空）。"}
            </small>
          </details>
        </fieldset>
      )}
      <details className="operations-details">
        <summary>后续机型与用途</summary>
        <ul className="operations-steps">
          <li>P2：发条搬运车，本厂短途固体运输。</li>
          <li>
            P3：液压搬运机器人可运流体并跨区作业；管线巡检机器人负责检查设备。
          </li>
          <li>P4～P5：电动物流、分拣和维修机型，提高吞吐并清理产物积压。</li>
          <li>P6：智能机器人可自动补料、巡检、维护和安装蓝图设备。</li>
        </ul>
      </details>
    </section>
  );
}
