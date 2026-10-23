import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ApiError,
  type Catalog,
  type Definition,
  type FactoryDetail,
  type BuildingInstance,
  type User,
} from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import FactoryEditor from "./FactoryEditor";
import { ProductionInspector } from "./ProductionPanel";
import { isLogisticsBuilding } from "./catalogPresentation";
import WorkshopHud from "./WorkshopHud";
import BuildingRecipeGuide from "./BuildingRecipeGuide";
import BuildingOrderButton from "./BuildingOrderButton";
import QuestNotifications from "./QuestNotifications";
import StoryPlayer from "./stories/StoryPlayer";
import StoryMenu from "./stories/StoryMenu";
import { storyDefinitions } from "./stories/definitions";
import {
  openingStoryID,
  unlockedStoryIDs,
  type StoryID,
} from "./stories/progress";
import { SimulationAnimationProvider } from "./SimulationAnimation";
import { readPowerSaving, savePowerSaving } from "./displayPreferences";
import { installDeveloperConsole } from "./developerConsole";
import { entityColor } from "./entityTheme";
import HudPopover from "../HudPopover";
import { useLocalGame } from "./local/useLocalGame";
import { catalog as localCatalog } from "./local/state";
import IndustryViews, { type IndustryView } from "./IndustryViews";
import RobotInspector from "./RobotInspector";
import type { Robot } from "./local/robotRoutes";
import type { RobotFocus } from "./FactoryEditor";
import type { IndustryAction } from "./local/industry";
import type { WorldAction } from "./local/world";

type Workspace =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; catalog: Catalog; factory: FactoryDetail | null };
type Selection = { kind: "building" | "item"; id: string };
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "连接失败，请稍后重试";
}

