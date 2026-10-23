import { useState } from "react";
import type { FactoryDetail } from "../api/client";
import {
  districtLimit,
  type DistrictSummary,
  type WorldAction,
} from "./local/world";

export default function WorldPanel({
  factory,
  districts,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  districts: DistrictSummary[];
  disabled: boolean;
  act: (action: WorldAction) => void;
}) {
  const [name, setName] = useState("");
  return (
    <section className="world-panel" aria-label="厂区管理">
      <h3>
        厂区 · {districts.length} /{" "}
        {districtLimit(factory.simulation?.industry?.stage ?? 1)}
      </h3>
      <p>
        各厂区同步生产，所有 WH
        共用总仓库和唯一手工工作室，可在任意厂区拾荒、加工；设备缓存、产线物流和能源网络独立，地图垃圾提取口仍仅限起始回收场。
      </p>
      <div className="world-districts">
        {districts.map((d) => (
          <button
            key={d.id}
            disabled={disabled}
            aria-pressed={factory.id === d.id}
            onClick={() => act({ type: "select_district", id: d.id })}
          >
            <strong>{d.name}</strong>
            <small>
              {d.headquarters ? "起始回收场 · " : ""}
              {d.buildings} 建筑 · tick {d.tick}
            </small>
          </button>
        ))}
      </div>
      <label>
        厂区名称
        <input
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          placeholder="新厂区或当前厂区名称"
        />
      </label>
      <button
        disabled={disabled || !name.trim()}
        onClick={() => act({ type: "rename_district", id: factory.id, name })}
      >
        重命名当前厂区
      </button>
      <button
        disabled={
          disabled ||
          !name.trim() ||
          districts.length >=
            districtLimit(factory.simulation?.industry?.stage ?? 1)
        }
        onClick={() => act({ type: "expand_district", name })}
      >
        扩建厂区：总仓库基础铁板 20 + 简易支架 10
      </button>
      <small>
        阶段上限：6 / 12 / 24 / 40 / 70 /
        100。切换或更名不产出物品，也不复制队列。
      </small>
    </section>
  );
}
