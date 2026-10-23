import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { components } from "../api/schema";
import type { WorldAction } from "./local/world";
import { placementIssue } from "./editorGeometry";

type Robot = components["schemas"]["RobotState"];
export default function ConstructionForm({
  factory,
  catalog,
  robot,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  robot: Robot;
  disabled: boolean;
  act: (a: WorldAction) => void;
}) {
  const [type, setType] = useState(""),
    [x, setX] = useState(6),
    [y, setY] = useState(2),
    [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0),
    [recipeID, setRecipeID] = useState("");
  const stage = factory.simulation?.industry?.stage ?? 1;
  const options = catalog.buildings.filter(
    (d) => d.item && !d.fixed && !d.legacy && (d.tier ?? 1) <= stage,
  );
  const d = options.find((d) => d.id === type) ?? options[0];
  const recipes = catalog.recipes.filter(
    (r) =>
      r.building_type === d?.id &&
      (r.tier ?? 1) <= stage &&
      (!r.gate || factory.simulation?.industry?.milestones.includes(r.gate)),
  );
  const recipe = recipes.find((r) => r.id === recipeID);
  const spec = catalog.robots!.find((d) => d.item === robot.item)!;
  const busy = !!(
    robot.task ||
    robot.service ||
    robot.construction ||
    robot.cargo ||
    robot.transit ||
    robot.returning
  );
  const issue =
    !Number.isInteger(x) || !Number.isInteger(y)
      ? "坐标须为整数"
      : placementIssue(factory, { x, y }, undefined, d?.id);
  const authorized = robot.allowed_zones.includes(factory.id);
  return (
    <fieldset>
      <legend>蓝图施工 · 当前厂区</legend>
      <p>
        先在仓库准备 1 个成品设备，再选安装位置。机器人补满能量后取货，到场施工
        10 秒完成安装；每次施工一格。取消后会把设备运回仓库。
      </p>
      <label>
        安装设备
        <select
          aria-label="蓝图设备"
          disabled={disabled}
          value={d?.id ?? ""}
          onChange={(e) => setType(e.target.value)}
        >
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        X 坐标
        <input
          aria-label="蓝图 X 坐标"
          type="number"
          min={-10}
          max={10}
          step={1}
          value={Number.isNaN(x) ? "" : x}
          disabled={disabled}
          onChange={(e) => setX(e.target.valueAsNumber)}
        />
      </label>
      <label>
        Y 坐标
        <input
          aria-label="蓝图 Y 坐标"
          type="number"
          min={-10}
          max={10}
          step={1}
          value={Number.isNaN(y) ? "" : y}
          disabled={disabled}
          onChange={(e) => setY(e.target.valueAsNumber)}
        />
      </label>
      <label>
        安装方向
        <select
          aria-label="蓝图方向"
          disabled={disabled}
          value={rotation}
          onChange={(e) =>
            setRotation(Number(e.target.value) as typeof rotation)
          }
        >
          {([0, 90, 180, 270] as const).map((n) => (
            <option key={n} value={n}>
              {n}°
            </option>
          ))}
        </select>
      </label>
      <label>
        安装后配方
        <select
          aria-label="蓝图配方"
          disabled={disabled}
          value={recipe?.id ?? ""}
          onChange={(e) => setRecipeID(e.target.value)}
        >
          <option value="">暂不配置</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <small>
        消耗：{catalog.items.find((i) => i.id === d?.item)?.name ?? "设备"} ×
        1（归属厂 WH）。
        {robot.home_factory_id === factory.id
          ? `库存 ${factory.simulation?.warehouse[d?.item ?? ""] ?? 0}`
          : "切换归属厂可查看库存"}
        ；在建格位预留，保留现场邻格与返程通道。
      </small>
      {issue && <p role="status">{issue}</p>}
      {!authorized && <p>请先授权当前厂区。</p>}
      <button
        disabled={
          disabled ||
          busy ||
          !d ||
          !!issue ||
          !authorized ||
          !robot.enabled ||
          robot.energy_kj !== spec.energy_capacity_kj
        }
        onClick={() =>
          act({
            type: "robot_construct",
            id: robot.id,
            blueprint: {
              id: crypto.randomUUID(),
              factory_id: factory.id,
              building_type: d!.id,
              x,
              y,
              rotation,
              ...(recipe ? { recipe_id: recipe.id } : {}),
            },
          })
        }
      >
        装载设备并开始施工
      </button>
    </fieldset>
  );
}
