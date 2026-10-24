import { containsCell } from "./footprint";
import type {
  BuildingDefinition,
  BuildingInstance,
  Catalog,
  FactoryDetail,
  MachineState,
} from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import { DetailedProgress } from "./SimulationAnimation";
import type { IndustryAction } from "./local/industry";
import {
  selectedRecipe,
  isBelt,
  isPort,
  isChest,
  isFluidNode,
  beltTicks,
  beltCapacity,
} from "./local/catalog";
import { fuelValues } from "./local/fuel";
import LogisticsInspector from "./LogisticsInspector";
import { isSolidTransport } from "./local/transportConfig";
import { UtilityInspector } from "./PowerPanel";
import { isPowerFacility } from "./local/power";
import FluidInspector from "./FluidInspector";
import MachineBatchFeed from "./MachineBatchFeed";

export const machineStatuses: Record<string, string> = {
  idle: "待机",
  working: "生产中",
  no_input: "等待原料",
  output_full: "产物已满",
  transporting: "运输中",
  blocked: "下游阻塞",
  no_source: "等待来源物品",
  rejected: "目标白名单拒绝",
  transferring: "传输中",
  warehouse: "接收至总仓库",
  no_recipe: "请选择配方",
  locked: "阶段尚未解锁",
  no_energy: "缺少动力",
  condition_required: "等待真实作业记录",
  storage: "缓存存储",
  disabled: "已暂停",
  generating: "正在供能",
  charging: "正在充电",
  discharging: "正在放电",
  charged: "储能已满",
  connected: "网络已连接",
  no_network: "尚未接网",
  no_medium: "缺少启动工作液",
  no_fuel: "等待燃料",
  refueling: "正在为机器人补能",
  flowing: "流体输送中",
  fluid_full: "容器已满",
  fluid_stored: "流体已存储",
  dry: "等待流体",
  mixed: "禁止混液",
  flow_closed: "流路已关闭",
  no_connection: "下游尚未连接",
};
function Slots({
  title,
  values,
  catalog,
  slots,
}: {
  title: string;
  values: MachineState["input"];
  catalog: Catalog;
  slots: number;
}) {
  return (
    <section className="inventory-section">
      <h4>
        {title}
        <small>{slots} 格 · 每格 100</small>
      </h4>
      <div className="inventory-slots">
        {Array.from({ length: slots }, (_, i) => {
          const stack = values[i],
            item = stack && catalog.items.find((d) => d.id === stack.item);
          return (
            <div
              key={i}
              className={`inventory-slot ${stack ? "filled" : ""}`}
              title={item ? `${item.name} ${stack.count}/100` : "空格"}
            >
              {item ? (
                <>
                  <DefinitionIcon definition={item} compact />
                  <strong>{stack.count}</strong>
                  <small>{item.name}</small>
                </>
              ) : (
                <span>—</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function ProductionInspector({
  factory,
  catalog,
  definition,
  instance,
  act,
  disabled = false,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  definition: BuildingDefinition;
  instance?: BuildingInstance;
  act?: (action: IndustryAction) => void;
  disabled?: boolean;
}) {
  const machine = instance && factory.simulation?.buildings[instance.id];
  const port = isPort(definition.id);
  const isMachine =
    definition.category === "machine" &&
    catalog.recipes.some((r) => r.building_type === definition.id);
  const recipe = instance
    ? selectedRecipe(instance)
    : catalog.recipes.find((r) => r.building_type === definition.id);
  const duration =
    machine?.duration || (recipe ? recipe.duration_ms / 1000 : 0);
  let route;
  if (port && instance) {
    const delta = [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ][instance.rotation / 90];
    const neighbor = (offset: number) => {
      const x = instance.x + delta[0] * offset,
        y = instance.y + delta[1] * offset;
      const target = factory.buildings.find((b) => containsCell(b, { x, y }));
      return `${target ? catalog.buildings.find((d) => d.id === target.building_type)?.name : "空格"} (${x}, ${y})`;
    };
    route = (
      <div className="port-route">
        <span>来源：{neighbor(-1)}</span>
        <span>↓ 每批最多 {definition.batch_size ?? 1} 件</span>
        <span>目标：{neighbor(1)}</span>
      </div>
    );
  }
  return (
    <div className="production-inspector">
      {instance && (
        <div className={`machine-status status-${machine?.status ?? "idle"}`}>
          <span />
          {machineStatuses[machine?.status ?? "idle"] ?? "等待同步"}
        </div>
      )}
      {instance && act && isSolidTransport(definition.id) && (
        <LogisticsInspector
          key={instance.id}
          factory={factory}
          catalog={catalog}
          definition={definition}
          instance={instance}
          act={act}
          disabled={disabled}
        />
      )}
      {machine && isChest(definition.id) && (
        <Slots
          title="箱子缓存"
          values={machine.output}
          catalog={catalog}
          slots={definition.output_slots ?? 8}
        />
      )}
      {instance && act && isFluidNode(definition.id) && (
        <FluidInspector
          key={instance.id}
          factory={factory}
          catalog={catalog}
          definition={definition}
          instance={instance}
          act={act}
          disabled={disabled}
        />
      )}
      {instance &&
        act &&
        (definition.category === "machine" ||
          isPowerFacility(definition.id) ||
          definition.energy) && (
          <UtilityInspector
            factory={factory}
            definition={definition}
            instance={instance}
            act={act}
            disabled={disabled}
          />
        )}
      {machine && definition.role === "source" && (
        <>
          <DetailedProgress machine={machine} name="垃圾提取" />
          <Slots
            title="待运垃圾"
            values={machine.output}
            catalog={catalog}
            slots={1}
          />
        </>
      )}
      {instance &&
        machine &&
        act &&
        Object.keys(fuelValues(definition)).length > 0 && (
          <div className="machine-actions">
            <strong>燃料 · 未用能量 {machine.energy_kj ?? 0} kJ</strong>
            {Object.keys(fuelValues(definition)).map((id) => (
              <button
                key={id}
                disabled={disabled || !(factory.simulation?.warehouse[id] ?? 0)}
                onClick={() =>
                  act({ type: "fuel", id: instance.id, item: id, count: 1 })
                }
              >
                添加 1 {catalog.items.find((i) => i.id === id)?.name}（缓存{" "}
                {machine.fuel?.find((s) => s.item === id)?.count ?? 0}）
              </button>
            ))}
          </div>
        )}
      {isMachine && (
        <>
          <div className="input-whitelist">
            <strong>输入白名单</strong>
            <span>
              {definition.input_whitelist?.length
                ? definition.input_whitelist
                    .map(
                      (id) =>
                        catalog.items.find((item) => item.id === id)?.name ??
                        id,
                    )
                    .join("、")
                : "不接收输入"}
            </span>
          </div>
          {machine && (
            <>
              {act && instance && (
                <div className="machine-actions">
                  <label>
                    生产配方
                    <select
                      aria-label="生产配方"
                      disabled={disabled}
                      value={
                        typeof instance.configuration.recipe_id === "string"
                          ? instance.configuration.recipe_id
                          : ""
                      }
                      onChange={(e) =>
                        act({
                          type: "recipe",
                          id: instance.id,
                          recipe: e.target.value,
                        })
                      }
                    >
                      <option value="" disabled>
                        选择配方
                      </option>
                      {catalog.recipes
                        .filter((r) => r.building_type === definition.id)
                        .map((r) => (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={
                              (r.tier ?? 1) >
                              (factory.simulation?.industry?.stage ?? 1)
                            }
                          >
                            {r.id.toUpperCase()} · {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <MachineBatchFeed
                    key={`${instance.id}:${recipe?.id ?? ""}`}
                    id={instance.id}
                    recipe={recipe}
                    input={machine.input}
                    warehouse={factory.simulation?.warehouse ?? {}}
                    definition={definition}
                    disabled={disabled}
                    act={act}
                  />
                  <button
                    disabled={disabled || !machine.output.length}
                    onClick={() => act({ type: "collect", id: instance.id })}
                  >
                    收取全部产物
                  </button>
                  <button
                    disabled={disabled || !machine.input.length}
                    onClick={() =>
                      act({ type: "collect_input", id: instance.id })
                    }
                  >
                    取回输入（重置进度）
                  </button>
                </div>
              )}
              <Slots
                title="输入"
                values={machine.input}
                catalog={catalog}
                slots={definition.input_slots ?? 4}
              />
              {!!recipe?.conditions?.length && (
                <p className="production-hint">
                  每批完成时消费真实作业凭据：
                  {recipe.id === "r5048"
                    ? "40 次匹配搬运"
                    : recipe.id === "r5049"
                      ? "20 次巡检／维护"
                      : "30 次安装摄像头的有效作业"}
                  ；机器人须仍部署并启用。存量见“机器人 → 真实作业”。
                </p>
              )}
              <DetailedProgress
                key={instance?.id}
                machine={{ ...machine, duration }}
                name={recipe?.name ?? "生产进度"}
              />
              <Slots
                title="产物"
                values={machine.output}
                catalog={catalog}
                slots={definition.output_slots ?? 4}
              />
            </>
          )}
          {!instance && (
            <p className="production-hint">
              放置后点击机器，查看输入、产物与生产进度。每类物品最多占用一格。
            </p>
          )}
        </>
      )}
      {isBelt(definition.id) && (
        <p className="production-hint">
          容量 {beltCapacity(definition.id)} 件 · 每 {beltTicks(definition.id)}{" "}
          秒 1 格
          {machine?.belt ? (
            <>
              <br />
              当前：
              {
                catalog.items.find((item) => item.id === machine.belt?.item)
                  ?.name
              }{" "}
              · {machine.belt.count ?? 1} 件 ·{" "}
              {machine.belt.progress >= beltTicks(definition.id)
                ? "等待下游接收"
                : "格内运输中"}
            </>
          ) : (
            <>
              <br />
              当前为空
            </>
          )}
        </p>
      )}
      {port && (
        <>
          <p className="production-hint">
            箭头后方取出机器产物或就绪传送带物品，前方送入机器输入、传送带或
            工厂仓库。目标不接受时，物品留在来源。
          </p>
          {route}
        </>
      )}
      {definition.id === "bus" && (
        <p className="production-hint">
          相邻传送带指向工厂仓库，或通过 OUT / IN
          将物品送入工厂仓库，即自动计入上方总仓库。
        </p>
      )}
    </div>
  );
}
