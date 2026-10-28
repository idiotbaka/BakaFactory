import { useState } from "react";
import type { FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { orderRewardClaimed } from "./local/progression";
import DiagnosticsPanel from "./DiagnosticsPanel";
import type { LocalFactory } from "./local/state";
import type { Observation } from "./local/observations";
import { DEFAULT_TPS, MAX_TPS, validateTickRate } from "./local/tickRate";
import GameSelect from "./GameSelect";
import { catalog } from "./local/catalog";
import { validateDeveloperItemGrant } from "./local/developerItems";

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
          <ItemGrantControl factory={factory} disabled={disabled} act={act} />
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

function ItemGrantControl({
  factory,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  disabled: boolean;
  act?: (action: WorldAction) => void;
}) {
  const [item, setItem] = useState(catalog.root_item ?? "");
  const [quantity, setQuantity] = useState("100");
  const [error, setError] = useState("");
  const unavailable = disabled || !act;
  const owned = factory.simulation?.warehouse[item] ?? 0;
  return (
    <section className="developer-tools" aria-label="物品获取">
      <h3>物品获取</h3>
      <p>选择物品并填写数量，直接加入总仓库。可选择尚未开放阶段的物品。</p>
      <form
        className="developer-item-grant"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (unavailable) return;
          try {
            const count = Number(quantity);
            validateDeveloperItemGrant(item, count);
            if (!Number.isSafeInteger(owned + count))
              throw new Error("加入后仓库数量超出上限");
            act({ type: "developer_grant_item", item, count });
            setError("");
          } catch (error) {
            setError(error instanceof Error ? error.message : "获取物品失败");
          }
        }}
      >
        <label className="developer-item-choice">
          物品
          <GameSelect
            aria-label="获取物品"
            catalog={catalog}
            kind="item"
            value={item}
            disabled={unavailable}
            onValueChange={(value) => {
              setItem(value);
              setError("");
            }}
          >
            {catalog.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </GameSelect>
        </label>
        <label>
          数量
          <input
            aria-label="获取数量"
            type="number"
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step="1"
            value={quantity}
            disabled={unavailable}
            onChange={(event) => {
              setQuantity(event.target.value);
              setError("");
            }}
          />
        </label>
        <button type="submit" disabled={unavailable}>
          确定
        </button>
      </form>
      <p>当前总仓库存：{owned.toLocaleString()}。数量须为正整数，默认 100。</p>
      <p>
        获取的物品会随存档保存并计入曾获得记录；不会增加制造量或自动入库量，阶段仍需完成终局任务并领奖后开放。
      </p>
      {error && <p role="alert">{error}</p>}
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
