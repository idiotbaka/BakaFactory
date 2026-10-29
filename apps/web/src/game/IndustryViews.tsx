import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { IndustryAction } from "./local/industry";
import {
  workshopBatchLimit,
  workshopMachines,
  workshopMachineAvailable,
  workshopDuration,
  clampWorkshopBatches,
  workshopMachineName,
} from "./local/workshop";
import DefinitionIcon from "./DefinitionIcon";
import WarehouseInventory from "./WarehouseInventory";
import { createCatalogSearch } from "./catalogSearch";
import { PowerOverview } from "./PowerPanel";
import WorldPanel from "./WorldPanel";
import RobotPanel from "./RobotPanel";
import type { RobotSection } from "./RobotPanel";
import type { RobotTaskDraftControls } from "./robotTaskDraft";
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
import type { DistrictSummary, WorldAction } from "./local/world";
import { DEFAULT_TPS } from "./local/tickRate";

export type IndustryView =
  | "factory"
  | "quests"
  | "workshop"
  | "warehouse"
  | "power"
  | "world"
  | "robots"
  | "developer";
export default function IndustryViews({
  factory,
  catalog,
  disabled,
  act,
  children,
  districts = [],
  world,
  view: requestedView,
  developerToolsVisible = false,
  tickRate = DEFAULT_TPS,
  onTickRateChange,
  onViewChange,
  selectedRobotID,
  onSelectRobot,
  onLocateRobot,
  robotTaskControls,
  robotSection,
  onRobotSectionChange,
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
  developerToolsVisible?: boolean;
  tickRate?: number;
  onTickRateChange?: (value: number) => void;
  onViewChange: (view: IndustryView) => void;
  selectedRobotID?: string | null;
  onSelectRobot?: (id: string) => void;
  onLocateRobot?: React.ComponentProps<typeof RobotPanel>["onLocateRobot"];
  robotTaskControls?: RobotTaskDraftControls;
  robotSection?: RobotSection;
  onRobotSectionChange?: (section: RobotSection) => void;
  observation?: Observation;
  onLocateBuilding?: (id: string) => void;
  onOrder?: PlaceWorkshopOrder;
}) {
  const view =
    requestedView === "developer" && !developerToolsVisible
      ? "factory"
      : requestedView;
  const [query, setQuery] = useState("");
  const [warehouseStage, setWarehouseStage] = useState("all");
  const [warehouseType, setWarehouseType] = useState("all");
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const [selectedMachine, setSelectedMachine] = useState<string>("m02");
  const [workshopTarget, setWorkshopTarget] = useState<{
    id: string;
    factoryID: string;
  }>();
  const content = useRef<HTMLDivElement>(null);
  const workshopControls = useRef<HTMLElement>(null);
  const recipeCards = useRef(new Map<string, HTMLElement>());
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
  const workshopMachine = workshopMachineAvailable(p?.crafted, selectedMachine)
    ? selectedMachine
    : "m02";
  const matchesCatalog = createCatalogSearch(query);
  const recipes = catalog.recipes.filter(
    (r) =>
      r.building_type === workshopMachine &&
      (r.tier ?? 1) <= (p?.stage ?? 1) &&
      matchesCatalog(r),
  );
  const openWorkshopRecipe = (id: string) => {
    const recipe = catalog.recipes.find((r) => r.id === id);
    if (
      !recipe ||
      !workshopMachineAvailable(p?.crafted, recipe.building_type) ||
      (recipe.tier ?? 1) > (p?.stage ?? 1) ||
      (recipe.gate && !p?.milestones.includes(recipe.gate))
    )
      return;
    closeOrder();
    setQuery("");
    setSelectedMachine(recipe.building_type);
    setWorkshopTarget({ id, factoryID: factory.id });
    onViewChange("workshop");
  };
  useLayoutEffect(() => {
    if (view !== "workshop" || workshopTarget?.factoryID !== factory.id) return;
    const scroller = content.current;
    const card = recipeCards.current.get(workshopTarget.id);
    if (!scroller || !card) return;
    // Scroll only the central pane and leave room for the wrapping sticky toolbar.
    scroller.scrollTop = Math.max(
      0,
      scroller.scrollTop +
        card.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        (workshopControls.current?.getBoundingClientRect().height ?? 0) -
        12,
    );
    card.focus({ preventScroll: true });
  }, [view, workshopTarget, factory.id]);
  const searchInput = (
    <input
      className={view === "workshop" ? "workshop-search" : undefined}
      aria-label="搜索工作室或仓库"
      placeholder="名称 / 编号 / 拼音"
      title="支持全拼、拼音首字母和部分内容"
      value={query}
      onChange={(e) => {
        setWorkshopTarget(undefined);
        setQuery(e.target.value);
      }}
    />
  );
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
            ["developer", "开发者工具"],
          ] as const
        )
          .filter(([id]) => id !== "developer" || developerToolsVisible)
          .map(([id, label]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => {
                closeOrder();
                setWorkshopTarget(undefined);
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
          onWorkshopRecipe={openWorkshopRecipe}
        >
          <div className="industry-content" ref={content}>
            <div className="industry-heading">
              <h3>
                {view === "quests"
                  ? "阶段任务"
                  : view === "developer"
                    ? "开发者工具"
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
              {view === "warehouse" && searchInput}
            </div>
            <p
              className="industry-goal"
              hidden={
                view === "developer" ||
                view === "robots" ||
                view === "power" ||
                view === "world"
              }
            >
              {stage?.goal}
            </p>
            {view === "developer" ? (
              <DeveloperToolsPanel
                factory={factory}
                disabled={disabled}
                act={world}
                observation={observation}
                onLocate={onLocateBuilding}
                tickRate={tickRate}
                onTickRateChange={onTickRateChange}
              />
            ) : view === "quests" ? (
              <QuestPanel
                factory={factory}
                catalog={catalog}
                disabled={disabled}
                act={world}
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
                {...robotTaskControls}
                section={robotSection}
                onSectionChange={onRobotSectionChange}
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
            ) : view === "workshop" ? (
              <>
                <div className="scavenge-box">
                  <div>
                    <strong>无尽垃圾堆</strong>
                    <p>从拾取 12 包垃圾并分拣开始吧~</p>
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
                  ref={workshopControls}
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
                              : `首次制造「${machine?.name ?? id}」后解锁工作室「${workshopMachineName(id) ?? id}」`
                          }
                        >
                          <button
                            type="button"
                            disabled={!unlocked}
                            aria-pressed={id === workshopMachine}
                            onClick={() => {
                              setWorkshopTarget(undefined);
                              setSelectedMachine(id);
                            }}
                          >
                            {workshopMachineName(id) ?? machine?.name ?? id}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  {searchInput}
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
                      <article
                        className="recipe-card"
                        key={r.id}
                        tabIndex={-1}
                        aria-label={`${r.id.toUpperCase()} ${r.name}`}
                        ref={(node) => {
                          if (node) recipeCards.current.set(r.id, node);
                          else recipeCards.current.delete(r.id);
                        }}
                      >
                        <div className="recipe-name">
                          {r.name}
                          <span>手工 {workshopDuration(r)}s</span>
                        </div>
                        <p>
                          {r.id.toUpperCase()} ·{" "}
                          {workshopMachineName(r.building_type) ??
                            catalog.buildings.find(
                              (b) => b.id === r.building_type,
                            )?.name}
                        </p>
                        {r.description && <p>{r.description}</p>}
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
              <WarehouseInventory
                factory={factory}
                catalog={catalog}
                query={query}
                canOrder={canOrder}
                orderable={orderable}
                orderDisabled={disabled || !!job || !onOrder}
                onOrder={setOrderItem}
                stage={warehouseStage}
                type={warehouseType}
                onStageChange={setWarehouseStage}
                onTypeChange={setWarehouseType}
              />
            )}
            {view === "warehouse" && orderItem && (
              <WarehouseOrderDialog
                key={`${factory.id}:${orderItem}`}
                item={orderItem}
                factory={factory}
                catalog={catalog}
                disabled={disabled}
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
