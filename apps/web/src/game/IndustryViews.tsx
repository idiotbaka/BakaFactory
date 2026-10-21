import { useState, type ReactNode } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { IndustryAction } from "./local/industry";
import { workshopBatchLimit } from "./local/workshop";
import DefinitionIcon from "./DefinitionIcon";
import { PowerOverview } from "./PowerPanel";
import WorldPanel from "./WorldPanel";
import RobotPanel from "./RobotPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import type { Observation } from "./local/observations";
import type { LocalFactory } from "./local/state";
import type { DistrictSummary, WorldAction } from "./local/world";

export type IndustryView =
  | "factory"
  | "workshop"
  | "warehouse"
  | "power"
  | "world"
  | "robots"
  | "diagnostics";
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
}) {
  const [query, setQuery] = useState("");
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const s = factory.simulation,
    p = s?.industry,
    job = p?.workshop;
  const stage = catalog.stages?.find((x) => x.tier === (p?.stage ?? 1));
  const headquarters =
    !districts.length ||
    !!districts.find((d) => d.id === factory.id)?.headquarters;
  const active = catalog.recipes.find((r) => r.id === job?.recipe_id);
  const recipes = catalog.recipes.filter(
    (r) =>
      catalog.starting_machines?.includes(r.building_type) &&
      (r.tier ?? 1) <= (p?.stage ?? 1) &&
      `${r.id}${r.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const name = (id: string) =>
    catalog.items.find((i) => i.id === id)?.name ?? id;
  const ingredients = (values: Record<string, number>, showStock = false) =>
    Object.entries(values)
      .map(
        ([id, n]) =>
          `${name(id)} ×${n}${showStock ? `（存 ${s?.warehouse[id] ?? 0}）` : ""}`,
      )
      .join("、");
  return (
    <>
      <nav className="industry-tabs" aria-label="工厂视图">
        {(
          [
            ["factory", "工厂"],
            ["workshop", "工作室"],
            ["warehouse", "仓库"],
            ["power", "能源"],
            ["world", "厂区"],
            ["robots", "机器人"],
            ["diagnostics", "诊断"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => onViewChange(id)}
          >
            {label}
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
        <div className="industry-content">
          <div className="industry-heading">
            <h3>
              {view === "diagnostics"
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
              view !== "world" &&
              view !== "robots" &&
              view !== "diagnostics" && (
                <input
                  aria-label="搜索工作室或仓库"
                  placeholder="搜索名称或编号"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
          </div>
          <p className="industry-goal">
            {stage?.goal}
            <br />
            阶段成果：{stage && name(stage.milestone_item)}
            。首次制造后永久解锁下一阶段。
          </p>
          {view === "diagnostics" ? (
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
                  <span>（{s?.warehouse[catalog.root_item ?? ""] ?? 0}）</span>
                </button>
              </div>
              {job && active && (
                <div className="workshop-active" role="status">
                  <p>
                    {active.name} · 尚余 {job.remaining ?? 1}{" "}
                    批，当前进度见顶部横栏。
                  </p>
                  <button
                    disabled={disabled}
                    onClick={() => act({ type: "cancel_workshop" })}
                  >
                    取消队列并返还未完成原料
                  </button>
                </div>
              )}
              <div className="workshop-recipes">
                {recipes.map((r) => {
                  const maximum = workshopBatchLimit(r, s?.warehouse ?? {}),
                    raw = batchCounts[r.id] ?? "1",
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
                        <span>{r.duration_ms / 1000}s</span>
                      </div>
                      <p>
                        {r.id.toUpperCase()} ·{" "}
                        {
                          catalog.buildings.find(
                            (b) => b.id === r.building_type,
                          )?.name
                        }
                      </p>
                      <p>每批原料：{ingredients(r.inputs, true)}</p>
                      <p>每批产物：{ingredients(r.outputs)}</p>
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
                                [r.id]: event.target.value,
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
            </>
          ) : (
            <section className="industry-warehouse" aria-label="当前厂区库存">
              {catalog.items
                .filter(
                  (i) =>
                    (s?.warehouse[i.id] ?? 0) > 0 &&
                    `${i.name}${i.code}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((i) => (
                  <article key={i.id}>
                    <DefinitionIcon definition={i} compact />
                    <strong>{i.name}</strong>
                    <span>{(s?.warehouse[i.id] ?? 0).toLocaleString()} u</span>
                  </article>
                ))}
              {!Object.values(s?.warehouse ?? {}).some((n) => n > 0) && (
                <p>仓库为空，前往工作室拾取第一包垃圾。</p>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
