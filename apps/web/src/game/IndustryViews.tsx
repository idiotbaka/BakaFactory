import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { IndustryAction } from "./local/industry";
import {
  workshopBatchLimit,
  workshopMachines,
  workshopMachineAvailable,
  workshopDuration,
  clampWorkshopBatches,
} from "./local/workshop";
import DefinitionIcon from "./DefinitionIcon";
import { PowerOverview } from "./PowerPanel";
import WorldPanel from "./WorldPanel";
import RobotPanel from "./RobotPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import DeveloperToolsPanel from "./DeveloperToolsPanel";
import QuestPanel from "./QuestPanel";
import { ItemInfoProvider, ItemName } from "./ItemInfo";
import WarehouseOrderDialog, {
  type PlaceWorkshopOrder,
} from "./WarehouseOrderDialog";
import { ordersUnlocked } from "./local/progression";
import { questVisible } from "./local/questRules";
import { orderRecipes } from "./local/orders";
import type { Observation } from "./local/observations";
import type { LocalFactory } from "./local/state";
import type { DistrictSummary, WorldAction } from "./local/world";

export type IndustryView =
  | "factory"
  | "quests"
  | "workshop"
  | "warehouse"
  | "power"
  | "world"
  | "robots"
  | "diagnostics"
  | "developer";
