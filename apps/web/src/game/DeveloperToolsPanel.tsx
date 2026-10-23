import { useState } from "react";
import type { FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { orderRewardClaimed } from "./local/progression";
import DiagnosticsPanel from "./DiagnosticsPanel";
import type { LocalFactory } from "./local/state";
import type { Observation } from "./local/observations";

export default function DeveloperToolsPanel({
  factory,
  disabled,
  act,
  observation,
  onLocate,
}: {
  factory: FactoryDetail;
  disabled: boolean;
  act?: (action: WorldAction) => void;
  observation?: Observation;
  onLocate?: (id: string) => void;
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
        <FeatureTests factory={factory} disabled={disabled} act={act} />
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
