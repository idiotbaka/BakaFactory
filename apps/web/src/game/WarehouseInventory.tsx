import { useMemo } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import GameSelect from "./GameSelect";
import { ItemName } from "./ItemInfo";
import { createCatalogSearch } from "./catalogSearch";
import { isLogisticsBuilding } from "./catalogPresentation";
import { warehouseSummary } from "./local/warehouseActivity";

export function warehouseItemTypes(catalog: Catalog) {
  const installed = new Map(
    catalog.buildings
      .filter((b) => b.item)
      .map((b) => [b.item!, isLogisticsBuilding(b) ? "logistics" : "machine"]),
  );
  return new Map(
    catalog.items.map((i) => [
      i.id,
      installed.get(i.id) ??
        (i.kind === "fluid_or_gas"
          ? "fluid"
          : i.kind === "machine" || i.kind === "robot"
            ? "machine"
            : "solid"),
    ]),
  );
}

export default function WarehouseInventory({
  factory,
  catalog,
  query,
  orderable,
  canOrder,
  orderDisabled,
  onOrder,
  stage,
  type,
  onStageChange,
  onTypeChange,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  query: string;
  orderable: Set<string>;
  canOrder: boolean;
  orderDisabled: boolean;
  onOrder: (id: string) => void;
  stage: string;
  type: string;
  onStageChange: (value: string) => void;
  onTypeChange: (value: string) => void;
}) {
  const types = useMemo(() => warehouseItemTypes(catalog), [catalog]);
  const orderedItems = useMemo(
    () =>
      [...catalog.items].sort(
        (a, b) => Number(a.id.startsWith("d")) - Number(b.id.startsWith("d")),
      ),
    [catalog.items],
  );
  const tick = factory.simulation?.tick ?? 0;
  const summary = useMemo(
    () => warehouseSummary(factory.warehouse_activity, tick),
    [factory.warehouse_activity, tick],
  );
  const matches = createCatalogSearch(query);
  const items = orderedItems.filter(
    (i) =>
      ((factory.simulation?.warehouse[i.id] ?? 0) > 0 ||
        (canOrder && orderable.has(i.id)) ||
        (summary.ready && !!summary.delta[i.id])) &&
      (stage === "all" || (i.tier ?? 1) === Number(stage)) &&
      (type === "all" || types.get(i.id) === type) &&
      matches(i),
  );
  return (
    <>
      <div className="warehouse-filters">
        <label>
          游戏阶段
          <GameSelect
            catalog={catalog}
            aria-label="仓库游戏阶段"
            value={stage}
            onValueChange={onStageChange}
          >
            <option value="all">全部阶段</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                P{n}
              </option>
            ))}
          </GameSelect>
        </label>
        <label>
          物品类型
          <GameSelect
            catalog={catalog}
            aria-label="仓库物品类型"
            value={type}
            onValueChange={onTypeChange}
          >
            <option value="all">全部类型</option>
            <option value="machine">机器</option>
            <option value="logistics">物流</option>
            <option value="solid">固体</option>
            <option value="fluid">液体</option>
          </GameSelect>
        </label>
        <span>
          {summary.ready ? "净变化 · 最近 1 分钟" : "运行满 1 分钟后显示净变化"}
        </span>
      </div>
      <section className="industry-warehouse" aria-label="工厂总仓库">
        {items.map((i) => {
          const delta = summary.delta[i.id] ?? 0;
          return (
            <article key={i.id}>
              <DefinitionIcon definition={i} compact />
              <div className="warehouse-item-details">
                <strong>
                  <ItemName item={i.id} />
                </strong>
                <span className="warehouse-item-quantity">
                  {(factory.simulation?.warehouse[i.id] ?? 0).toLocaleString()}{" "}
                  u
                </span>
                {summary.ready && (
                  <span
                    className={`warehouse-rate ${delta > 0 ? "is-positive" : delta < 0 ? "is-negative" : "is-neutral"}`}
                    title="最近 120 tick 总仓库数量净变化"
                  >
                    {delta > 0 ? "+" : ""}
                    {delta.toLocaleString()}u/m
                  </span>
                )}
                {canOrder && orderable.has(i.id) && (
                  <button
                    className="warehouse-order-trigger"
                    type="button"
                    aria-label={`下单${i.name}`}
                    disabled={orderDisabled}
                    onClick={() => onOrder(i.id)}
                  >
                    下单
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!items.length && (
          <p>
            {query || stage !== "all" || type !== "all"
              ? "没有匹配的物品，请调整筛选或搜索。"
              : canOrder
                ? "仓库暂无存量；可预览下单计划，缺少的材料需先备齐。"
                : "仓库为空，前往工作室拾取第一包垃圾。"}
          </p>
        )}
      </section>
    </>
  );
}
