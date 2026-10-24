import type { AssetProgress } from "./assetPreloader";

export default function FactoryLoading({
  resources,
  error,
  onRetry,
}: {
  resources: AssetProgress;
  error?: string;
  onRetry: () => void;
}) {
  // The final unit is actual save / online initialization, not a timed animation.
  const total = resources.total + 1;
  const completed = resources.completed;
  const percent = Math.floor((completed / total) * 100);
  const resourceError = resources.phase === "failed";
  return (
    <div className="factory-loading">
      <div className="factory-loading-content">
        <span className="eyebrow">WORKSHOP / LOADING</span>
        <h2>准备进入工厂</h2>
        <div className="factory-loading-metrics">
          <span>
            {resources.phase === "ready"
              ? "正在读取存档并校验登录"
              : "正在准备字体与图标"}
          </span>
          <span>{percent}%</span>
        </div>
        <progress
          className="factory-loading-progress"
          max={total}
          value={completed}
          aria-label="工厂加载进度"
        />
        <p className="factory-loading-detail" role="status">
          字体与图标 {resources.completed} / {resources.total}
          {resources.phase === "ready" ? " · 资源已就绪" : ""}
        </p>
        {(error || resourceError) && (
          <>
            <p className="factory-loading-error" role="alert">
              {error ||
                `有 ${resources.failed} 项资源未能加载，请检查网络后重试。`}
            </p>
            <button className="primary-button" onClick={onRetry}>
              {resourceError ? "重新加载资源" : "重新读取工厂"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
