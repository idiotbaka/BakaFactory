import type {
  BuildingDefinition,
  BuildingInstance,
  FactoryDetail,
} from "../api/client";
import type { IndustryAction } from "./local/industry";
import { isSolidTransport } from "./local/transportConfig";
import { powerPriority, producerKind } from "./local/power";
import { itemID, selectedRecipe } from "./local/catalog";

export const powerNames = {
  shaft: "轴功",
  hydraulic: "液压",
  electric: "电力",
};
export { default as PowerOverview } from "./EnergyOverview";
export function UtilityInspector({
  factory,
  definition,
  instance,
  act,
  disabled,
}: {
  factory: FactoryDetail;
  definition: BuildingDefinition;
  instance: BuildingInstance;
  act: (action: IndustryAction) => void;
  disabled: boolean;
}) {
  const m = factory.simulation?.buildings[instance.id];
  if (!m) return null;
  const battery = definition.role === "battery",
    generator = !!producerKind(definition.id),
    conduit = ["shaft", "cable", "hydraulic_line"].includes(definition.id);
  const network = factory.simulation?.networks?.find(
      (n) => n.id === m.network_id,
    ),
    recipe = selectedRecipe(instance);
  const hasNetwork =
    (!!definition.energy && !["none", "heat"].includes(definition.energy)) ||
    generator ||
    battery ||
    conduit;
  const capacity = definition.capacity_kj ?? 15000;
  const reserve =
    typeof instance.configuration.reserve_kj === "number"
      ? instance.configuration.reserve_kj
      : 0;
  return (
    <section
      className="logistics-settings utility-settings"
      aria-label="能源设置"
    >
      <h4>能源与运行</h4>
      {!isSolidTransport(definition.id) && (
        <button
          disabled={disabled}
          aria-pressed={instance.configuration.enabled !== false}
          onClick={() =>
            act({
              type: "power_config",
              id: instance.id,
              enabled: instance.configuration.enabled === false,
            })
          }
        >
          {instance.configuration.enabled === false ? "启用设备" : "暂停设备"}
        </button>
      )}
      {generator && (
        <p>
          额定输出 {definition.power_kw} kW · 本秒输出 {m.generated_kw ?? 0} kJ
        </p>
      )}
      {recipe && (
        <p>
          工艺功率 {recipe.power_kw ?? 0} kW · 本秒获得 {m.supplied_kw ?? 0} kJ
          <br />
          工作能量储备 {m.work_energy_kj ?? 0} kJ（不足一秒工时会保留）
        </p>
      )}
      {definition.role === "station" && (
        <p>
          补能站储备 {m.station_energy_kj ?? 0} /{" "}
          {definition.station_capacity_kj} kJ
          <br />
          机器人共享补给上限 {definition.station_transfer_kw}{" "}
          kW。只分配已获得的实际能量，满站停止取能；拆站散失储能。
        </p>
      )}
      {hasNetwork && (
        <>
          <p>
            {network
              ? `${powerNames[network.kind]}网 · 可用 ${network.capacity_kw} / 需求 ${network.demand_kw} kW`
              : "尚未连接能量网络"}
          </p>
          {!conduit && (
            <>
              <label>
                负载优先级
                <select
                  aria-label="负载优先级"
                  disabled={disabled}
                  value={powerPriority(instance)}
                  onChange={(e) =>
                    act({
                      type: "power_config",
                      id: instance.id,
                      priority: Number(e.target.value),
                    })
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === 1
                        ? " · 关键供能 / 供料"
                        : n === 6
                          ? " · 可延后负载"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                供能连接侧
                <select
                  aria-label="供能连接侧"
                  disabled={disabled}
                  value={
                    typeof instance.configuration.power_side === "number"
                      ? instance.configuration.power_side
                      : -1
                  }
                  onChange={(e) =>
                    act({
                      type: "power_config",
                      id: instance.id,
                      power_side: Number(e.target.value),
                    })
                  }
                >
                  <option value={-1}>自动（东 / 南 / 西 / 北）</option>
                  <option value={0}>东</option>
                  <option value={90}>南</option>
                  <option value={180}>西</option>
                  <option value={270}>北</option>
                </select>
              </label>
            </>
          )}
        </>
      )}
      {definition.id === "m21" && (
        <>
          <p>
            闭环工作液 {m.medium ?? 0} / 10 u；至少 1 u 才能输出液压。先用 R3012
            混配，再收取并注入；不赠送介质。
          </p>
          <button
            disabled={
              disabled ||
              (m.medium ?? 0) >= 10 ||
              !(factory.simulation?.warehouse[itemID("液压工作液")] ?? 0)
            }
            onClick={() => act({ type: "prime", id: instance.id, count: 1 })}
          >
            注入 1 u 工作液
          </button>
          <button
            disabled={disabled || !(m.medium ?? 0)}
            onClick={() => act({ type: "drain_medium", id: instance.id })}
          >
            排回启动工作液
          </button>
        </>
      )}
      {definition.id === "m20" && (
        <p>可用液压或高压蒸汽供能。1 u 蒸汽释放 100 kJ，放入独立燃料缓存。</p>
      )}
      {battery && (
        <>
          <strong>
            储能 {(m.charge_kj ?? 0).toLocaleString()} /{" "}
            {capacity.toLocaleString()} kJ
          </strong>
          <progress
            aria-label="储存电量"
            max={capacity}
            value={m.charge_kj ?? 0}
          />
          <label>
            充放模式
            <select
              aria-label="储能模式"
              disabled={disabled}
              value={
                typeof instance.configuration.battery_mode === "string"
                  ? instance.configuration.battery_mode
                  : "auto"
              }
              onChange={(e) =>
                act({
                  type: "power_config",
                  id: instance.id,
                  battery_mode: e.target.value as
                    "auto" | "charge" | "discharge" | "hold",
                })
              }
            >
              <option value="auto">自动充放</option>
              <option value="charge">只充电</option>
              <option value="discharge">只放电</option>
              <option value="hold">保留电量</option>
            </select>
          </label>
          <label>
            关键负载保留
            <select
              aria-label="储备电量"
              disabled={disabled}
              value={reserve}
              onChange={(e) =>
                act({
                  type: "power_config",
                  id: instance.id,
                  reserve_kj: Number(e.target.value),
                })
              }
            >
              {[
                ...new Set([
                  0,
                  Math.floor(capacity / 4),
                  Math.floor(capacity / 2),
                  capacity,
                  reserve,
                ]),
              ]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()} kJ
                  </option>
                ))}
            </select>
          </label>
          <p>移动保留电量；拆除仅返还设备，储存电能散失。</p>
        </>
      )}
    </section>
  );
}
