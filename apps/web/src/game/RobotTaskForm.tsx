import GameSelect from "./GameSelect";
import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { components } from "../api/schema";
import type { DistrictSummary, WorldAction } from "./local/world";
import { buildingDefinitions } from "./local/catalog";
import { canCarry } from "./local/robotFreight";
import { freightEndpointSupported } from "./local/robotEndpoints";
import { robotBusy } from "./local/robotLifecycle";
import {
  newRobotTaskDraft,
  type RobotTaskDraftControls,
} from "./robotTaskDraft";

type Robot = components["schemas"]["RobotState"];
export default function RobotTaskForm({
  factory,
  catalog,
  robot,
  districts,
  disabled,
  act,
  taskDraft,
  onTaskDraftChange,
  onPickEndpoints,
  pickingEndpoints,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  robot: Robot;
  districts: DistrictSummary[];
  disabled: boolean;
  act: (action: WorldAction) => void;
} & RobotTaskDraftControls) {
  const [localDraft, setLocalDraft] = useState(() =>
    newRobotTaskDraft(factory.id),
  );
  const draft = taskDraft ?? localDraft;
  const update = (changes: Partial<typeof draft>) => {
    const next = { ...draft, ...changes };
    if (onTaskDraftChange) onTaskDraftChange(next);
    else setLocalDraft(next);
  };
  const spec = catalog.robots!.find((d) => d.item === robot.item)!;
  if (!["carrier", "smart"].includes(spec.role) || !spec.capacity)
    return <p>这款机型不负责运输，请在现场作业中选择要处理的设备。</p>;
  if (robotBusy(robot))
    return (
      <p className="operations-notice">
        机器人正在执行任务。要改路线，请先取消任务，等它回到补能站后再安排。
      </p>
    );
  const zones = districts.filter((d) => robot.allowed_zones.includes(d.id));
  const sourceFactory =
    zones.find((d) => d.id === draft.sourceZone) ?? zones[0];
  const targetFactory =
    zones.find((d) => d.id === draft.targetZone) ?? zones[0];
  const options = (
    zone: DistrictSummary | undefined,
    picked: typeof draft.source,
  ) => {
    if (!zone) return [];
    const entries =
      zone.id === factory.id
        ? factory.buildings
            .filter((b) => freightEndpointSupported(b.building_type))
            .map((b) => ({
              id: b.id,
              name: `${buildingDefinitions.get(b.building_type)?.name ?? b.building_type} (${b.x},${b.y})`,
            }))
        : zone.warehouse_id
          ? [{ id: zone.warehouse_id, name: "WH · 总仓库接口" }]
          : [];
    if (
      zone.id !== factory.id &&
      picked?.factory_id === zone.id &&
      !entries.some((b) => b.id === picked.building_id)
    )
      entries.push({ id: picked.building_id, name: picked.label });
    return entries;
  };
  const sources = options(sourceFactory, draft.source),
    targets = options(targetFactory, draft.target);
  const source =
    draft.source?.factory_id === sourceFactory?.id
      ? sources.find((b) => b.id === draft.source!.building_id)
      : sources[0];
  const target =
    draft.target?.factory_id === targetFactory?.id
      ? targets.find((b) => b.id === draft.target!.building_id)
      : (targets.find(
          (b) => b.id !== source?.id || targetFactory?.id !== sourceFactory?.id,
        ) ?? targets[0]);
  const items = catalog.items.filter(
    (i) =>
      canCarry(spec, i.id) &&
      (i.tier ?? 1) <= (factory.simulation?.industry?.stage ?? 1),
  );
  const validItem = draft.item === "" || items.some((i) => i.id === draft.item);
  const formDisabled = disabled || !!pickingEndpoints;
  return (
    <fieldset className="robot-route-form">
      <legend>安排运输</legend>
      {onPickEndpoints && (
        <button
          className="operations-primary"
          disabled={disabled}
          onClick={() => onPickEndpoints(robot.id)}
        >
          {pickingEndpoints ? "重新选取取货和交货位置" : "选取取货和交货位置"}
        </button>
      )}
      {pickingEndpoints && (
        <p role="status" className="operations-notice">
          按地图提示依次点击来源与目标，Esc 取消。完成后在此确认运输参数。
        </p>
      )}
      <div className="robot-form-grid">
        {(["source", "target"] as const).map((kind) => {
          const loading = kind === "source",
            label = loading ? "取货" : "交货";
          const zone = loading ? sourceFactory : targetFactory;
          const choices = loading ? sources : targets;
          const selected = loading ? source : target;
          return (
            <div className="robot-endpoint-fields" key={kind}>
              {spec.cross_district && (
                <label>
                  {label}厂区
                  <GameSelect
                    catalog={catalog}
                    aria-label={`${label}厂区`}
                    value={zone?.id ?? ""}
                    disabled={formDisabled}
                    onValueChange={(id) =>
                      update(
                        loading
                          ? { sourceZone: id, source: undefined }
                          : { targetZone: id, target: undefined },
                      )
                    }
                  >
                    {zones.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </GameSelect>
                </label>
              )}
              <label>
                {label}位置
                <GameSelect
                  catalog={catalog}
                  aria-label={`${label}位置`}
                  value={selected?.id ?? ""}
                  disabled={formDisabled}
                  onValueChange={(id) => {
                    const endpoint = {
                      factory_id: zone!.id,
                      building_id: id,
                      label: choices.find((b) => b.id === id)!.name,
                    };
                    update(
                      loading ? { source: endpoint } : { target: endpoint },
                    );
                  }}
                >
                  {choices.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </GameSelect>
              </label>
            </div>
          );
        })}
        <label>
          运输物品
          <GameSelect
            kind="item"
            aria-label="运输物品"
            catalog={catalog}
            disabled={formDisabled}
            value={draft.item}
            onValueChange={(item) => update({ item })}
          >
            <option value="">任意物品</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </GameSelect>
        </label>
        <label>
          每趟数量 · 上限 {spec.capacity}
          <input
            aria-label="机器人运输数量"
            disabled={formDisabled}
            type="number"
            min={1}
            max={spec.capacity}
            step={1}
            value={draft.count}
            onChange={(e) => update({ count: Number(e.target.value) })}
          />
        </label>
        <label>
          投入目标
          <GameSelect
            aria-label="放入目标的哪个位置"
            catalog={catalog}
            disabled={formDisabled}
            value={draft.channel}
            onValueChange={(channel) =>
              update({ channel: channel as typeof draft.channel })
            }
          >
            <option value="auto">按配方 / 燃料接收</option>
            <option value="input">仅配方输入</option>
            <option value="fuel">仅燃料</option>
          </GameSelect>
        </label>
      </div>
      <label className="robot-repeat">
        <input
          type="checkbox"
          disabled={formDisabled}
          checked={draft.repeat}
          onChange={(e) => update({ repeat: e.target.checked })}
        />
        循环往返
      </label>
      <button
        disabled={
          formDisabled ||
          !source ||
          !target ||
          !validItem ||
          !sourceFactory ||
          !targetFactory ||
          (source.id === target.id && sourceFactory.id === targetFactory.id) ||
          !Number.isInteger(draft.count) ||
          draft.count < 1 ||
          draft.count > spec.capacity
        }
        onClick={() =>
          act({
            type: "robot_task",
            id: robot.id,
            task_id: crypto.randomUUID(),
            source: { factory_id: sourceFactory!.id, building_id: source!.id },
            target: { factory_id: targetFactory!.id, building_id: target!.id },
            item: draft.item,
            count: draft.count,
            channel: draft.channel,
            repeat: draft.repeat,
          })
        }
      >
        安排运输任务
      </button>
      <small>
        任意物品：每趟搬一种兼容物品，送完再换；不会混装。目标拒收或已满的物品会先跳过。
      </small>
      <details className="operations-details">
        <summary>端点与路线要求</summary>
        <p>
          支持 WH、料箱、生产机器和流体储罐。从 WH
          取货需设置对应物品输出面，送入需开启输入面。管道、阀泵和补能站不能作为新任务端点。
        </p>
        <p>
          机器人可穿过带、管和动力线。机器、储罐和在建蓝图挡路，请留出设备旁通道。跨厂需先授权目标厂区，跨区耗时
          8 秒。
        </p>
        <p>
          {spec.energy === "hydraulic" || spec.role === "smart"
            ? "可运输固体或单种流体。"
            : "该机型只运输固体。"}
        </p>
      </details>
    </fieldset>
  );
}
