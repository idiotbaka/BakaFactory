import { useState } from "react";
import {
  ioCost,
  ioLimit,
  ioUnlocked,
  pickupType,
  intakeType,
} from "./local/warehouseIO";
import { itemDefinitions } from "./local/catalog";
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
  const stage = factory.simulation?.industry?.stage ?? 1;
  const unlocked = ioUnlocked(factory.simulation);
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
          <article className="world-district-card" key={d.id}>
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
            {unlocked && (
              <div
                className="world-io-upgrades"
                aria-label={`${d.name} IO 升级`}
              >
                {([pickupType, intakeType] as const).map((type) => {
                  const count =
                    (type === pickupType
                      ? d.pickup_terminals
                      : d.intake_terminals) ?? 0;
                  const limit = ioLimit(stage, type);
                  const cost = ioCost(stage, type);
                  const [item, value] = Object.entries(cost)[0];
                  const enough =
                    (factory.simulation?.warehouse[item] ?? 0) >= -value;
                  const label = type === pickupType ? "取货终端" : "存入终端";
                  return (
                    <div key={type}>
                      <span>
                        {label}：{count} / {limit}
                      </span>
                      <button
                        disabled={disabled || count >= limit || !enough}
                        onClick={() =>
                          act({ type: "upgrade_io", id: d.id, terminal: type })
                        }
                      >
                        {count >= limit
                          ? "已达阶段上限"
                          : `增设${label} · ${itemDefinitions.get(item)?.name} 30${enough ? "" : "（不足）"}`}
                      </button>
                    </div>
                  );
                })}
                <small>每次增设需一个安全空格，终端可拖动、不可删除。</small>
              </div>
            )}
          </article>
        ))}
      </div>
      {unlocked && (
        <p>
          IO 累计上限：P2 取货 2 / 存入 1；P3 取货 4 / 存入 2；P4 起取货 6 /
          存入 3。费用按当前阶段计算。初装取货终端暂停，选好物品后启用。
        </p>
      )}
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
