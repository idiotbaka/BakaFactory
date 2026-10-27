import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Catalog } from "../api/client";
import { createCatalogSearch } from "./catalogSearch";
import DefinitionIcon from "./DefinitionIcon";
import ItemSprite from "./ItemSprite";
import "./GameSelect.css";

type Choice = { value: string; label: string; disabled: boolean };
type Kind = "item" | "recipe" | "plain";
type RecipeDefinition = Catalog["recipes"][number];
type Props = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "value" | "onChange"
> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  catalog: Catalog;
  kind?: Kind;
};

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join("");
}

// Options are declarative data only. No native select / option is mounted.
function readChoices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return readChoices(child.props.children);
    if (child.type !== "option") return [];
    const label = textOf(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: !!child.props.disabled,
      },
    ];
  });
}

export default function GameSelect({
  value,
  onValueChange,
  children,
  catalog,
  kind,
  disabled,
  className = "",
  id,
  ...props
}: Props) {
  const generatedID = useId(),
    triggerID = id ?? `select-${generatedID}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);
  const options = readChoices(children);
  const selected = options.find((o) => o.value === String(value));
  const resolvedKind =
    kind ??
    (options.some((o) => catalog.items.some((i) => i.id === o.value))
      ? "item"
      : options.some((o) => catalog.recipes.some((r) => r.id === o.value))
        ? "recipe"
        : "plain");
  const definition =
    catalog.items.find((i) => i.id === selected?.value) ??
    catalog.buildings.find((b) => b.id === selected?.value);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus && trigger.current?.isConnected)
      trigger.current.focus({ preventScroll: true });
  }, []);
  const expanded = open && !disabled;
  return (
    <>
      <button
        {...props}
        id={triggerID}
        ref={trigger}
        type="button"
        role="combobox"
        className={`game-select ${className}`}
        disabled={disabled}
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-controls={expanded ? `${triggerID}-list` : undefined}
        onClick={() => (expanded ? close() : setOpen(true))}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (
            ["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {definition && (
          <span className="game-select-icon">
            <DefinitionIcon definition={definition} />
          </span>
        )}
        <span className="game-select-value" title={selected?.label}>
          {selected?.label ?? "请选择"}
        </span>
        <svg
          className="game-select-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {expanded && (
        <ChoicePopup
          triggerID={triggerID}
          options={options}
          value={String(value)}
          catalog={catalog}
          kind={resolvedKind}
          onClose={close}
          onChoose={(choice) => {
            close();
            if (choice !== String(value)) onValueChange(choice);
          }}
        />
      )}
    </>
  );
}

function RecipeMaterials({
  values,
  catalog,
}: {
  values: Record<string, number>;
  catalog: Catalog;
}) {
  const entries = Object.entries(values);
  return (
    <span className="game-select-materials">
      {entries.length ? (
        entries.map(([id, count], index) => (
          <Fragment key={id}>
            {index > 0 && <span className="game-select-divider"> / </span>}
            <span className="game-select-material">
              <span className="game-select-icon">
                <ItemSprite id={id} />
              </span>
              <span>
                {count}× {catalog.items.find((i) => i.id === id)?.name ?? id}
              </span>
            </span>
          </Fragment>
        ))
      ) : (
        <span className="game-select-muted">无原料</span>
      )}
    </span>
  );
}

function recipeText(r: RecipeDefinition, catalog: Catalog) {
  const materials = (values: Record<string, number>) =>
    Object.entries(values)
      .map(
        ([id, count]) =>
          `${count}× ${catalog.items.find((i) => i.id === id)?.name ?? id}`,
      )
      .join(" / ") || "无原料";
  return `${r.name} ${r.id.toUpperCase()} ${materials(r.inputs)} → ${materials(r.outputs)} · ${r.duration_ms / 1000} 秒`;
}

function ChoicePopup({
  triggerID,
  options,
  value,
  catalog,
  kind,
  onChoose,
  onClose,
}: {
  triggerID: string;
  options: Choice[];
  value: string;
  catalog: Catalog;
  kind: Kind;
  onChoose: (value: string) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""),
    [phase, setPhase] = useState(0),
    [active, setActive] = useState(value);
  const searchable = kind !== "plain" || options.length > 6;
  const items = useMemo(
    () => new Map(catalog.items.map((i) => [i.id, i])),
    [catalog],
  );
  const recipes = useMemo(
    () => new Map(catalog.recipes.map((r) => [r.id, r])),
    [catalog],
  );
  const matches = createCatalogSearch(query);
  const visible = options.filter((o) => {
    const item = kind === "item" ? items.get(o.value) : undefined;
    if (item && phase && (item.tier ?? 1) !== phase) return false;
    const recipe = kind === "recipe" ? recipes.get(o.value) : undefined;
    return (
      matches({ name: o.label, id: o.value }) ||
      (!!item && matches(item)) ||
      (!!recipe &&
        (matches(recipe) ||
          Object.keys({ ...recipe.inputs, ...recipe.outputs }).some((id) =>
            matches(items.get(id) ?? { id }),
          )))
    );
  });
  const enabled = visible.filter((o) => !o.disabled);
  const activeChoice =
    enabled.find((o) => o.value === active) ??
    enabled.find((o) => o.value === value) ??
    enabled[0];
  const activeIndex = activeChoice ? visible.indexOf(activeChoice) : -1;
  const activeID =
    activeIndex >= 0 ? `${triggerID}-option-${activeIndex}` : undefined;
  const searchLabel =
    kind === "item"
      ? "搜索物品"
      : kind === "recipe"
        ? "搜索配方或原料、产物"
        : "搜索选项";
  const position = useCallback(() => {
    const node = panel.current,
      button = document.getElementById(triggerID);
    if (!node || !button) return;
    const rect = button.getBoundingClientRect();
    if (
      !button.isConnected ||
      !rect.width ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight
    ) {
      onClose(false);
      return;
    }
    const width = Math.min(
      window.innerWidth - 24,
      Math.max(
        rect.width,
        kind === "recipe" ? 560 : kind === "item" ? 380 : 240,
      ),
    );
    const below = window.innerHeight - rect.bottom - 18,
      above = rect.top - 18;
    const up = below < 280 && above > below;
    const height = Math.max(0, Math.min(480, up ? above : below));
    node.style.width = `${width}px`;
    node.style.maxHeight = `${height}px`;
    node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    node.style.top = `${up ? Math.max(12, rect.top - node.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
  }, [kind, onClose, triggerID]);
  useLayoutEffect(() => {
    position();
    (search.current ?? list.current)?.focus({ preventScroll: true });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(position);
    if (panel.current) resize?.observe(panel.current);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !document.getElementById(triggerID)?.contains(target)
      )
        onClose(false);
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) onClose(false);
    };
    const blur = () => onClose(false);
    const focus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !document.getElementById(triggerID)?.contains(target)
      )
        onClose(false);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", blur);
    window.addEventListener("blur", blur);
    document.addEventListener("focusin", focus);
    return () => {
      resize?.disconnect();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", blur);
      window.removeEventListener("blur", blur);
      document.removeEventListener("focusin", focus);
    };
  }, [onClose, position, triggerID]);
  useLayoutEffect(() => {
    position();
  }, [position, query, phase, visible.length]);
  useLayoutEffect(() => {
    if (activeID)
      document.getElementById(activeID)?.scrollIntoView({ block: "nearest" });
  }, [activeID, activeChoice?.value]);
  function key(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      const controls = panel.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,[tabindex="0"]',
      );
      const boundary = event.shiftKey
        ? controls?.[0]
        : controls?.[controls.length - 1];
      // Keep phase buttons reachable; at the edge, resume the page's focus
      // order from the trigger instead of the portalled document position.
      if (event.target === boundary) onClose();
    } else if (
      event.target instanceof Element &&
      event.target.closest(".game-select-phases")
    ) {
      return;
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      // Home/End keep their normal caret meaning in the search field.
      if (
        event.target === search.current &&
        ["Home", "End"].includes(event.key)
      )
        return;
      event.preventDefault();
      const index = enabled.findIndex((o) => o.value === activeChoice?.value);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) %
              enabled.length;
      if (enabled[next]) setActive(enabled[next].value);
    } else if (
      event.key === "Enter" ||
      (event.key === " " && event.target === list.current)
    ) {
      event.preventDefault();
      if (activeChoice) onChoose(activeChoice.value);
    }
  }
  return createPortal(
    <div
      ref={panel}
      className={`game-select-popup is-${kind}`}
      data-game-select-popup=""
      onKeyDown={key}
    >
      {kind === "item" && (
        <div
          className="game-select-phases"
          role="group"
          aria-label="物品阶段筛选"
        >
          {[0, 1, 2, 3, 4, 5, 6].map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={phase === p}
              onClick={() => {
                setPhase(p);
                setActive("");
                search.current?.focus();
              }}
            >
              {p ? `P${p}` : "全部"}
            </button>
          ))}
        </div>
      )}
      {searchable && (
        <div className="game-select-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={search}
            type="search"
            aria-label={searchLabel}
            placeholder={
              kind === "recipe"
                ? "配方 / 原料 / 产物 / 拼音"
                : "名称 / 编号 / 拼音"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive("");
            }}
            aria-controls={`${triggerID}-list`}
            aria-activedescendant={activeID}
          />
        </div>
      )}
      <div
        ref={list}
        id={`${triggerID}-list`}
        className="game-select-list"
        role="listbox"
        aria-labelledby={triggerID}
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={activeID}
      >
        {visible.map((o, index) => {
          const item = kind === "item" ? items.get(o.value) : undefined;
          const recipe = kind === "recipe" ? recipes.get(o.value) : undefined;
          const building =
            kind === "plain"
              ? catalog.buildings.find((b) => b.id === o.value)
              : undefined;
          return (
            <div
              key={o.value}
              id={`${triggerID}-option-${index}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              aria-label={recipe ? recipeText(recipe, catalog) : o.label}
              className={`game-select-option ${o.value === activeChoice?.value ? "is-active" : ""}`}
              onPointerMove={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  !o.disabled &&
                  active !== o.value
                )
                  setActive(o.value);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!o.disabled) onChoose(o.value);
              }}
            >
              <span className="game-select-option-check" aria-hidden="true">
                {o.value === value ? "✓" : ""}
              </span>
              {recipe ? (
                <span className="game-select-recipe">
                  <span className="game-select-option-title">
                    {recipe.name}
                    <small>
                      {recipe.id.toUpperCase()} · {recipe.duration_ms / 1000} 秒
                      {o.disabled ? " · 未解锁" : ""}
                    </small>
                  </span>
                  <span className="game-select-equation">
                    <RecipeMaterials values={recipe.inputs} catalog={catalog} />
                    <span className="game-select-arrow">→</span>
                    <RecipeMaterials
                      values={recipe.outputs}
                      catalog={catalog}
                    />
                  </span>
                </span>
              ) : (
                <>
                  {(item || building) && (
                    <span className="game-select-icon">
                      <DefinitionIcon definition={(item ?? building)!} />
                    </span>
                  )}
                  <span className="game-select-option-title">
                    <span>{o.label}</span>
                    {item && (
                      <small>
                        {item.code} · P{item.tier ?? 1}
                      </small>
                    )}
                  </span>
                  {o.disabled && (
                    <small className="game-select-muted">不可选</small>
                  )}
                </>
              )}
            </div>
          );
        })}
        {!visible.length && (
          <div className="game-select-empty">
            没有匹配的
            {kind === "item" ? "物品" : kind === "recipe" ? "配方" : "选项"}
            {kind === "item"
              ? "，试试其他阶段或关键词。"
              : "，试试其他关键词。"}
          </div>
        )}
      </div>
      {searchable && (
        <div className="game-select-footer">
          <span>{visible.length} 个选项</span>
          <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
        </div>
      )}
    </div>,
    document.getElementById(triggerID)?.closest("dialog[open]") ??
      document.body,
  );
}
