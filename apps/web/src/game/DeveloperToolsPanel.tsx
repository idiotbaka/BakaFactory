import type { FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { orderRewardClaimed } from "./local/progression";

export default function DeveloperToolsPanel({
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
