import { useLayoutEffect, useId, useMemo, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import { warehouseSummary } from "./local/warehouseActivity";

export default function FactoryIOCard({
  factory,
  catalog,
  onClose,
  anchor,
  id,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  onClose: () => void;
  anchor: RefObject<HTMLButtonElement | null>;
  id: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const title = useId();
  const tick = factory.simulation?.tick ?? 0;
  const summary = useMemo(
    () => warehouseSummary(factory.warehouse_activity, tick, factory.id),
    [factory.warehouse_activity, tick, factory.id],
  );
  useLayoutEffect(() => {
    const card = panel.current!;
    const trigger = anchor.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(600, window.innerWidth - 24);
    card.style.width = `${width}px`;
    card.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    card.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    card.style.maxHeight = `${Math.max(0, Math.min(420, rect.top - 20))}px`;
    card.style.visibility = "visible";
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (card.contains(target) || trigger.contains(target));
    const outside = (event: Event) => {
      if (!inside(event.target)) onClose();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !card.contains(event.target))
        onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        onClose();
        trigger.focus({ preventScroll: true });
      } else if (inside(event.target)) event.stopImmediatePropagation();
    };
    card.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);
  const list = (values: Record<string, number>, label: string) => (
    <section aria-label={label}>
      <h4>{label}</h4>
      <div
        className="factory-io-items"
        tabIndex={0}
        aria-label={`${label}明细`}
      >
        <ul className="factory-io-list">
          {catalog.items
            .filter((i) => (values[i.id] ?? 0) > 0)
            .map((i) => (
              <li key={i.id}>
                <DefinitionIcon definition={i} compact />
                <span>
                  {i.name}
                  <small>{i.code}</small>
                </span>
                <span>
                  {values[i.id] === Number.MAX_SAFE_INTEGER ? "≥" : ""}
                  {values[i.id].toLocaleString()} u
                </span>
              </li>
            ))}
        </ul>
        {!Object.keys(values).length && (
          <p>
            最近 1 分钟没有{label === "从总仓库取出" ? "取出" : "存入"}物品。
          </p>
        )}
      </div>
    </section>
  );
  return createPortal(
    <section
      ref={panel}
      id={id}
      className="factory-io-card"
      aria-labelledby={title}
      tabIndex={-1}
    >
      <header className="factory-io-heading">
        <h3 id={title}>{factory.name} · io数据</h3>
        <button
          type="button"
          aria-label="关闭io数据"
          onClick={() => {
            onClose();
            anchor.current?.focus({ preventScroll: true });
          }}
        >
          ×
        </button>
      </header>
      <div className="factory-io-body">
        <p>最近 1 分钟 · 本工厂内的产物io数据</p>
        {summary.ready ? (
          <div className="factory-io-columns">
            {list(summary.withdrawn, "从总仓库取出")}
            {list(summary.received, "存入总仓库")}
          </div>
        ) : (
          <p role="status">正在积累数据，运行满 1 分钟后显示。</p>
        )}
      </div>
    </section>,
    document.body,
  );
}