export default function FactoryWorkspace({
  user,
  onSessionExpired,
}: {
  user: User;
  onSessionExpired: () => void;
}) {
  const game = useLocalGame(user, onSessionExpired);
  const workspace: Workspace =
    game.error && !game.ready
      ? { kind: "failed", message: game.error }
      : game.ready
        ? { kind: "ready", catalog: localCatalog, factory: game.factory }
        : { kind: "loading" };
  const [selection, setSelection] = useState<Selection>({
    kind: "building",
    id: "bus",
  });
  const [name, setName] = useState(
    [...`${user.display_name}的工厂`].slice(0, 32).join(""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const syncError = game.message;
  const [tab, setTab] = useState<"building" | "logistics" | "item">("building");
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [selectedInstanceID, setSelectedInstanceID] = useState<string | null>(
    null,
  );
  const [powerSaving, setPowerSaving] = useState(readPowerSaving);
  const [immersive, setImmersive] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogPhases, setCatalogPhases] = useState<
    Partial<Record<"building" | "logistics" | "item", number>>
  >({});
  const [industryView, setIndustryView] = useState<IndustryView>("factory");
  const [selectedRobotID, setSelectedRobotID] = useState<string | null>(null);
  const [robotFocus, setRobotFocus] = useState<RobotFocus>();
  const [replayStory, setReplayStory] = useState<StoryID | null>(null);
  const unlockedStories = unlockedStoryIDs(
    game.factory?.simulation.industry?.quests?.claimed,
  );
  const pendingStory = unlockedStories.find(
    (id) =>
      id !== openingStoryID &&
      game.pendingStories?.includes(id) &&
      !game.viewedStories?.includes(id),
  );
  const automaticStory =
    game.ready &&
    !game.factory &&
    !game.conflict &&
    !game.viewedStories?.includes(openingStoryID);
  const activeStoryID =
    replayStory ??
    (automaticStory
      ? openingStoryID
      : game.ready && game.factory && !game.conflict
        ? (pendingStory ?? null)
        : null);
  const noQuestNotices = useMemo(() => [], []);
  const robotRoute = useMemo(
    () =>
      selectedRobotID && game.factory
        ? game.runtime?.robotRoute?.(selectedRobotID)
        : undefined,
    [selectedRobotID, game.factory, game.runtime],
  );
  const paletteCatalog =
    workspace.kind === "ready" ? workspace.catalog : undefined;
  const activeFactoryID =
    workspace.kind === "ready" ? workspace.factory?.id : undefined;
  const stage = game.factory?.simulation.industry?.stage ?? 1;
  const phaseFor = (category: typeof tab) =>
    Math.min(catalogPhases[category] ?? stage, category === "item" ? 6 : stage);
  useEffect(() => savePowerSaving(powerSaving), [powerSaving]);
  useEffect(() => {
    if (!game.runtime) return;
    return installDeveloperConsole(game.runtime, () => {
      setIndustryView((current) =>
        current === "developer" ? "factory" : current,
      );
    });
  }, [game.runtime]);
  useEffect(() => {
    if (!activeFactoryID || !paletteCatalog) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input,textarea,select,[contenteditable="true"]',
          ))
      )
        return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setImmersive((value) => !value);
        return;
      }
      if (!/^[1-6]$/.test(event.key)) return;
      const definition = paletteCatalog.buildings.filter(
        (d) =>
          !d.fixed && !d.legacy && d.id !== "bus" && (d.tier ?? 1) <= stage,
      )[Number(event.key) - 1];
      if (!definition) return;
      event.preventDefault();
      setTab(isLogisticsBuilding(definition) ? "logistics" : "building");
      setCatalogPhases((previous) => ({
        ...previous,
        [isLogisticsBuilding(definition) ? "logistics" : "building"]:
          definition.tier ?? 1,
      }));
      setSelection({ kind: "building", id: definition.id });
      setSelectedInstanceID(null);
      setSelectedRobotID(null);
      setPlacementType((previous) =>
        previous === definition.id ? null : definition.id,
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [activeFactoryID, paletteCatalog, stage]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || workspace.kind !== "ready" || activeStoryID) return;
    setBusy(true);
    setError("");
    try {
      const factory = await game.runtime!.create(name);
      setSelection({ kind: "building", id: "bus" });
      setSelectedInstanceID(
        factory.buildings.find((b) => b.building_type === "bus")?.id ?? null,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function selectInstance(instance: BuildingInstance | null) {
    setSelectedRobotID(null);
    setSelectedInstanceID(instance?.id ?? null);
    if (instance) {
      setSelection({ kind: "building", id: instance.building_type });
      const definition = paletteCatalog?.buildings.find(
        (d) => d.id === instance.building_type,
      );
      setTab(
        definition && isLogisticsBuilding(definition)
          ? "logistics"
          : "building",
      );
      if (definition)
        setCatalogPhases((previous) => ({
          ...previous,
          [isLogisticsBuilding(definition) ? "logistics" : "building"]:
            definition.tier ?? 1,
        }));
    }
  }
  function applyFactory(snapshot: FactoryDetail, selectedID: string | null) {
    setError("");
    // A response may arrive after the player has switched palette tools.
    // Keep the active tool and inspector independent of the saved instance.
    if (!placementType)
      selectInstance(
        snapshot.buildings.find((b) => b.id === selectedID) ?? null,
      );
  }
  function editorError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) onSessionExpired();
    else setError(errorMessage(error));
  }
  function act(action: IndustryAction) {
    setError("");
    void game.runtime?.act(action).catch(editorError);
  }
  async function placeOrder(
    action: Extract<IndustryAction, { type: "order_workshop" }>,
  ) {
    setError("");
    if (!game.runtime) throw new Error("本地工厂尚未就绪");
    await game.runtime.act(action);
  }
  function world(action: WorldAction) {
    setError("");
    void game.runtime
      ?.world(action)
      .then(() => {
        if (action.type === "claim_quest") return;
        setSelectedInstanceID(null);
        setPlacementType(null);
        if (
          action.type === "select_district" ||
          action.type === "expand_district"
        ) {
          setSelectedRobotID(null);
          setRobotFocus(undefined);
        }
      })
      .catch(editorError);
  }
  function selectRobot(id: string) {
    setSelectedRobotID(id);
    setSelectedInstanceID(null);
    setPlacementType(null);
  }
  async function locateRobot(robot: Robot) {
    selectRobot(robot.id);
    const point = robot.transit
      ? {
          factory_id: robot.transit.to_factory_id,
          x: robot.transit.x,
          y: robot.transit.y,
        }
      : robot;
    try {
      if (point.factory_id !== game.factory?.id)
        await game.runtime!.world({
          type: "select_district",
          id: point.factory_id,
        });
      setIndustryView("factory");
      setRobotFocus((previous) => ({
        factory_id: point.factory_id,
        x: point.x,
        y: point.y,
        sequence: (previous?.sequence ?? 0) + 1,
      }));
    } catch (error) {
      editorError(error);
    }
  }
  if (workspace.kind === "loading")
    return (
      <div className="factory-loading" role="status">
        <span className="eyebrow">WORKSHOP / LOADING</span>
        <p>正在读取本地存档并校验登录…</p>
      </div>
    );
  if (workspace.kind === "failed")
    return (
      <div className="factory-loading">
        <p role="alert">{workspace.message}</p>
        <button className="primary-button" onClick={game.retry}>
          重新读取工厂
        </button>
      </div>
    );
  const { catalog, factory } = workspace;
  const placeable = catalog.buildings.filter(
    (d) => !d.fixed && !d.legacy && d.id !== "bus" && (d.tier ?? 1) <= stage,
  );
  const catalogPhase = phaseFor(tab);
  const definitions = (
    tab === "item"
      ? catalog.items.filter((i) => !i.legacy)
      : placeable.filter(
          (d) => isLogisticsBuilding(d) === (tab === "logistics"),
        )
  ).filter(
    (d) =>
      (d.tier ?? 1) === catalogPhase &&
      `${d.name}${d.code}`.toLowerCase().includes(catalogQuery.toLowerCase()),
  );
  const discoveredItems = new Set(
    factory?.simulation?.industry?.discovered_items ?? [],
  );
  const definition: Definition | undefined = (
    selection.kind === "building" ? catalog.buildings : catalog.items
  ).find((d) => d.id === selection.id);
  const buildingDefinition =
    selection.kind === "building"
      ? catalog.buildings.find((d) => d.id === selection.id)
      : undefined;
  const recipes = catalog.recipes.filter((r) =>
    selection.kind === "building"
      ? r.building_type === selection.id
      : Boolean(r.inputs[selection.id] || r.outputs[selection.id]),
  );
  const selectedInstance = factory?.buildings.find(
    (b) =>
      selection.kind === "building" &&
      b.id === selectedInstanceID &&
      b.building_type === selection.id,
  );
  const selectedRobot = factory?.robots?.find((r) => r.id === selectedRobotID);
  const lookupItem = (id: string) =>
    catalog.items.find((item) => item.id === id);
  const ingredients = (values: Record<string, number>) => (
    <div className="recipe-ingredients">
      {Object.entries(values).map(([id, amount]) => {
        const item = lookupItem(id);
        return (
          <span key={id}>
            {item && <DefinitionIcon definition={item} compact />}
            <span>
              {amount} × {item?.name ?? id}
            </span>
          </span>
        );
      })}
    </div>
  );
  return (
    <SimulationAnimationProvider
      factoryID={factory?.id}
      simulation={factory?.simulation}
      powerSaving={powerSaving}
      paused={game.paused}
    >
      <section
        className={`factory-workspace ${immersive ? "is-immersive" : ""} ${powerSaving ? "is-eco" : ""}`}
        aria-label="工厂工作台"
      >
        <div className="hud-strip">
          <div className="factory-toolbar">
            <div>
              <span className="eyebrow">SECTOR 01 / NEON DISTRICT</span>
              <h2 title={factory?.name}>{factory?.name ?? "你的第一座工厂"}</h2>
            </div>
            <div className="factory-toolbar-meta">
              <span className="mode-pill">
                <i />
                {game.paused ? "工厂暂停" : "本机生产"}
              </span>
              <span>
                {factory ? `${factory.width} × ${factory.height}` : "21 × 21"}{" "}
                格
              </span>
              <span>
                {factory?.buildings.filter(
                  (b) =>
                    factory.simulation?.buildings[b.id]?.status === "working",
                ).length ?? 0}{" "}
                台生产中
              </span>
              {factory?.simulation && (
                <span className="simulation-clock">
                  Tick {factory.simulation.tick.toLocaleString()} ·{" "}
                  {factory.simulation.tick_rate} TPS
                </span>
              )}
            </div>
          </div>
          <WorkshopHud
            factory={factory}
            catalog={catalog}
            paused={game.paused}
            blocked={game.workshopBlocked}
            canCancel
            onCancel={() => act({ type: "cancel_workshop" })}
          />
        </div>
        {syncError && (
          <p className="simulation-sync-error" role="status">
            {syncError}
            {game.conflict && (
              <>
                <button
                  disabled={!game.online || game.uploading}
                  onClick={() =>
                    void game.runtime?.chooseLocal().catch(editorError)
                  }
                >
                  保留本机并覆盖云端
                </button>
                <button
                  disabled={!game.online || game.uploading}
                  onClick={() => {
                    if (window.confirm("恢复云存档将替换本机进度，是否继续？"))
                      void game.runtime?.restoreCloud().catch(editorError);
                  }}
                >
                  恢复云存档
                </button>
              </>
            )}
          </p>
        )}
        <div className="factory-layout">
          <aside className="catalog-panel" aria-label="实体图鉴">
            <div className="panel-caption">
              <div>
                <small>CONSTRUCTION</small>建造阵列
              </div>
              <span>{placeable.length.toString().padStart(2, "0")} / 模组</span>
            </div>
            <div className="catalog-tabs" role="group" aria-label="图鉴分类">
              <button
                aria-pressed={tab === "building"}
                onClick={() => {
                  setTab("building");
                  setSelectedRobotID(null);
                  setPlacementType(null);
                  setSelection({ kind: "building", id: "bus" });
                  setSelectedInstanceID(
                    factory?.buildings.find((b) => b.building_type === "bus")
                      ?.id ?? null,
                  );
                }}
              >
                建筑
              </button>
              <button
                aria-pressed={tab === "logistics"}
                onClick={() => {
                  setTab("logistics");
                  setSelectedRobotID(null);
                  setPlacementType(null);
                  setSelectedInstanceID(null);
                  const first = placeable.find(
                    (d) =>
                      isLogisticsBuilding(d) &&
                      (d.tier ?? 1) === phaseFor("logistics"),
                  );
                  if (first) setSelection({ kind: "building", id: first.id });
                }}
              >
                物流
              </button>
              <button
                aria-pressed={tab === "item"}
                onClick={() => {
                  setTab("item");
                  setSelectedRobotID(null);
                  setPlacementType(null);
                  setSelection({
                    kind: "item",
                    id: catalog.items.find(
                      (i) => !i.legacy && (i.tier ?? 1) === phaseFor("item"),
                    )!.id,
                  });
                  setSelectedInstanceID(null);
                }}
              >
                物品
              </button>
            </div>
            <div className="catalog-filters">
              <input
                className="catalog-search"
                aria-label="搜索图鉴"
                placeholder="搜索名称 / 编号"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
              />
              <div
                className="catalog-phase-tabs"
                role="group"
                aria-label="图鉴阶段"
              >
                {[1, 2, 3, 4, 5, 6].map((tier) => {
                  const locked = tab !== "item" && tier > stage;
                  return (
                    <button
                      key={tier}
                      type="button"
                      aria-pressed={catalogPhase === tier}
                      disabled={locked}
                      title={
                        locked
                          ? `完成 P${tier - 1} 阶段终局任务并领奖后解锁`
                          : `查看 P${tier}`
                      }
                      onClick={() => {
                        setCatalogPhases((previous) => ({
                          ...previous,
                          [tab]: tier,
                        }));
                        setPlacementType(null);
                      }}
                    >
                      P{tier}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="catalog-list">
              {definitions.map((d) => {
                const shortcut =
                  tab !== "item" && !catalogQuery
                    ? placeable.findIndex((b) => b.id === d.id) + 1
                    : 0;
                const unknown = tab === "item" && !discoveredItems.has(d.id);
                return (
                  <button
                    key={d.id}
                    className={`catalog-entry${unknown ? " is-undiscovered" : ""}`}
                    title={
                      tab === "item"
                        ? unknown
                          ? "尚未获得，可查看物品资料"
                          : "曾经获得"
                        : undefined
                    }
                    style={
                      {
                        "--entity-color": unknown ? "#9699aa" : entityColor(d),
                      } as CSSProperties
                    }
                    aria-keyshortcuts={
                      shortcut > 0 && shortcut <= 6
                        ? String(shortcut)
                        : undefined
                    }
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    aria-pressed={
                      tab !== "item"
                        ? placementType === d.id
                        : selection.kind === tab && selection.id === d.id
                    }
                    onClick={() => {
                      setSelection({
                        kind: tab === "item" ? "item" : "building",
                        id: d.id,
                      });
                      setSelectedRobotID(null);
                      setSelectedInstanceID(null);
                      setPlacementType(
                        tab !== "item" && factory
                          ? placementType === d.id
                            ? null
                            : d.id
                          : null,
                      );
                    }}
                  >
                    <DefinitionIcon definition={d} />
                    <span>
                      <strong>{d.name}</strong>
                      <small>
                        {d.code} /{" "}
                        {tab !== "item"
                          ? `库存 ${factory?.simulation?.warehouse[(d as (typeof placeable)[number]).item ?? ""] ?? 0}`
                          : unknown
                            ? "尚未获得"
                            : "已获得"}
                      </small>
                    </span>
                    <span className="entry-arrow" aria-hidden="true">
                      {placementType === d.id ? (
                        "◆"
                      ) : shortcut > 0 && shortcut <= 6 ? (
                        <kbd>{shortcut}</kbd>
                      ) : (
                        "↗"
                      )}
                    </span>
                  </button>
                );
              })}
              {!definitions.length && (
                <p className="catalog-empty">当前阶段暂无匹配内容。</p>
              )}
            </div>
            <p className="catalog-footnote">
              <span>QUICK BUILD / 连续建造</span>
              点击或按数字选择模组。
              <br />
              左键建造 · 右键旋转
              <br />
              再选一次或 <kbd>Esc</kbd> 退出。
            </p>
          </aside>
          <div className="map-panel">
            {!factory ? (
              <div className="create-factory">
                <span className="map-cross" aria-hidden="true">
                  +
                </span>
                <div className="eyebrow">CLAIM YOUR SECTOR</div>
                <h3>点亮你的第一片街区。</h3>
                <p>
                  为工厂命名，接入 21 × 21 的专属地块，
                  <br />
                  从中心的工厂仓库，开启你的自动化帝国。
                </p>
                <form onSubmit={(event) => void create(event)}>
                  <label htmlFor="factory-name">
                    工厂名称
                    <input
                      id="factory-name"
                      name="factory_name"
                      value={name}
                      maxLength={32}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy}
                      required
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      !!activeStoryID ||
                      !name.trim() ||
                      !game.online ||
                      game.conflict
                    }
                  >
                    {busy ? "正在创建…" : "创建第一座工厂"}
                    <span aria-hidden="true">↗</span>
                  </button>
                </form>
                <span className="create-note">
                  初始 6 个独立厂区，随阶段最多扩建至 100 个
                </span>
              </div>
            ) : (
              <IndustryViews
                factory={factory}
                catalog={catalog}
                act={act}
                onOrder={placeOrder}
                districts={game.districts}
                world={world}
                disabled={game.paused}
                observation={game.observation}
                onLocateBuilding={(id) => {
                  const b = factory.buildings.find((b) => b.id === id);
                  if (!b) return;
                  selectInstance(b);
                  setPlacementType(null);
                  setIndustryView("factory");
                  setRobotFocus((previous) => ({
                    factory_id: factory.id,
                    x: b.x,
                    y: b.y,
                    sequence: (previous?.sequence ?? 0) + 1,
                  }));
                }}
                view={industryView}
                developerToolsVisible={game.developerToolsVisible === true}
                onViewChange={setIndustryView}
                selectedRobotID={selectedRobotID}
                onSelectRobot={selectRobot}
                onLocateRobot={(r) => void locateRobot(r)}
              >
                <FactoryEditor
                  key={factory.id}
                  factory={factory}
                  commands={game.runtime!.commands}
                  catalog={catalog}
                  placementType={placementType}
                  onExitPlacement={() => setPlacementType(null)}
                  selectedID={selectedInstanceID}
                  onSelect={selectInstance}
                  onChange={applyFactory}
                  onError={editorError}
                  selectedRobotID={selectedRobotID}
                  onSelectRobot={selectRobot}
                  robotRoute={robotRoute}
                  robotFocus={robotFocus}
                  districts={game.districts}
                  onSelectDistrict={(id) =>
                    world({ type: "select_district", id })
                  }
                  districtSwitchDisabled={game.paused}
                />
              </IndustryViews>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <aside className="inspector-panel" aria-label="实体详情">
            <div className="panel-caption">
              <div>
                <small>INSPECTOR</small>模组检视
              </div>
              <span>
                {selectedRobot
                  ? "ROBOT"
                  : selection.kind === "building"
                    ? "BUILDING"
                    : "ITEM"}
              </span>
            </div>
            {selectedRobot && factory ? (
              <RobotInspector
                robot={selectedRobot}
                factory={factory}
                districts={game.districts ?? []}
                route={robotRoute}
                paused={game.paused}
                act={world}
                onLocate={() => void locateRobot(selectedRobot)}
                onManage={() => setIndustryView("robots")}
              />
            ) : (
              definition && (
                <>
                  <div className="inspector-hero">
                    <DefinitionIcon definition={definition} />
                    <div>
                      <h3>{definition.name}</h3>
                      <code>{definition.id}</code>
                    </div>
                  </div>
                  <p className="definition-description">
                    {definition.description}
                  </p>
                  <dl className="definition-properties">
                    <div>
                      <dt>模组代号</dt>
                      <dd>{definition.code}</dd>
                    </div>
                    <div>
                      <dt>实体类型</dt>
                      <dd>
                        {selection.kind === "item"
                          ? "物品"
                          : buildingDefinition?.category === "machine"
                            ? "机器"
                            : "物流方块"}
                      </dd>
                    </div>
                    {buildingDefinition && (
                      <div>
                        <dt>位置规则</dt>
                        <dd>
                          {buildingDefinition.fixed
                            ? "中心固定"
                            : "可连续放置 / 移动"}
                        </dd>
                      </div>
                    )}
                    {selectedInstance && (
                      <>
                        <div>
                          <dt>当前坐标</dt>
                          <dd>
                            ({selectedInstance.x}, {selectedInstance.y})
                          </dd>
                        </div>
                        <div>
                          <dt>旋转角度</dt>
                          <dd>{selectedInstance.rotation}°</dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {factory && buildingDefinition && (
                    <ProductionInspector
                      factory={factory}
                      catalog={catalog}
                      definition={buildingDefinition}
                      instance={selectedInstance}
                      act={act}
                      disabled={game.paused}
                    />
                  )}
                  {buildingDefinition ? (
                    <>
                      <BuildingRecipeGuide
                        key={buildingDefinition.id}
                        definition={buildingDefinition}
                        catalog={catalog}
                        industry={factory?.simulation?.industry}
                      />
                      {factory && (
                        <BuildingOrderButton
                          key={`${factory.id}:${buildingDefinition.id}`}
                          definition={buildingDefinition}
                          factory={factory}
                          catalog={catalog}
                          disabled={game.paused}
                          onOrder={placeOrder}
                        />
                      )}
                    </>
                  ) : (
                    <div className="recipe-section">
                      <h4>
                        关联配方{" "}
                        <span>
                          {recipes.length.toString().padStart(2, "0")}
                        </span>
                      </h4>
                      {recipes.length ? (
                        recipes.map((recipe) => (
                          <div className="recipe-card" key={recipe.id}>
                            <div className="recipe-name">
                              {recipe.name}
                              <span>{recipe.duration_ms / 1000}s</span>
                            </div>
                            {ingredients(recipe.inputs)}
                            <div className="recipe-arrow">↓</div>
                            {ingredients(recipe.outputs)}
                            <p>
                              由{" "}
                              {
                                catalog.buildings.find(
                                  (d) => d.id === recipe.building_type,
                                )?.name
                              }{" "}
                              加工
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="no-recipes">
                          {selection.id === "bus"
                            ? "工厂仓库接收产线物品并计入总仓库，不执行加工配方。"
                            : "暂无关联加工配方。"}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="inspector-note">
                    接通产线，让工厂自行运转。
                    <br />
                    OUT / IN 箭头后方取料，前方送料。
                  </p>
                </>
              )
            )}
          </aside>
        </div>
        <div className="workspace-controls" aria-label="游戏显示与操作">
          <div className="control-legend">
            <span className="control-light" />
            {placementType
              ? `建造中 / ${catalog.buildings.find((d) => d.id === placementType)?.name}`
              : "自由建造 / FREE BUILD"}
            <span className="control-shortcuts">
              <kbd>1–6</kbd> 模组 <kbd>R</kbd> 旋转 <kbd>Esc</kbd> 取消
            </span>
          </div>
          <div className="display-controls">
            <HudPopover className="controls-guide save-controls" label="存档">
              <div className="controls-guide-content">
                <h3>本机存档与云备份</h3>
                <p>
                  本机：
                  {game.localSavedAt
                    ? new Date(game.localSavedAt).toLocaleTimeString()
                    : "尚未保存"}
                </p>
                <p>
                  云端：
                  {game.cloudSavedAt
                    ? new Date(game.cloudSavedAt).toLocaleString()
                    : "尚未上传"}
                  {game.dirty ? " · 有新进度" : ""}
                </p>
                <p>
                  每 30
                  分钟自动覆盖云备份；换设备只能恢复最近一次成功上传的进度。
                </p>
                <button
                  disabled={
                    !factory || !game.online || game.conflict || game.uploading
                  }
                  onClick={() => void game.runtime?.backup().catch(editorError)}
                >
                  {game.uploading ? "正在上传…" : "立即上传云存档"}
                </button>
                <button
                  disabled={!game.online || game.uploading}
                  onClick={() => {
                    if (window.confirm("恢复云存档将替换本机进度，是否继续？"))
                      void game.runtime?.restoreCloud().catch(editorError);
                  }}
                >
                  恢复云存档
                </button>
                <button
                  onClick={() =>
                    void game.runtime?.retryStorage().catch(editorError)
                  }
                >
                  重试本地保存
                </button>
              </div>
            </HudPopover>
            <button
              aria-pressed={immersive}
              disabled={!factory}
              onClick={() => setImmersive((value) => !value)}
              title="收起图鉴与检视面板，保留当前建造工具和资源 HUD"
              aria-keyshortcuts="F"
            >
              {immersive ? "▣ 退出沉浸" : "⛶ 沉浸视图"}
              <kbd>F</kbd>
            </button>
            <button
              aria-pressed={powerSaving}
              onClick={() => setPowerSaving((value) => !value)}
              title="降低物品与进度绘制频率至 15 帧，减弱光效；生产速度不变"
            >
              {powerSaving ? "◒ 节能已开启" : "◐ 节能模式"}
            </button>
            <StoryMenu onOpen={setReplayStory} unlocked={unlockedStories} />
            <HudPopover
              className="controls-guide"
              label={
                <>
                  操作指南 <span>?</span>
                </>
              }
            >
              <div className="controls-guide-content">
                <span className="eyebrow">FIELD MANUAL</span>
                <h3>接通你的第一条产线</h3>
                <p>
                  工作室拾取垃圾 → 基础分拣 → 手工制作设备
                  <br />
                  设备安装后选择配方，投料并收取产物；制造物流设施后逐步自动化。
                </p>
                <dl>
                  <div>
                    <dt>
                      <kbd>1–6</kbd>
                    </dt>
                    <dd>选择模组，再按一次退出</dd>
                  </div>
                  <div>
                    <dt>左键 / 右键</dt>
                    <dd>连续建造 / 旋转预览</dd>
                  </div>
                  <div>
                    <dt>长按已有建筑</dt>
                    <dd>拖动搬迁；右键旋转</dd>
                  </div>
                  <div>
                    <dt>右键已有建筑</dt>
                    <dd>打开删除菜单</dd>
                  </div>
                  <div>
                    <dt>滚轮 / 拖动空格</dt>
                    <dd>缩放 / 平移地图</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>F</kbd> / <kbd>Esc</kbd>
                    </dt>
                    <dd>切换沉浸 / 取消建造</dd>
                  </div>
                </dl>
                <p>
                  物品送入工厂仓库即计入总仓库。本机每秒推进一刻，离开游戏或断网时暂停；每
                  30 分钟自动备份到云端。
                </p>
              </div>
            </HudPopover>
          </div>
        </div>
        <QuestNotifications
          key={user.id}
          notices={game.questNotices ?? noQuestNotices}
          catalog={catalog}
        />
        {activeStoryID && (
          <StoryPlayer
            key={`${user.id}:${activeStoryID}`}
            story={storyDefinitions[activeStoryID]}
            powerSaving={powerSaving}
            onClose={replayStory ? () => setReplayStory(null) : undefined}
            onComplete={async () => {
              await game.runtime!.markStoryViewed(activeStoryID);
              setReplayStory(null);
            }}
          />
        )}
      </section>
    </SimulationAnimationProvider>
  );
}
