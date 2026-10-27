import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import { orderLimits, planWorkshopOrder } from "./local/orders";
import { workshopDuration, workshopMachineName } from "./local/workshop";
import type { IndustryAction } from "./local/industry";

export type PlaceWorkshopOrder = (
  action: Extract<IndustryAction, { type: "order_workshop" }>,
) => Promise<unknown>;
export default function WarehouseOrderDialog({
  item,
  factory,
  catalog,
  disabled,
  onConfirm,
  onClose,
}: {
  item: string;
  factory: FactoryDetail;
  catalog: Catalog;
  disabled: boolean;
  onConfirm?: PlaceWorkshopOrder;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState("1"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null),
    titleID = useId();
  const p = factory.simulation?.industry,
    warehouse = factory.simulation?.warehouse;
  const preview = useMemo(() => {
    try {
      return {
        plan: planWorkshopOrder(
          p,
          warehouse ?? {},
          item,
          Number(quantity),
          catalog,
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "无法规划订单" };
    }
  }, [p, warehouse, item, quantity, catalog]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const targets = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    targets()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const buttons = targets(),
          index = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[
          (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus();
      } else if (
        !(
          event.target instanceof HTMLElement && event.target.closest("input")
        ) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (/^[1-6fr]$/i.test(event.key) ||
          ["Delete", "Backspace"].includes(event.key))
      )
        event.preventDefault();
    };
    const focus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        targets()[0]?.focus();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  const name = (id: string) =>
    catalog.items.find((i) => i.id === id)?.name ?? id;
  const materials = (values: Record<string, number>) => (
    <ul className="order-materials">
      {Object.entries(values).map(([id, count]) => {
        const definition = catalog.items.find((i) => i.id === id);
        return (
          <li key={id}>
            {definition && <DefinitionIcon definition={definition} compact />}
            <span>
              {name(id)}
              <strong>× {count.toLocaleString()}</strong>
            </span>
          </li>
        );
      })}
    </ul>
  );
  const plan = preview.plan;
  const missing = !!plan && Object.keys(plan.missing).length > 0;
  return createPortal(
    <div
      className="recipe-guide-backdrop"
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={panel}
        className="recipe-guide-dialog order-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
      >
        <header className="recipe-guide-header">
          <h2 id={titleID}>机械手下单 · {name(item)}</h2>
          <button type="button" onClick={onClose} aria-label="关闭下单">
            关闭 ×
          </button>
        </header>
        <form
          className="order-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !plan ||
              missing ||
              plan.limited ||
              busy ||
              disabled ||
              p?.workshop ||
              !onConfirm
            )
              return;
            setBusy(true);
            setError("");
            try {
              await onConfirm({
                type: "order_workshop",
                item,
                count: plan.requested,
                signature: plan.signature,
              });
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "下单失败，请重新确认计划",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div
            className="recipe-guide-content"
            tabIndex={0}
            aria-label="下单计划滚动区域"
          >
            <p>
              直接调用所有厂区共用的总仓库存量，按已解锁的工作室配方自动排产；中途产出的副产物会顺带留给后续工序使用。这里填写的是本次新做多少个，不会拿仓库里已有的成品凑数。
            </p>
            {preview.error && <p role="alert">{preview.error}</p>}
            {plan && (
              <>
                <h3>
                  顺序加工计划 · {plan.steps.length} 道工序 · 预计{" "}
                  {plan.duration.toLocaleString()} 秒
                </h3>
                <ol className="order-plan" aria-label="顺序加工队列">
                  {plan.steps.map((step, index) => {
                    const recipe = catalog.recipes.find(
                      (r) => r.id === step.recipe_id,
                    )!;
                    const outputs = Object.fromEntries(
                      Object.entries(recipe.outputs).map(([id, n]) => [
                        id,
                        n * step.batches,
                      ]),
                    );
                    const inputs = Object.fromEntries(
                      Object.entries(recipe.inputs).map(([id, n]) => [
                        id,
                        n * step.batches,
                      ]),
                    );
                    return (
                      <li key={index}>
                        <header>
                          <span className="order-step-number">{index + 1}</span>
                          <strong>{recipe.name}</strong>
                        </header>
                        <p>
                          {recipe.id.toUpperCase()} ·{" "}
                          {workshopMachineName(recipe.building_type) ??
                            catalog.buildings.find(
                              (b) => b.id === recipe.building_type,
                            )?.name}{" "}
                          · {step.batches} 批 × {workshopDuration(recipe)} 秒
                        </p>
                        <small>本工序原料</small>
                        {materials(inputs)}
                        <small>本工序产物</small>
                        {materials(outputs)}
                      </li>
                    );
                  })}
                </ol>
                <p>
                  本次下单 {plan.requested.toLocaleString()} 个，计划交付{" "}
                  {name(item)} × {(plan.outputs[item] ?? 0).toLocaleString()}
                  。按整批加工，多余产物全部保留。
                </p>
                <section aria-label="预留仓库材料">
                  <h3>确认时预留的仓库材料</h3>
                  {materials(plan.consumed)}
                </section>
                <section aria-label="最终交付物品">
                  <h3>最终交付的全部成品 / 副产物</h3>
                  {materials(plan.outputs)}
                </section>
                {missing && (
                  <section aria-label="缺少材料">
                    <h3>还缺少的材料</h3>
                    {materials(plan.missing)}
                    <p>
                      请先去拾荒或用厂区里的机器备齐上述材料；机械手只负责操作工作室里的三台基础设备，不会自己去垃圾堆捡垃圾，也没法替你开动外面的产线机器。
                    </p>
                  </section>
                )}
                {plan.limited && (
                  <p role="alert">
                    规划达到复杂度上限，请减少数量或先准备中间材料。
                  </p>
                )}
              </>
            )}
          </div>
          <footer className="order-footer">
            <label>
              下单数量
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={orderLimits.quantity}
                step={1}
                required
                aria-label="下单数量"
                value={quantity}
                disabled={busy}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setError("");
                }}
              />
            </label>
            <button
              type="submit"
              disabled={
                !plan ||
                missing ||
                plan.limited ||
                busy ||
                disabled ||
                !!p?.workshop ||
                !onConfirm
              }
            >
              {busy ? "正在预留材料…" : "确认下单"}
            </button>
            <p>
              单次最多下单 {orderLimits.quantity} 个（不超过 {orderLimits.steps}{" "}
              道工序）。下单后会占用手工队列；若中途取消，尚未用到的材料和已做好的半成品会退回总仓库。
            </p>
            {p?.workshop && (
              <p role="status">手工队列正在使用，请先完成或取消当前任务。</p>
            )}
            {error && <p role="alert">{error}</p>}
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
