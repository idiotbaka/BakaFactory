import { useState } from "react";
import type { FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { orderRewardClaimed } from "./local/progression";
import DiagnosticsPanel from "./DiagnosticsPanel";
import type { LocalFactory } from "./local/state";
import type { Observation } from "./local/observations";
import { DEFAULT_TPS, MAX_TPS, validateTickRate } from "./local/tickRate";

export default function DeveloperToolsPanel({
  factory,
  disabled,
  act,
  observation,
  onLocate,
  tickRate = DEFAULT_TPS,
  onTickRateChange,
}: {
  factory: FactoryDetail;
  disabled: boolean;
  act?: (action: WorldAction) => void;
  observation?: Observation;
  onLocate?: (id: string) => void;
  tickRate?: number;
  onTickRateChange?: (value: number) => void;
}) {
  const [tab, setTab] = useState<"features" | "diagnostics">("features");
  return (
    <section className="developer-console" aria-label="开发者工具">
      <nav className="operations-tabs" aria-label="开发者工具分类">
        <button
          aria-pressed={tab === "features"}
          onClick={() => setTab("features")}
        >
          功能测试
        </button>
        <button
          aria-pressed={tab === "diagnostics"}
          onClick={() => setTab("diagnostics")}
        >
          闭环诊断
        </button>
      </nav>
      {tab === "features" ? (
        <>
          <TickRateControl
            key={tickRate}
            tickRate={tickRate}
            disabled={disabled || !onTickRateChange}
            onChange={onTickRateChange}
          />
          <FeatureTests factory={factory} disabled={disabled} act={act} />
        </>
      ) : (
        <DiagnosticsPanel
          factory={factory as LocalFactory}
          observation={observation}
          onLocate={onLocate}
        />
      )}
    </section>
  );
}

function TickRateControl({
  tickRate,
  disabled,
  onChange,
}: {
  tickRate: number;
  disabled: boolean;
  onChange?: (value: number) => void;
}) {
  const [input, setInput] = useState(String(tickRate));
  const [error, setError] = useState("");
  function apply(value: number) {
    if (disabled || !onChange) return;
    try {
      onChange(validateTickRate(value));
      setInput(String(value));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "调整 TPS 失败");
    }
  }
  return (
    <section className="developer-tools" aria-label="模拟倍速">
      <h3>模拟倍速</h3>
      <p>
        当前 {tickRate} TPS · 默认 {DEFAULT_TPS} TPS
      </p>
      <form
        className="developer-tick-rate"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          apply(Number(input));
        }}
      >
        <label>
          每秒 tick 数（TPS）
          <input
            aria-label="模拟 TPS"
            type="number"
            min={DEFAULT_TPS}
            max={MAX_TPS}
            step="1"
            value={input}
            disabled={disabled}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button type="submit" disabled={disabled}>
          应用 TPS
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(DEFAULT_TPS)}
        >
          恢复 {DEFAULT_TPS} TPS
        </button>
      </form>
      <p>
        支持 {DEFAULT_TPS}～{MAX_TPS} 的整数。每 tick 推进 0.5
        秒游戏时间；高倍速的实际速度取决于设备负载。
      </p>
      <p>
        仅当前页面有效，刷新、换账号或关闭开发者工具后恢复 {DEFAULT_TPS}
        TPS；后台、断网和暂停时不运行，也不补算时间。
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function FeatureTests({
  factory,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  disabled: boolean;
  act?: (action: WorldAction) => void;
}) {
  const p = factory.simulation?.industry;
  const enabled = p?.developer?.warehouse_orders_always_available === true;
  const inUse = enabled && !!p?.workshop?.order && !orderRewardClaimed(p);
  return (
    <section className="developer-tools" aria-label="开发者设置">
      <label className="developer-switch">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled || !act || inUse}
          onChange={(event) =>
            act?.({
              type: "developer_settings",
              warehouse_orders_always_available: event.target.checked,
            })
          }
        />
        <span>仓库下单始终可用</span>
        <strong>{enabled ? "已开启" : "已关闭"}</strong>
      </label>
      <p>
        跳过机械手任务的领奖条件，在任意厂区使用总仓库下单。配方阶段、设备解锁、材料消耗和共用加工队列规则仍然有效。
      </p>
      <p>
        默认关闭，设置随当前游戏存档保存；开启不会领取任务奖励，也不会推进阶段。
      </p>
      {inUse && (
        <p role="status">
          当前机械手订单正在使用此开关，完成或取消订单后即可关闭。
        </p>
      )}
    </section>
  );
}
