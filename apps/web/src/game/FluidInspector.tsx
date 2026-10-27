import GameSelect from "./GameSelect";
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
      {definition.role === "pump" && (
        <p>
          化工泵需接通闭环液压动力管（5 kW），每 0.5 秒最多从后方强力抽送 20 u
          流体到前方，适合主干管线大流量增压。
        </p>
      )}
      <button
        disabled={disabled}
        onClick={() => config({ enabled: !enabled(instance) })}
      >
        {enabled(instance) ? "暂停流动" : "恢复流动"}
      </button>
      <label>
        允许流入的介质
        <GameSelect
          kind="item"
          aria-label="允许流入的介质"
          catalog={catalog}
          disabled={disabled}
          value={itemFilter(instance)}
          onValueChange={(choiceValue) => config({ filter: choiceValue })}
        >
          {options("允许全部兼容流体")}
        </GameSelect>
      </label>
      <label>
        每 0.5 秒流量上限（0 关闭）
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
        <GameSelect
          aria-label="向机器投送位置"
          catalog={catalog}
          disabled={disabled}
          value={fluidTarget(instance)}
          onValueChange={(choiceValue) =>
            config({ fluid_target: choiceValue as FluidTarget })
          }
        >
          <option value="auto">自动：配方 → 燃料 → 启动液</option>
          <option value="input">仅配方输入</option>
          <option value="fuel">仅燃料缓存</option>
          <option value="medium">仅液压站启动液</option>
        </GameSelect>
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
              <GameSelect
                kind="item"
                catalog={catalog}
                aria-label={`${sides[r]}分支介质`}
                value={fluidBranchFilter(instance, r)}
                disabled={disabled}
                onValueChange={(choiceValue) =>
                  act({
                    type: "fluid_branch",
                    id: instance.id,
                    rotation: r as Rotation,
                    filter: choiceValue,
                  })
                }
              >
                {options("分支不限介质")}
              </GameSelect>
            </label>
          ))}
          <small>
            按设定的权重比例轮流向三个方向分流；如果轮到的那个分支满了会暂停等待，确保严格按配比送液。
          </small>
        </fieldset>
      )}
      <fieldset>
        <legend>与总仓库手动转移</legend>
        <GameSelect
          kind="item"
          catalog={catalog}
          aria-label="存入流体"
          disabled={disabled}
          value={fillItem}
          onValueChange={(choiceValue) => setFillItem(choiceValue)}
        >
          {options("选择仓库中的流体")}
        </GameSelect>
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
        箭头后方可直接抽取机器流体产物或 WH
        仓库指定输出的流体，往箭头前方送出；管段之间支持从后方或侧面汇入。同一管网每次只走一种流体，切换介质前请先排空。注意：水、油、酸、气等工艺流体走普通管道；液压动力管只用来传导液压能。
      </p>
    </section>
  );
}
