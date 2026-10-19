import type {
  BuildingDefinition,
  BuildingInstance,
  Catalog,
  FactoryDetail,
  MachineState,
} from "../api/client";
import type { CSSProperties } from "react";
import DefinitionIcon from "./DefinitionIcon";
import { entityColor } from "./entityTheme";
import { DetailedProgress } from "./SimulationAnimation";

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
};
export function WarehousePanel({
  factory,
  catalog,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
}) {
  const simulation = factory.simulation;
  return (
    <section className="warehouse-panel" aria-label="玩家总仓库">
      <div>
        <span className="eyebrow">CARGO / 01</span>
        <strong>总仓库</strong>
        <small>Bus 自动入库 · 拆除物品回收</small>
      </div>
      <div className="warehouse-items">
        {catalog.items.map((item) => (
          <div
            className="warehouse-item"
            key={item.id}
            title={item.name}
            style={{ "--entity-color": entityColor(item) } as CSSProperties}
          >
            <DefinitionIcon definition={item} compact />
            <span>{item.name}</span>
            <strong>
              {(simulation?.warehouse[item.id] ?? 0).toLocaleString()}
            </strong>
          </div>
        ))}
      </div>
      <small className="simulation-clock">
        {simulation
          ? `Tick ${simulation.tick.toLocaleString()} · ${simulation.tick_rate} TPS`
          : "等待生产状态…"}
      </small>
    </section>
  );
}
function Slots({
  title,
  values,
  catalog,
}: {
  title: string;
  values: MachineState["input"];
  catalog: Catalog;
}) {
  return (
    <section className="inventory-section">
      <h4>
        {title}
        <small>4 格 · 每格 100</small>
      </h4>
      <div className="inventory-slots">
        {Array.from({ length: 4 }, (_, i) => {
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
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  definition: BuildingDefinition;
  instance?: BuildingInstance;
}) {
  const machine = instance && factory.simulation?.buildings[instance.id];
  const port =
    definition.id === "item_input" || definition.id === "item_output";
  const isMachine = definition.category === "machine";
  const recipe = catalog.recipes.find((r) => r.building_type === definition.id);
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
      const target = factory.buildings.find((b) => b.x === x && b.y === y);
      return `${target ? catalog.buildings.find((d) => d.id === target.building_type)?.name : "空格"} (${x}, ${y})`;
    };
    route = (
      <div className="port-route">
        <span>来源：{neighbor(-1)}</span>
        <span>↓ 每秒最多 1 件</span>
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
              <Slots title="输入" values={machine.input} catalog={catalog} />
              <DetailedProgress
                key={instance?.id}
                machine={{ ...machine, duration }}
                name={recipe?.name ?? "生产进度"}
              />
              <Slots title="产物" values={machine.output} catalog={catalog} />
            </>
          )}
          {!instance && (
            <p className="production-hint">
              放置后点击机器，查看输入、产物与生产进度。每类物品最多占用一格。
            </p>
          )}
        </>
      )}
      {definition.id === "conveyor" && (
        <p className="production-hint">
          容量 1 件 · 每秒 1 格
          {machine?.belt ? (
            <>
              <br />
              当前：
              {
                catalog.items.find((item) => item.id === machine.belt?.item)
                  ?.name
              }{" "}
              · {machine.belt.progress >= 1 ? "等待下游接收" : "格内运输中"}
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
            Bus。目标不接受时，物品留在来源。
          </p>
          {route}
        </>
      )}
      {definition.id === "bus" && (
        <p className="production-hint">
          相邻传送带指向 Bus，或通过 OUT / IN 将物品送入
          Bus，即自动计入上方总仓库。
        </p>
      )}
    </div>
  );
}
