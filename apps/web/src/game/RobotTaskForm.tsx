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
    return <p>该机型请从“真实作业”选择当前厂的持续异常。</p>;
  const zones = districts.filter((d) => robot.allowed_zones.includes(d.id)),
    sourceFactory = zones.find((d) => d.id === sourceZone) ?? zones[0],
    targetFactory = zones.find((d) => d.id === targetZone) ?? zones[0];
  const options = (zone: DistrictSummary | undefined) => {
    if (!zone) return [];
    if (zone.id !== factory.id)
      return zone.warehouse_id
        ? [{ id: zone.warehouse_id, name: "WH · 工厂分仓" }]
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
      <p>当前任务与携货状态见上方；先取消并实际返站，再指派新的取送路线。</p>
    );
  return (
    <fieldset>
      <legend>取货 → 交货</legend>
      <p>
        每秒走一格空闲通道；到端点邻格装卸，跨区经 WH 行程 8
        秒。出发前在归属站补满能量，满载或堵塞时保留货物。
      </p>
      <small>
        当前厂可选机器、箱罐与 WH；其他厂先选
        WH。切到相应厂区可配置当地设备端点。WH
        取货面须指定该物品输出，交货面须允许输入。
      </small>
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
      <label>
        取货端点
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
      <label>
        交货端点
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
        交货用途
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
      <label>
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
        实际返站后指派路线
      </button>
      {busy && <small>须先取消当前任务并返站，再指派新路线。</small>}
      {spec.energy === "hydraulic" || spec.role === "smart" ? (
        <small>支持密封载舱搬运单种整单位流体；禁止混液。</small>
      ) : (
        <small>该机型运输固体物品。</small>
      )}
    </fieldset>
  );
}
