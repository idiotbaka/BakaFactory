import GameSelect from "./GameSelect";
import { useState } from "react";
import type {
  BuildingDefinition,
  BuildingInstance,
  Catalog,
  FactoryDetail,
} from "../api/client";
import type { IndustryAction } from "./local/industry";
import { isBelt, isChest, isFluid, isPort } from "./local/catalog";
import { pickupType, intakeType, terminalItems } from "./local/warehouseIO";
import {
  branchFilter,
  channel,
  enabled,
  face,
  interval,
  itemFilter,
  rotations,
  warehouseOutputCount,
  MAX_WAREHOUSE_OUTPUT,
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
      {definition.id === "underground_belt" && (
        <p>
          {instance.configuration.underground_role === "entry"
            ? "地下入口：从箭头后方收货，直接穿过地下送往配对出口。"
            : "地下出口：把地下送来的物料往箭头前方推出，不从地面直接收货。"}
          {(() => {
            const peer = factory.buildings.find(
              (b) => b.id === instance.configuration.underground_peer,
            );
            return peer
              ? ` 配对端口 (${peer.x}, ${peer.y})，距离 ${Math.abs(peer.x - instance.x) + Math.abs(peer.y - instance.y)} 格。`
              : "";
          })()}
          免动力运行，单批最多 6 件；拖动时只能沿着原直线调整间距（1～8
          格），拆除任意一端会成对收回并退还带上的物料。
        </p>
      )}
      {belt && definition.id !== "underground_belt" && (
        <p>
          沿箭头方向接力运送固体；机器不会自己往带上吐料，请用投料机从机器抓取放到带上，末端可直接连入
          WH 仓库或收货终端，也能再由投料机喂进下一台机器。
        </p>
      )}
      {port && (
        <p>
          从箭头后方抓取机器产物、料箱或传送带上的物料，送往箭头前方的设备、传送带或仓库。即使后方传送带还没走满整格，只要有货就能立刻抓走。
        </p>
      )}
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
      {definition.id === pickupType ? (
        <>
          <p>
            从总仓库自动取货并朝箭头前方推出，每秒一批，每批最多按输出件数取货。可设定
            1～2
            种固体轮流供料（缺货或前方堵住时自动跳过）；支持长按移动和旋转，不可删除。
          </p>
          {[0, 1].map((index) => (
            <label key={index}>
              {index === 0 ? "第一种物品（必选）" : "第二种物品（可选）"}
              <GameSelect
                kind="item"
                catalog={catalog}
                aria-label={`取货终端物品 ${index + 1}`}
                disabled={disabled}
                value={terminalItems(instance)[index] ?? ""}
                onValueChange={(choiceValue) => {
                  const values = [...terminalItems(instance)];
                  values[index] = choiceValue;
                  act({
                    type: "transport",
                    id: instance.id,
                    output_items: values.filter(Boolean),
                  });
                }}
              >
                {index === 1 && <option value="">仅输出第一种物品</option>}
                {items
                  .filter(
                    (i) =>
                      i.id === terminalItems(instance)[index] ||
                      !terminalItems(instance).includes(i.id),
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </GameSelect>
            </label>
          ))}
          <label>
            输出件数
            <GameSelect
              catalog={catalog}
              aria-label="取货终端输出件数"
              disabled={disabled}
              value={warehouseOutputCount(instance)}
              onValueChange={(value) =>
                act({
                  type: "transport",
                  id: instance.id,
                  output_count: Number(value),
                })
              }
            >
              {Array.from(
                { length: MAX_WAREHOUSE_OUTPUT },
                (_, i) => i + 1,
              ).map((n) => (
                <option key={n} value={n}>
                  {n} 件
                </option>
              ))}
            </GameSelect>
          </label>
        </>
      ) : definition.id === intakeType ? (
        <p>
          四面均可接收固体，送达后直接汇入共用总仓库，自身不占独立库存；无朝向要求，支持长按移动，不可删除。
        </p>
      ) : definition.id === "bus" ? (
        <>
          <p>
            四面接口可独立配置：先选定物品再切为「输出」，每面可设置 1～20
            件的单批上限（自动输出每秒一批，也可由投料机抓取）。库存或下游容量不足时按实际数量输出；设为「输入」时可过滤允许入库的物品。
          </p>
          {rotations.map((r) => {
            const value = face(instance, r);
            return (
              <fieldset key={r}>
                <legend>{sides[r]}面</legend>
                <GameSelect
                  kind="item"
                  catalog={catalog}
                  aria-label={`${sides[r]}面物品`}
                  disabled={disabled}
                  value={value.filter}
                  onValueChange={(choiceValue) =>
                    act({
                      type: "bus_face",
                      id: instance.id,
                      rotation: r,
                      mode: value.mode,
                      filter: choiceValue,
                    })
                  }
                >
                  {choices("全部物品（仅输入）")}
                </GameSelect>
                <GameSelect
                  catalog={catalog}
                  aria-label={`${sides[r]}面模式`}
                  disabled={disabled}
                  value={value.mode}
                  onValueChange={(choiceValue) =>
                    act({
                      type: "bus_face",
                      id: instance.id,
                      rotation: r,
                      mode: choiceValue as FaceMode,
                      filter: value.filter,
                    })
                  }
                >
                  <option value="input">输入</option>
                  <option value="output" disabled={!value.filter}>
                    输出
                  </option>
                  <option value="closed">关闭</option>
                </GameSelect>
                {value.mode === "output" && (
                  <label>
                    输出件数
                    <GameSelect
                      catalog={catalog}
                      aria-label={`${sides[r]}面输出件数`}
                      disabled={disabled}
                      value={warehouseOutputCount(instance, r)}
                      onValueChange={(count) =>
                        act({
                          type: "bus_face",
                          id: instance.id,
                          rotation: r,
                          mode: value.mode,
                          filter: value.filter,
                          output_count: Number(count),
                        })
                      }
                    >
                      {Array.from(
                        { length: MAX_WAREHOUSE_OUTPUT },
                        (_, i) => i + 1,
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n} 件
                        </option>
                      ))}
                    </GameSelect>
                  </label>
                )}
              </fieldset>
            );
          })}
        </>
      ) : (
        <>
          {(port || chest || belt) && (
            <label>
              过滤物品
              <GameSelect
                kind="item"
                catalog={catalog}
                disabled={disabled}
                aria-label="物流过滤物品"
                value={itemFilter(instance)}
                onValueChange={(choiceValue) =>
                  act({
                    type: "transport",
                    id: instance.id,
                    filter: choiceValue,
                  })
                }
              >
                {choices("任意固体")}
              </GameSelect>
            </label>
          )}
          {port && (
            <>
              <label>
                目标缓存
                <GameSelect
                  catalog={catalog}
                  aria-label="投料目标缓存"
                  disabled={disabled}
                  value={channel(instance)}
                  onValueChange={(choiceValue) =>
                    act({
                      type: "transport",
                      id: instance.id,
                      channel: choiceValue as "input" | "fuel",
                    })
                  }
                >
                  <option value="input">配方原料 / 箱子 / 传送带</option>
                  <option value="fuel">炉体或动力机燃料</option>
                </GameSelect>
              </label>
              <label>
                传输间隔
                <GameSelect
                  catalog={catalog}
                  aria-label="传输间隔"
                  disabled={disabled}
                  value={interval(instance)}
                  onValueChange={(choiceValue) =>
                    act({
                      type: "transport",
                      id: instance.id,
                      interval: Number(choiceValue),
                    })
                  }
                >
                  {[
                    ...new Set([
                      0.5,
                      1,
                      1.5,
                      2,
                      3,
                      5,
                      10,
                      30,
                      60,
                      interval(instance),
                    ]),
                  ]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n} 秒 / 批 · 最多 {definition.batch_size ?? 1} 件
                      </option>
                    ))}
                </GameSelect>
              </label>
            </>
          )}
          {definition.role === "splitter" && (
            <>
              <p>
                从箭头后方接货，按顺序轮流向正前、左侧、右侧三个分支分流；可为各分支单独指定允许通过的物品，下游堵住时物料会留在原处等候。
              </p>
              {[
                instance.rotation,
                (instance.rotation + 90) % 360,
                (instance.rotation + 270) % 360,
              ].map((r) => (
                <label key={r}>
                  {sides[r]}分支
                  <GameSelect
                    kind="item"
                    catalog={catalog}
                    aria-label={`${sides[r]}分支过滤`}
                    disabled={disabled}
                    value={branchFilter(instance, r)}
                    onValueChange={(choiceValue) =>
                      act({
                        type: "branch",
                        id: instance.id,
                        rotation: r as Rotation,
                        filter: choiceValue,
                      })
                    }
                  >
                    {choices("任意固体（分支不限）")}
                  </GameSelect>
                </label>
              ))}
            </>
          )}
          {chest && (
            <>
              <p>
                提供 {definition.output_slots} 格现场缓存（同种物品占 1
                格，每格最多 100
                件）。适合在产线中途暂存缓冲；箱内物料不会自动计入总仓库，可随时手动存取或由机器人、投料机搬运。
              </p>
              <label>
                从仓库存入
                <GameSelect
                  kind="item"
                  catalog={catalog}
                  aria-label="箱子存入物品"
                  disabled={disabled}
                  value={depositItem}
                  onValueChange={(choiceValue) => setDepositItem(choiceValue)}
                >
                  <option value="">选择仓库中的固体</option>
                  {items
                    .filter((i) => (stock[i.id] ?? 0) > 0)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}（{stock[i.id]}）
                      </option>
                    ))}
                </GameSelect>
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
              只能建在任意厂区最北排（y = 0）紧贴垃圾山的位置，免动力每 10
              秒自动挖出 12
              包垃圾；朝向出口接上传送带或投料机即可持续供料，建造数量不限。
            </p>
          )}
        </>
      )}
    </section>
  );
}