export default function IndustryViews({
  factory,
  catalog,
  disabled,
  act,
  children,
  districts = [],
  world,
  view,
  onViewChange,
  selectedRobotID,
  onSelectRobot,
  onLocateRobot,
  observation,
  onLocateBuilding,
  onOrder,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  disabled: boolean;
  act: (action: IndustryAction) => void;
  children: ReactNode;
  districts?: DistrictSummary[];
  world?: (action: WorldAction) => void;
  view: IndustryView;
  onViewChange: (view: IndustryView) => void;
  selectedRobotID?: string | null;
  onSelectRobot?: (id: string) => void;
  onLocateRobot?: React.ComponentProps<typeof RobotPanel>["onLocateRobot"];
  observation?: Observation;
  onLocateBuilding?: (id: string) => void;
  onOrder?: PlaceWorkshopOrder;
}) {
  const [query, setQuery] = useState("");
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const [selectedMachine, setSelectedMachine] = useState<string>("m02");
  const [orderItem, setOrderItem] = useState<string>();
  const closeOrder = useCallback(() => setOrderItem(undefined), []);
  const s = factory.simulation,
    p = s?.industry,
    job = p?.workshop;
  const orderable = useMemo(
    () =>
      new Set(orderRecipes(p, catalog).flatMap((r) => Object.keys(r.outputs))),
    [p, catalog],
  );
  const canOrder = ordersUnlocked(p);
  const stage = catalog.stages?.find((x) => x.tier === (p?.stage ?? 1));
  const headquarters =
    !districts.length ||
    !!districts.find((d) => d.id === factory.id)?.headquarters;
  const workshopMachine = workshopMachineAvailable(p?.crafted, selectedMachine)
    ? selectedMachine
    : "m02";
  const recipes = catalog.recipes.filter(
    (r) =>
      r.building_type === workshopMachine &&
      (r.tier ?? 1) <= (p?.stage ?? 1) &&
      `${r.id}${r.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const name = (id: string) =>
    catalog.items.find((i) => i.id === id)?.name ?? id;
  const ingredients = (values: Record<string, number>, input: boolean) => (
    <section
      className="workshop-material-group"
      aria-label={input ? "每批原料" : "每批产物"}
    >
      <h4>{input ? "每批原料" : "每批产物"}</h4>
      <ul className="workshop-materials">
        {Object.entries(values).map(([id, n]) => {
          const item = catalog.items.find((i) => i.id === id),
            stock = s?.warehouse[id] ?? 0;
          return (
            <li
              key={id}
              className={`workshop-material-card${input && stock < n ? " is-short" : ""}`}
            >
              {item && <DefinitionIcon definition={item} compact />}
              <div>
                <strong>
                  <ItemName item={id} />
                </strong>
                <span>
                  存 {stock.toLocaleString()} / {input ? "需" : "产"}{" "}
                  {n.toLocaleString()}
                  {input && stock < n ? " · 不足" : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
  return (
    <>
      <nav className="industry-tabs" aria-label="工厂视图">
        {(
          [
            ["factory", "工厂"],
            ["quests", "任务"],
            ["workshop", "工作室"],
            ["warehouse", "仓库"],
            ["power", "能源"],
            ["world", "厂区"],
            ["robots", "机器人"],
            ["diagnostics", "诊断"],
            ["developer", "开发者工具"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => {
              closeOrder();
              onViewChange(id);
            }}
          >
            {label}
            {id === "quests" &&
              catalog.quests?.some(
                (q) =>
                  questVisible(p, q, catalog.quests) &&
                  p?.quests?.completed.includes(q.id) &&
                  !p.quests.claimed.includes(q.id),
              ) && (
                <span
                  className="quest-unclaimed-dot"
                  role="img"
                  aria-label="有任务奖励待领取"
                />
              )}
          </button>
        ))}
        <span title={stage?.goal}>
          P{p?.stage ?? 1} · {stage?.name ?? "灰烬与拾荒"}
        </span>
      </nav>
      <div className="industry-editor" hidden={view !== "factory"}>
        {children}
      </div>
      {view !== "factory" && (
        <ItemInfoProvider
          key={`${factory.id}:${view}`}
          catalog={catalog}
          industry={p}
        >
          <div className="industry-content">
            <div className="industry-heading">
              <h3>
                {view === "quests"
                  ? "阶段任务"
                  : view === "developer"
                    ? "开发者工具"
                    : view === "diagnostics"
                      ? "闭环诊断"
                      : view === "workshop"
                        ? "拾荒工作室"
                        : view === "robots"
                          ? "机器人调度"
                          : view === "world"
                            ? "厂区管理"
                            : view === "power"
                              ? "能量网络"
                              : "物料仓库"}
              </h3>
              {view !== "power" &&
                view !== "quests" &&
                view !== "world" &&
                view !== "robots" &&
                view !== "developer" &&
                view !== "diagnostics" && (
                  <input
                    aria-label="搜索工作室或仓库"
                    placeholder="搜索名称或编号"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                )}
            </div>
            <p className="industry-goal" hidden={view === "developer"}>
              {stage?.goal}
              <br />
              阶段成果：{stage && name(stage.milestone_item)}。
              {(p?.stage ?? 1) < 6
                ? "完成本阶段其他任务的至少一半后开放终局任务；完成并领取终局奖励后永久解锁下一阶段。"
                : "首次制造智能机器人，达成六阶段主目标。"}
            </p>
            {view === "developer" ? (
              <DeveloperToolsPanel
                factory={factory}
                disabled={disabled}
                act={world}
              />
            ) : view === "quests" ? (
              <QuestPanel
                factory={factory}
                catalog={catalog}
                disabled={disabled}
                act={world}
              />
            ) : view === "diagnostics" ? (
              <DiagnosticsPanel
                factory={factory as LocalFactory}
                observation={observation}
                onLocate={onLocateBuilding}
              />
            ) : view === "robots" && world ? (
              <RobotPanel
                factory={factory}
                catalog={catalog}
                districts={districts}
                disabled={disabled}
                act={world}
                selectedRobotID={selectedRobotID}
                onSelectRobot={onSelectRobot}
                onLocateRobot={onLocateRobot}
              />
            ) : view === "world" && world ? (
              <WorldPanel
                factory={factory}
                districts={districts}
                disabled={disabled}
                act={world}
              />
            ) : view === "power" ? (
              <PowerOverview factory={factory} />
            ) : view === "workshop" && !headquarters ? (
              <p>
                共用手工工作室位于起始回收场，请在“厂区”切回后操作。其他厂区仍同步生产。
              </p>
            ) : view === "workshop" ? (
              <>
                <div className="scavenge-box">
                  <div>
                    <strong>无尽垃圾堆</strong>
                    <p>
                      先拾取 12
                      包垃圾，选择基础分拣。手工设备共用一条队列；工厂地图上的设备独立生产。
                    </p>
                  </div>
                  <button
                    disabled={disabled}
                    onClick={() => act({ type: "scavenge" })}
                  >
                    拾取 1 包垃圾{" "}
                    <span>
                      （{s?.warehouse[catalog.root_item ?? ""] ?? 0}）
                    </span>
                  </button>
                </div>
                <section
                  className="workshop-controls"
                  aria-label="工作室快捷操作"
                >
                  <div
                    className="workshop-machine-tabs"
                    role="group"
                    aria-label="工作室设备"
                  >
                    {workshopMachines.map((id) => {
                      const unlocked = workshopMachineAvailable(p?.crafted, id),
                        machine = catalog.buildings.find((b) => b.id === id);
                      return (
                        <span
                          className="workshop-machine-tab"
                          key={id}
                          title={
                            unlocked
                              ? undefined
                              : "至少需要生产 1 次该设备后才能解锁"
                          }
                        >
                          <button
                            type="button"
                            disabled={!unlocked}
                            aria-pressed={id === workshopMachine}
                            onClick={() => setSelectedMachine(id)}
                          >
                            {machine?.name ?? id}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </section>
                <div className="workshop-recipes">
                  {recipes.map((r) => {
                    const maximum = workshopBatchLimit(r, s?.warehouse ?? {}),
                      raw = clampWorkshopBatches(
                        batchCounts[r.id] ?? "1",
                        maximum,
                      ),
                      batches = Number(raw),
                      valid =
                        raw.trim() !== "" &&
                        Number.isSafeInteger(batches) &&
                        batches >= 1 &&
                        batches <= maximum;
                    return (
                      <article className="recipe-card" key={r.id}>
                        <div className="recipe-name">
                          {r.name}
                          <span>手工 {workshopDuration(r)}s</span>
                        </div>
                        <p>
                          {r.id.toUpperCase()} ·{" "}
                          {
                            catalog.buildings.find(
                              (b) => b.id === r.building_type,
                            )?.name
                          }
                        </p>
                        {ingredients(r.inputs, true)}
                        {ingredients(r.outputs, false)}
                        <form
                          className="workshop-batch"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!disabled && !job && valid)
                              act({ type: "workshop", recipe: r.id, batches });
                          }}
                        >
                          <label>
                            加工批数
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={maximum}
                              step={1}
                              required
                              aria-label={`${r.name}加工批数`}
                              aria-invalid={!valid && maximum > 0}
                              value={raw}
                              disabled={disabled || !!job || maximum < 1}
                              onChange={(event) =>
                                setBatchCounts((previous) => ({
                                  ...previous,
                                  [r.id]: clampWorkshopBatches(
                                    event.target.value,
                                    maximum,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={disabled || !!job || !valid}
                          >
                            批量加工
                          </button>
                        </form>
                        <p>当前可加工 {maximum} 批 · 单次最多 100 批</p>
                        {!valid && maximum > 0 && !job && (
                          <p className="batch-validation">
                            请输入 1～{maximum} 的整数批数。
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
                {!recipes.length && (
                  <p>当前设备下没有匹配的已解锁配方，请调整搜索条件。</p>
                )}
              </>
            ) : (
              <section className="industry-warehouse" aria-label="当前厂区库存">
                {catalog.items
                  .filter(
                    (i) =>
                      ((s?.warehouse[i.id] ?? 0) > 0 ||
                        (canOrder && orderable.has(i.id))) &&
                      `${i.name}${i.code}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((i) => (
                    <article
                      key={i.id}
                      className={
                        canOrder && orderable.has(i.id)
                          ? "warehouse-orderable"
                          : undefined
                      }
                    >
                      {canOrder && orderable.has(i.id) && (
                        <button
                          className="warehouse-order-trigger"
                          type="button"
                          aria-label={`下单${i.name}`}
                          disabled={
                            disabled || !headquarters || !!job || !onOrder
                          }
                          title={
                            !headquarters
                              ? "请切回起始回收场下单，订单使用起始仓库"
                              : undefined
                          }
                          onClick={() => setOrderItem(i.id)}
                        >
                          下单
                        </button>
                      )}
                      <DefinitionIcon definition={i} compact />
                      <strong>
                        <ItemName item={i.id} />
                      </strong>
                      <span>
                        {(s?.warehouse[i.id] ?? 0).toLocaleString()} u
                      </span>
                    </article>
                  ))}
                {!Object.values(s?.warehouse ?? {}).some((n) => n > 0) && (
                  <p>
                    {canOrder
                      ? "仓库暂无存量；可预览下单计划，缺少的材料需先备齐。"
                      : "仓库为空，前往工作室拾取第一包垃圾。"}
                  </p>
                )}
              </section>
            )}
            {view === "warehouse" && orderItem && (
              <WarehouseOrderDialog
                key={`${factory.id}:${orderItem}`}
                item={orderItem}
                factory={factory}
                catalog={catalog}
                disabled={disabled || !headquarters}
                onConfirm={onOrder}
                onClose={closeOrder}
              />
            )}
          </div>
        </ItemInfoProvider>
      )}
    </>
  );
}
