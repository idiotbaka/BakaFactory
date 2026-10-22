import type { Catalog, FactoryDetail } from "../api/client";
import { DetailedProgress } from "./SimulationAnimation";

export default function WorkshopHud({
  factory,
  catalog,
  paused,
  blocked = false,
  canCancel = true,
  onCancel,
}: {
  factory: FactoryDetail | null;
  catalog: Catalog;
  paused: boolean;
  blocked?: boolean;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const job = factory?.simulation?.industry?.workshop;
  const recipe = catalog.recipes.find((r) => r.id === job?.recipe_id);
  return (
    <section className="workshop-hud" aria-label="工作室加工">
      <div className="workshop-hud-heading">
        <strong>手工加工</strong>
        <span>
          {job
            ? `${paused ? "已暂停 · " : blocked ? "产物上限等待 · " : ""}第 ${(job.total ?? 1) - (job.remaining ?? 1) + 1} / ${job.total ?? 1} 批`
            : "队列空闲"}
        </span>
      </div>
      {job && recipe ? (
        <DetailedProgress
          name={recipe.name}
          machine={{
            input: [],
            output: [],
            progress: job.progress,
            duration: recipe.duration_ms / 1000,
            cooldown: 0,
            status: paused || blocked ? "idle" : "working",
          }}
        />
      ) : (
        <p>前往工作室选择配方并批量加工。</p>
      )}
      {job && (
        <div className="workshop-hud-actions">
          <span>尚余 {job.remaining ?? 1} 批（含当前批）</span>
          <span title={!canCancel ? "请切换到起始回收场取消队列" : undefined}>
            <button
              type="button"
              disabled={paused || !canCancel || !onCancel}
              onClick={onCancel}
              title={
                canCancel
                  ? "取消后仅返还尚未完成批次的原料，保留已完成产物"
                  : undefined
              }
            >
              取消队列并返还未完成原料
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
