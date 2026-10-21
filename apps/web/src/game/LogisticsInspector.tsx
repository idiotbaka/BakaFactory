import { useState } from "react";
import type {
  BuildingDefinition,
  BuildingInstance,
  Catalog,
  FactoryDetail,
} from "../api/client";
import type { IndustryAction } from "./local/industry";
import { isBelt, isChest, isFluid, isPort } from "./local/catalog";
import {
  branchFilter,
  channel,
  enabled,
  face,
  interval,
  itemFilter,
  rotations,
  type FaceMode,
  type Rotation,
} from "./local/transportConfig";

const sides: Record<number, string> = {
  0: "东 →",
  90: "南 ↓",
  180: "西 ←",
  270: "北 ↑",
};
export default function LogisticsInspector({
  factory,
  catalog,
  definition,
  instance,
  act,
  disabled,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  definition: BuildingDefinition;
  instance: BuildingInstance;
  act: (action: IndustryAction) => void;
  disabled: boolean;
}) {
  const [depositItem, setDepositItem] = useState(""),
    [amount, setAmount] = useState(1);
  const items = catalog.items.filter(
    (i) =>
      (definition.id === "bus" || !isFluid(i.id)) &&
      (!i.tier || i.tier <= (factory.simulation?.industry?.stage ?? 1)),
  );
  const choices = (all: string) => (
    <>
      <option value="">{all}</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </>
  );
  const port = isPort(definition.id),
    chest = isChest(definition.id),
    belt = isBelt(definition.id),
    source = definition.role === "source";
  const stock = factory.simulation?.warehouse ?? {};
  return (
    <section className="logistics-settings" aria-label="物流设置">
      <h4>物流设置</h4>
      <button
        disabled={disabled}
        aria-pressed={enabled(instance)}
        onClick={() =>
          act({
            type: "transport",
            id: instance.id,
            enabled: !enabled(instance),
          })
        }
      >
        {enabled(instance) ? "已启用 · 点击暂停" : "已暂停 · 点击启用"}
      </button>
      {definition.id === "bus" ? (
        <>
          <p>
            输出面先选择物品，再切换为输出。每面每秒最多 1
            件，可接投料机或相邻目标；输入面可设置过滤。
          </p>
          {rotations.map((r) => {
            const value = face(instance, r);
            return (
              <fieldset key={r}>
                <legend>{sides[r]}面</legend>
                <select
                  aria-label={`${sides[r]}面物品`}
                  disabled={disabled}
                  value={value.filter}
                  onChange={(e) =>
                    act({
                      type: "bus_face",
                      id: instance.id,
                      rotation: r,
                      mode: value.mode,
                      filter: e.target.value,
                    })
                  }
                >
                  {choices("全部物品（仅输入）")}
                </select>
                <select
                  aria-label={`${sides[r]}面模式`}
                  disabled={disabled}
                  value={value.mode}
                  onChange={(e) =>
                    act({
                      type: "bus_face",
                      id: instance.id,
                      rotation: r,
                      mode: e.target.value as FaceMode,
                      filter: value.filter,
                    })
                  }
                >
                  <option value="input">输入</option>
                  <option value="output" disabled={!value.filter}>
                    输出
                  </option>
                  <option value="closed">关闭</option>
                </select>
              </fieldset>
            );
          })}
        </>
      ) : (
        <>
          {(port || chest || belt) && (
            <label>
              过滤物品
              <select
                disabled={disabled}
                aria-label="物流过滤物品"
                value={itemFilter(instance)}
                onChange={(e) =>
                  act({
                    type: "transport",
                    id: instance.id,
                    filter: e.target.value,
                  })
                }
              >
                {choices("任意固体")}
              </select>
            </label>
          )}
          {port && (
            <>
              <label>
                目标缓存
                <select
                  aria-label="投料目标缓存"
                  disabled={disabled}
                  value={channel(instance)}
                  onChange={(e) =>
                    act({
                      type: "transport",
                      id: instance.id,
                      channel: e.target.value as "input" | "fuel",
                    })
                  }
                >
                  <option value="input">配方原料 / 箱子 / 传送带</option>
                  <option value="fuel">炉体或动力机燃料</option>
                </select>
              </label>
              <label>
                传输间隔
                <select
                  aria-label="传输间隔"
                  disabled={disabled}
                  value={interval(instance)}
                  onChange={(e) =>
                    act({
                      type: "transport",
                      id: instance.id,
                      interval: Number(e.target.value),
                    })
                  }
                >
                  {[...new Set([1, 2, 3, 5, 10, 30, 60, interval(instance)])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n} 秒 / 批 · 最多 {definition.batch_size ?? 1} 件
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {definition.role === "splitter" && (
            <>
              <p>从后方取料，向前 / 侧面轮换输出；堵塞时保留来源物品。</p>
              {[
                instance.rotation,
                (instance.rotation + 90) % 360,
                (instance.rotation + 270) % 360,
              ].map((r) => (
                <label key={r}>
                  {sides[r]}分支
                  <select
                    aria-label={`${sides[r]}分支过滤`}
                    disabled={disabled}
                    value={branchFilter(instance, r)}
                    onChange={(e) =>
                      act({
                        type: "branch",
                        id: instance.id,
                        rotation: r as Rotation,
                        filter: e.target.value,
                      })
                    }
                  >
                    {choices("任意固体（分支不限）")}
                  </select>
                </label>
              ))}
            </>
          )}
          {chest && (
            <>
              <p>
                {definition.output_slots} 格缓存，每种最多
                100；外部物品进入此箱，不自动进入总仓库。
              </p>
              <label>
                从仓库存入
                <select
                  aria-label="箱子存入物品"
                  disabled={disabled}
                  value={depositItem}
                  onChange={(e) => setDepositItem(e.target.value)}
                >
                  <option value="">选择仓库中的固体</option>
                  {items
                    .filter((i) => (stock[i.id] ?? 0) > 0)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}（{stock[i.id]}）
                      </option>
                    ))}
                </select>
              </label>
              <label>
                数量
                <input
                  aria-label="箱子存入数量"
                  disabled={disabled}
                  type="number"
                  min="1"
                  max="100"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
              <button
                disabled={
                  disabled ||
                  !depositItem ||
                  !Number.isInteger(amount) ||
                  amount < 1 ||
                  amount > 100 ||
                  (stock[depositItem] ?? 0) < amount
                }
                onClick={() =>
                  act({
                    type: "deposit",
                    id: instance.id,
                    item: depositItem,
                    count: amount,
                  })
                }
              >
                存入箱子
              </button>
              <button
                disabled={
                  disabled ||
                  !factory.simulation?.buildings[instance.id].output.length
                }
                onClick={() => act({ type: "collect", id: instance.id })}
              >
                收取箱子全部物品
              </button>
            </>
          )}
          {source && (
            <p>
              顶部垃圾堆每 10 秒提取 12 包；输出满载时暂停。当前阶段最多安装{" "}
              {
                [1, 2, 4, 8, 12, 16][
                  (factory.simulation?.industry?.stage ?? 1) - 1
                ]
              }{" "}
              个。
            </p>
          )}
        </>
      )}
    </section>
  );
}
