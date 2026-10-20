import { useEffect, useState, type CSSProperties } from "react";
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
import { ProductionInspector, WarehousePanel } from "./ProductionPanel";
import { SimulationAnimationProvider } from "./SimulationAnimation";
import { readPowerSaving, savePowerSaving } from "./displayPreferences";
import { entityColor } from "./entityTheme";
import HudPopover from "../HudPopover";
import { useLocalGame } from "./local/useLocalGame";
import { catalog as localCatalog } from "./local/state";

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
  const [tab, setTab] = useState<"building" | "item">("building");
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [selectedInstanceID, setSelectedInstanceID] = useState<string | null>(
    null,
  );
  const [powerSaving, setPowerSaving] = useState(readPowerSaving);
  const [immersive, setImmersive] = useState(false);
  const paletteCatalog =
    workspace.kind === "ready" ? workspace.catalog : undefined;
  const activeFactoryID =
    workspace.kind === "ready" ? workspace.factory?.id : undefined;
  useEffect(() => savePowerSaving(powerSaving), [powerSaving]);
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
        (d) => !d.fixed && d.id !== "bus",
      )[Number(event.key) - 1];
      if (!definition) return;
      event.preventDefault();
      setTab("building");
      setSelection({ kind: "building", id: definition.id });
      setSelectedInstanceID(null);
      setPlacementType((previous) =>
        previous === definition.id ? null : definition.id,
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [activeFactoryID, paletteCatalog]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || workspace.kind !== "ready") return;
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
    setSelectedInstanceID(instance?.id ?? null);
    if (instance) {
      setSelection({ kind: "building", id: instance.building_type });
      setTab("building");
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
  const placeable = catalog.buildings.filter((d) => !d.fixed && d.id !== "bus");
  const definitions = tab === "building" ? placeable : catalog.items;
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
            </div>
          </div>
          {factory && <WarehousePanel factory={factory} catalog={catalog} />}
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
                aria-pressed={tab === "item"}
                onClick={() => {
                  setTab("item");
                  setPlacementType(null);
                  setSelection({ kind: "item", id: catalog.items[0].id });
                  setSelectedInstanceID(null);
                }}
              >
                物品
              </button>
            </div>
            <div className="catalog-list">
              {definitions.map((d, index) => (
                <button
                  key={d.id}
                  className="catalog-entry"
                  style={{ "--entity-color": entityColor(d) } as CSSProperties}
                  aria-keyshortcuts={
                    tab === "building" ? String(index + 1) : undefined
                  }
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  aria-pressed={
                    tab === "building"
                      ? placementType === d.id
                      : selection.kind === tab && selection.id === d.id
                  }
                  onClick={() => {
                    setSelection({ kind: tab, id: d.id });
                    setSelectedInstanceID(null);
                    setPlacementType(
                      tab === "building" && factory
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
                      {d.code} / {tab === "building" ? "BUILD" : "RESOURCE"}
                    </small>
                  </span>
                  <span className="entry-arrow" aria-hidden="true">
                    {placementType === d.id ? (
                      "◆"
                    ) : tab === "building" ? (
                      <kbd>{index + 1}</kbd>
                    ) : (
                      "↗"
                    )}
                  </span>
                </button>
              ))}
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
                      busy || !name.trim() || !game.online || game.conflict
                    }
                  >
                    {busy ? "正在创建…" : "创建第一座工厂"}
                    <span aria-hidden="true">↗</span>
                  </button>
                </form>
                <span className="create-note">每个账号当前可拥有 1 座工厂</span>
              </div>
            ) : (
              <FactoryEditor
                factory={factory}
                commands={game.runtime!.commands}
                catalog={catalog}
                placementType={placementType}
                onExitPlacement={() => setPlacementType(null)}
                selectedID={selectedInstanceID}
                onSelect={selectInstance}
                onChange={applyFactory}
                onError={editorError}
              />
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
              <span>{selection.kind === "building" ? "BUILDING" : "ITEM"}</span>
            </div>
            {definition && (
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
                  />
                )}
                <div className="recipe-section">
                  <h4>
                    关联配方{" "}
                    <span>{recipes.length.toString().padStart(2, "0")}</span>
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
                <p className="inspector-note">
                  接通产线，让工厂自行运转。
                  <br />
                  OUT / IN 箭头后方取料，前方送料。
                </p>
              </>
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
                  矿机 → OUT → 传送带 → IN → 熔炉
                  <br />
                  再将铁板送往装配机，最后接入工厂仓库。
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
      </section>
    </SimulationAnimationProvider>
  );
}
