import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { components } from "../api/schema";
import type { DistrictSummary, WorldAction } from "./local/world";
import { buildingDefinitions, isChest, isFluidNode } from "./local/catalog";
import { canCarry } from "./local/robotFreight";

type Robot = components["schemas"]["RobotState"];
export default function RobotTaskForm({
  factory,
  catalog,
  robot,
  districts,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  robot: Robot;
  districts: DistrictSummary[];
  disabled: boolean;
  act: (action: WorldAction) => void;
}) {
  const [sourceZone, setSourceZone] = useState(factory.id),
    [targetZone, setTargetZone] = useState(factory.id),
    [sourceID, setSourceID] = useState(""),
    [targetID, setTargetID] = useState(""),
    [itemID, setItemID] = useState(""),
    [amount, setAmount] = useState(1),
    [channel, setChannel] = useState<"auto" | "input" | "fuel">("auto"),
    [repeat, setRepeat] = useState(true);
  const spec = catalog.robots!.find((d) => d.item === robot.item)!;
  if (!["carrier", "smart"].includes(spec.role) || !spec.capacity)
    return <p>这款机型不负责运输，请在现场作业中选择要处理的设备。</p>;
  const zones = districts.filter((d) => robot.allowed_zones.includes(d.id)),
    sourceFactory = zones.find((d) => d.id === sourceZone) ?? zones[0],
    targetFactory = zones.find((d) => d.id === targetZone) ?? zones[0];
  const options = (zone: DistrictSummary | undefined) => {
    if (!zone) return [];
    if (zone.id !== factory.id)
      return zone.warehouse_id
        ? [{ id: zone.warehouse_id, name: "WH · 总仓库接口" }]
        : [];
    return factory.buildings
      .filter(
        (b) =>
          b.building_type === "bus" ||
          isChest(b.building_type) ||
          isFluidNode(b.building_type) ||
          (buildingDefinitions.get(b.building_type)?.category === "machine" &&
            buildingDefinitions.get(b.building_type)?.role !== "station"),
      )
      .map((b) => ({
        id: b.id,
        name: `${buildingDefinitions.get(b.building_type)?.name ?? b.building_type} (${b.x},${b.y})`,
      }));
  };
  const sources = options(sourceFactory),
    targets = options(targetFactory),
    source = sources.find((b) => b.id === sourceID) ?? sources[0],
    target =
      targets.find((b) => b.id === targetID) ??
      targets.find((b) => b.id !== source?.id) ??
      targets[0],
    items = catalog.items.filter(
      (i) =>
        canCarry(spec, i.id) &&
        (i.tier ?? 1) <= (factory.simulation?.industry?.stage ?? 1),
    ),
    item = items.find((i) => i.id === itemID) ?? items[0],
    busy = !!(
      robot.task ||
      robot.service ||
      robot.construction ||
      robot.cargo ||
      robot.transit ||
      robot.returning
    );
  if (busy)
    return (
      <p className="operations-notice">
        机器人正在执行任务。要改路线，请先取消任务，等它回到补能站后再安排。
      </p>
    );
  if (!spec.cross_district && factory.id !== robot.home_factory_id)
    return (
      <p className="operations-notice">
        这台机器人只在归属厂区工作。请切到「
        {districts.find((d) => d.id === robot.home_factory_id)?.name ??
          "归属厂区"}
        」，再选择当地设备作为取货和交货位置。
      </p>
    );
  return (
    <fieldset className="robot-route-form">
      <legend>安排运输 · 从哪里取，送到哪里</legend>
      <p>
        选好取货点、交货点和要搬的物料。机器人会先在站旁充满能量，再沿着空地走到设备旁装卸。
      </p>
      <details className="operations-details">
        <summary>仓库接口和路线要求</summary>
        <p>
          从 WH 仓库取货时，请先把仓库朝向通道的那一面设为对应物品的「输出」；往
          WH 送货时，那一面要设为允许「输入」。
        </p>
        <p>
          机器人只能在空地上行走（建筑、传送带和管线都会挡路），请为补能站和目标设备留出相邻空位。跨厂区跑腿会借道
          WH 仓库中转，跨区路途耗时 8
          秒；如果要选其他厂区的具体设备，请先切换到对应厂区配置。
        </p>
      </details>
      <div className="robot-form-grid">
        {spec.cross_district && (
          <label>
            取货厂区
            <select
              disabled={disabled || busy}
              value={sourceFactory?.id ?? ""}
              onChange={(e) => {
                setSourceZone(e.target.value);
                setSourceID("");
              }}
            >
              {zones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          取货位置
          <select
            disabled={disabled || busy}
            value={source?.id ?? ""}
            onChange={(e) => setSourceID(e.target.value)}
          >
            {sources.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {spec.cross_district && (
          <label>
            交货厂区
            <select
              disabled={disabled || busy}
              value={targetFactory?.id ?? ""}
              onChange={(e) => {
                setTargetZone(e.target.value);
                setTargetID("");
              }}
            >
              {zones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          交货位置
          <select
            disabled={disabled || busy}
            value={target?.id ?? ""}
            onChange={(e) => setTargetID(e.target.value)}
          >
            {targets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          运输物品
          <select
            disabled={disabled || busy}
            value={item?.id ?? ""}
            onChange={(e) => setItemID(e.target.value)}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          每趟数量 · 上限 {spec.capacity}
          <input
            aria-label="机器人运输数量"
            disabled={disabled || busy}
            type="number"
            min={1}
            max={spec.capacity}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
        <label>
          放入目标的哪个位置
          <select
            disabled={disabled || busy}
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            <option value="auto">按配方 / 燃料接收</option>
            <option value="input">仅配方输入</option>
            <option value="fuel">仅燃料</option>
          </select>
        </label>
      </div>
      <label className="robot-repeat">
        <input
          type="checkbox"
          disabled={disabled || busy}
          checked={repeat}
          onChange={(e) => setRepeat(e.target.checked)}
        />
        循环往返
      </label>
      <button
        disabled={
          disabled ||
          busy ||
          !source ||
          !target ||
          !item ||
          !sourceFactory ||
          !targetFactory ||
          (source.id === target.id && sourceFactory.id === targetFactory.id) ||
          !Number.isInteger(amount) ||
          amount < 1 ||
          amount > spec.capacity
        }
        onClick={() =>
          act({
            type: "robot_task",
            id: robot.id,
            task_id: crypto.randomUUID(),
            source: { factory_id: sourceFactory!.id, building_id: source!.id },
            target: { factory_id: targetFactory!.id, building_id: target!.id },
            item: item!.id,
            count: amount,
            channel,
            repeat,
          })
        }
      >
        安排运输任务
      </button>
      {busy && <small>须先取消当前任务并返站，再指派新路线。</small>}
      {spec.energy === "hydraulic" || spec.role === "smart" ? (
        <small>可运输固体，也可运输单一流体；一次不能混装不同流体。</small>
      ) : (
        <small>该机型运输固体物品。</small>
      )}
    </fieldset>
  );
}
