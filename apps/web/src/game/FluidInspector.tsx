import { useState } from "react";
import type {
  BuildingDefinition,
  BuildingInstance,
  Catalog,
  FactoryDetail,
} from "../api/client";
import type { IndustryAction } from "./local/industry";
import {
  acceptsFluid,
  fluidBranchFilter,
  fluidLimit,
  fluidRate,
  fluidTarget,
  splitWeights,
  type FluidTarget,
} from "./local/fluidConfig";
import { enabled, itemFilter, type Rotation } from "./local/transportConfig";

const sides: Record<number, string> = {
  0: "东 →",
  90: "南 ↓",
  180: "西 ←",
  270: "北 ↑",
};
export default function FluidInspector({
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
  const [fillItem, setFillItem] = useState(""),
    [amount, setAmount] = useState(1);
  const machine = factory.simulation?.buildings[instance.id],
    fluid = machine?.fluid;
  const choices = catalog.items.filter((i) =>
    acceptsFluid(definition.id, i.id),
  );
  const config = (
    change: Partial<Extract<IndustryAction, { type: "fluid_config" }>>,
  ) => act({ type: "fluid_config", id: instance.id, ...change });
  const options = (label: string) => (
    <>
      <option value="">{label}</option>
      {choices.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </>
  );
  const weights = splitWeights(instance);
  return (
    <section className="logistics-settings" aria-label="流体设置">
      <h4>流体容器与管线</h4>
      <strong>
        {catalog.items.find((i) => i.id === fluid?.item)?.name ?? "空容器"} ·{" "}
        {fluid?.count ?? 0} / {definition.fluid_capacity} u
      </strong>
      <small>
        上刻流入 {machine?.flow_in ?? 0} · 流出 {machine?.flow_out ?? 0} u
      </small>
      <button
        disabled={disabled}
        onClick={() => config({ enabled: !enabled(instance) })}
      >
        {enabled(instance) ? "暂停流动" : "恢复流动"}
      </button>
      <label>
        允许流入的介质
        <select
          disabled={disabled}
          value={itemFilter(instance)}
          onChange={(e) => config({ filter: e.target.value })}
        >
          {options("允许全部兼容流体")}
        </select>
      </label>
      <label>
        每秒流量上限（0 关闭）
        <input
          type="number"
          min={0}
          max={definition.fluid_rate}
          value={fluidRate(instance)}
          disabled={disabled}
          onChange={(e) => config({ fluid_rate: Number(e.target.value) })}
        />
      </label>
      <label>
        向机器投送位置
        <select
          disabled={disabled}
          value={fluidTarget(instance)}
          onChange={(e) =>
            config({ fluid_target: e.target.value as FluidTarget })
          }
        >
          <option value="auto">自动：配方 → 燃料 → 启动液</option>
          <option value="input">仅配方输入</option>
          <option value="fuel">仅燃料缓存</option>
          <option value="medium">仅液压站启动液</option>
        </select>
      </label>
      <label>
        下游该物品库存上限（0 自动）
        <input
          type="number"
          min={0}
          max={500}
          disabled={disabled}
          value={fluidLimit(instance)}
          onChange={(e) => config({ fluid_limit: Number(e.target.value) })}
        />
      </label>
      {definition.role === "valve" && (
        <fieldset>
          <legend>分流比例：前 / 右 / 左</legend>
          {[
            instance.rotation,
            (instance.rotation + 90) % 360,
            (instance.rotation + 270) % 360,
          ].map((r, index) => (
            <label key={r}>
              {sides[r]} · 比例（0 关闭）
              <input
                aria-label={`${sides[r]}分流比例`}
                type="number"
                min={0}
                max={10}
                value={weights[index]}
                disabled={disabled}
                onChange={(e) =>
                  config({
                    split_weights: weights.map((n, i) =>
                      i === index ? Number(e.target.value) : n,
                    ),
                  })
                }
              />
              <select
                aria-label={`${sides[r]}分支介质`}
                value={fluidBranchFilter(instance, r)}
                disabled={disabled}
                onChange={(e) =>
                  act({
                    type: "fluid_branch",
                    id: instance.id,
                    rotation: r as Rotation,
                    filter: e.target.value,
                  })
                }
              >
                {options("分支不限介质")}
              </select>
            </label>
          ))}
          <small>按比例轮流分配；轮到的分支满载时等待，避免改变配比。</small>
        </fieldset>
      )}
      <fieldset>
        <legend>与总仓库手动转移</legend>
        <select
          aria-label="存入流体"
          disabled={disabled}
          value={fillItem}
          onChange={(e) => setFillItem(e.target.value)}
        >
          {options("选择仓库中的流体")}
        </select>
        <input
          aria-label="流体数量"
          type="number"
          min={1}
          max={500}
          value={amount}
          disabled={disabled}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        <button
          disabled={
            disabled ||
            !fillItem ||
            !Number.isInteger(amount) ||
            amount < 1 ||
            amount > 500 ||
            (factory.simulation?.warehouse[fillItem] ?? 0) < amount
          }
          onClick={() =>
            act({
              type: "fill_fluid",
              id: instance.id,
              item: fillItem,
              count: amount,
            })
          }
        >
          从仓库存入
        </button>
        <button
          disabled={disabled || !fluid}
          onClick={() => act({ type: "drain_fluid", id: instance.id })}
        >
          全部排回仓库
        </button>
      </fieldset>
      <p className="production-hint">
        箭头后方取机器产物或 WH 指定输出，前方送出；管线之间可从后 /
        侧接入。每格最多跨越一次，不混液。更换介质前先排空。液压动力管只传功率，物料管道才运输流体。
      </p>
    </section>
  );
}
