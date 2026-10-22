import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import {
  createItemInfoIndex,
  itemKindNames,
  splitItemText,
} from "./itemInfoModel";
import { workshopMachineAvailable, workshopMachines } from "./local/workshop";
import "./ItemInfo.css";

type Industry = NonNullable<FactoryDetail["simulation"]>["industry"];
type Selection = {
  item: string;
  triggerID: string;
  anchor: HTMLButtonElement;
  rect: DOMRect;
};
type InfoContext = {
  index: ReturnType<typeof createItemInfoIndex>;
  selected?: Selection;
  dialogID: string;
  open: (item: string, anchor: HTMLButtonElement, triggerID: string) => void;
};
const ItemInfoContext = createContext<InfoContext | null>(null);

// A panel can also be rendered on its own without creating nested popovers
// when it is already inside the shared industry-view scope.
export function ItemInfoProvider(props: {
  catalog: Catalog;
  industry?: Industry;
  children: ReactNode;
}) {
  const parent = useContext(ItemInfoContext);
  return parent ? props.children : <ItemInfoScope {...props} />;
}

function ItemInfoScope({
  catalog,
  industry,
  children,
}: {
  catalog: Catalog;
  industry?: Industry;
  children: ReactNode;
}) {
  const index = useMemo(() => createItemInfoIndex(catalog), [catalog]);
  const [selected, setSelected] = useState<Selection>();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogID = useId();
  const titleID = useId();
  const item = selected && index.items.get(selected.item);
  const closeAndFocus = () => {
    setSelected(undefined);
    if (selected?.anchor.isConnected)
      selected.anchor.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const card = panel.current;
    if (!selected || !card) return;
    const { width, height } = card.getBoundingClientRect();
    const margin = 12,
      gap = 8,
      maxX = Math.max(margin, window.innerWidth - width - margin),
      maxY = Math.max(margin, window.innerHeight - height - margin);
    const top =
      selected.rect.bottom + gap <= maxY
        ? selected.rect.bottom + gap
        : selected.rect.top - height - gap;
    card.style.left = `${Math.max(margin, Math.min(selected.rect.left, maxX))}px`;
    card.style.top = `${Math.max(margin, Math.min(top, maxY))}px`;
    card.style.visibility = "visible";
    closeButton.current?.focus({ preventScroll: true });
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !selected.anchor.contains(event.target)
      )
        setSelected(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelected(undefined);
        if (selected.anchor.isConnected)
          selected.anchor.focus({ preventScroll: true });
      } else if (
        event.target instanceof Node &&
        panel.current?.contains(event.target)
      ) {
        // Only isolate keys while the card has focus; outside clicks still
        // reach their normal controls, including the map and view tabs.
        event.stopImmediatePropagation();
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (/^[1-6fr]$/i.test(event.key) ||
            ["Delete", "Backspace"].includes(event.key))
        )
          event.preventDefault();
      }
    };
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        setSelected(undefined);
    };
    const resize = () => setSelected(undefined);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key, true);
    };
  }, [selected]);

  const materials = (values: Record<string, number>) => (
    <ul className="item-info-materials">
      {Object.entries(values).map(([id, count]) => (
        <li key={id}>
          <ItemName item={id} /> × {count.toLocaleString()}
        </li>
      ))}
    </ul>
  );
  const facilities = item
    ? catalog.buildings.filter((b) => b.item === item.id)
    : [];
  const sources = item ? (index.sources.get(item.id) ?? []) : [];
  return (
    <ItemInfoContext.Provider
      value={{
        index,
        selected,
        dialogID,
        open: (id, anchor, triggerID) => {
          if (selected?.triggerID === triggerID) {
            closeAndFocus();
            return;
          }
          setSelected({
            item: id,
            triggerID:
              panel.current?.contains(anchor) && selected
                ? selected.triggerID
                : triggerID,
            // Following ingredients replaces the card but retains the original
            // external trigger for focus restoration after its content changes.
            anchor:
              panel.current?.contains(anchor) && selected
                ? selected.anchor
                : anchor,
            rect: anchor.getBoundingClientRect(),
          });
        },
      }}
    >
      {children}
      {selected &&
        item &&
        createPortal(
          <div
            ref={panel}
            id={dialogID}
            role="dialog"
            aria-labelledby={titleID}
            className="item-info-card"
            style={{ visibility: "hidden" }}
          >
            <header className="item-info-header">
              <DefinitionIcon definition={item} compact />
              <h3 id={titleID}>{item.name}</h3>
              <button
                ref={closeButton}
                type="button"
                onClick={closeAndFocus}
                aria-label="关闭道具详情"
              >
                ×
              </button>
            </header>
            <div
              className="item-info-body"
              tabIndex={0}
              aria-label="道具详情滚动区域"
              key={item.id}
            >
              <p>{item.description}</p>
              <dl className="item-info-facts">
                <div>
                  <dt>模组代号</dt>
                  <dd>{item.code}</dd>
                </div>
                <div>
                  <dt>实体类型</dt>
                  <dd>物品 · {itemKindNames[item.kind ?? ""] ?? "材料"}</dd>
                </div>
                <div>
                  <dt>所属阶段</dt>
                  <dd>
                    P{item.tier ?? 1}
                    {item.legacy ? " · 旧版兼容" : ""}
                  </dd>
                </div>
              </dl>
              {!!facilities.length && (
                <p>
                  安装用途：{facilities.map((b) => b.name).join("、")}
                  ；每次安装消耗该道具 × 1。
                </p>
              )}
              <h4>
                获取来源
                {sources.length > 0 ? `（${sources.length} 条配方）` : ""}
              </h4>
              {item.id === catalog.root_item && (
                <p>
                  在起始厂区工作室的“无尽垃圾堆”拾取；也可在地图顶部安装垃圾提取口，每
                  10 秒提取 12 包，数量受阶段上限限制。
                </p>
              )}
              {sources.map((recipe) => {
                const machine = catalog.buildings.find(
                  (b) => b.id === recipe.building_type,
                );
                const stageReady = (recipe.tier ?? 1) <= (industry?.stage ?? 1);
                const gateReady =
                  !recipe.gate || industry?.milestones.includes(recipe.gate);
                const manual = workshopMachines.some(
                  (id) => id === recipe.building_type,
                );
                return (
                  <section
                    className="item-info-recipe"
                    key={recipe.id}
                    aria-label={`${recipe.id.toUpperCase()} ${recipe.name}`}
                  >
                    <h5>{recipe.name}</h5>
                    <p>
                      {recipe.id.toUpperCase()} · {recipe.duration_ms / 1000} 秒
                      / 批 · P{recipe.tier ?? 1}
                      {recipe.legacy ? " · 旧版兼容配方" : ""}
                    </p>
                    <p>加工设备：{machine?.name ?? recipe.building_type}</p>
                    {manual && (
                      <p>
                        {workshopMachineAvailable(
                          industry?.crafted,
                          recipe.building_type,
                        )
                          ? `工作室 → ${machine?.name ?? recipe.building_type}`
                          : `首次制造${machine?.name ?? recipe.building_type}后解锁工作室同名分类。`}
                      </p>
                    )}
                    {!stageReady && (
                      <p className="item-info-locked">阶段条件未满足</p>
                    )}
                    {recipe.gate && (
                      <p>
                        前置里程碑：首次制造
                        <ItemName item={recipe.gate} />（
                        {gateReady ? "已达成" : "未达成"}）。
                      </p>
                    )}
                    <h6>每批原料</h6>
                    {materials(recipe.inputs)}
                    <h6>每批产物</h6>
                    {materials(recipe.outputs)}
                    {!!recipe.power_kw && (
                      <p>额定功率：{recipe.power_kw} kW，需匹配设备能源。</p>
                    )}
                    {!!recipe.conditions?.length && (
                      <p>
                        完成时还需消费匹配的真实作业凭据，具体要求见设备检视。
                      </p>
                    )}
                  </section>
                );
              })}
              {!sources.length && item.id !== catalog.root_item && (
                <p>
                  当前目录没有该道具的加工配方
                  {item.legacy ? "，仅保留旧存档兼容" : ""}。
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </ItemInfoContext.Provider>
  );
}

export function ItemName({
  item,
  children,
}: {
  item: string;
  children?: ReactNode;
}) {
  const context = useContext(ItemInfoContext);
  const triggerID = useId();
  const definition = context?.index.items.get(item);
  if (!context || !definition) return children ?? definition?.name ?? item;
  const expanded = context.selected?.triggerID === triggerID;
  return (
    <button
      type="button"
      className="item-name-link"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={expanded ? context.dialogID : undefined}
      onClick={(event) => context.open(item, event.currentTarget, triggerID)}
    >
      {children ?? definition.name}
    </button>
  );
}

export function ItemText({ children }: { children: string }) {
  const context = useContext(ItemInfoContext);
  if (!context) return children;
  return splitItemText(children, context.index).map((part, i) =>
    part.item ? (
      <ItemName key={i} item={part.item}>
        {part.text}
      </ItemName>
    ) : (
      part.text
    ),
  );
}
