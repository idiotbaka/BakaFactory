import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BuildingDefinition, Catalog, FactoryDetail } from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import {
  workshopDuration,
  workshopMachineAvailable,
  workshopMachines,
} from "./local/workshop";

export default function BuildingRecipeGuide({
  definition,
  catalog,
  industry,
}: {
  definition: BuildingDefinition;
  catalog: Catalog;
  industry?: NonNullable<FactoryDetail["simulation"]>["industry"];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleID = useId();
  useEffect(() => {
    if (!open) return;
    const triggerElement = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const buttons = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ) ?? [],
      );
    buttons()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      // Keep editor listeners and build shortcuts behind the modal inactive.
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        const targets = buttons();
        const current = targets.indexOf(document.activeElement as HTMLElement);
        const next =
          (current + (event.shiftKey ? -1 : 1) + targets.length) %
          targets.length;
        targets[next]?.focus();
      } else if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (/^[1-6fr]$/i.test(event.key) ||
          ["Delete", "Backspace"].includes(event.key))
      ) {
        event.preventDefault();
      }
    };
    const focus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        buttons()[0]?.focus();
    };
    // Window capture also intercepts shortcuts dispatched directly on window.
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      document.body.style.overflow = previousOverflow;
      if (triggerElement?.isConnected) triggerElement.focus();
    };
  }, [open]);

  const item = catalog.items.find((i) => i.id === definition.item);
  const sources = definition.item
    ? catalog.recipes.filter((r) => r.outputs[definition.item!] > 0)
    : [];
  const related = catalog.recipes.filter(
    (r) => r.building_type === definition.id,
  );
  const itemName = (id: string) =>
    catalog.items.find((i) => i.id === id)?.name ?? id;
  const materials = (values: Record<string, number>) => (
    <div className="recipe-ingredients">
      {Object.entries(values).map(([id, n]) => {
        const d = catalog.items.find((i) => i.id === id);
        return (
          <span key={id}>
            {d && <DefinitionIcon definition={d} compact />}
            <span>
              {itemName(id)} × {n}
            </span>
          </span>
        );
      })}
    </div>
  );
  const recipeCard = (r: Catalog["recipes"][number]) => {
    const machine = catalog.buildings.find((b) => b.id === r.building_type);
    const available =
      (r.tier ?? 1) <= (industry?.stage ?? 1) &&
      (!r.gate || industry?.milestones.includes(r.gate));
    const inWorkshop = workshopMachineAvailable(
      industry?.crafted,
      r.building_type,
    );
    return (
      <article className="recipe-card" key={r.id}>
        <h4 className="recipe-name">
          {r.name}
          <span>{r.duration_ms / 1000} 秒 / 批</span>
        </h4>
        <p className="recipe-guide-meta">
          {r.id.toUpperCase()} · P{r.tier ?? 1} ·{" "}
          {available ? "阶段条件已满足" : "阶段条件未满足"}
        </p>
        <h5>每批原料</h5>
        {materials(r.inputs)}
        <div className="recipe-arrow" aria-hidden="true">
          ↓
        </div>
        <h5>每批产物</h5>
        {materials(r.outputs)}
        <p>
          加工设备：{machine?.name ?? r.building_type}。
          {inWorkshop
            ? `可在起始厂区「工作室 → ${machine?.name ?? r.building_type}」加工。`
            : `安装${machine?.name ?? r.building_type}后，选择此配方并提供原料及所需动力。`}
        </p>
        {workshopMachines.some((id) => id === r.building_type) && (
          <p>
            工作室手工耗时：{workshopDuration(r)} 秒 /
            批（原配方工时的一半，向下取整且至少 1 秒）。
          </p>
        )}
        {!inWorkshop &&
          workshopMachines.some((id) => id === r.building_type) && (
            <p>首次制造该加工设备后，也可解锁工作室的同名子分类。</p>
          )}
        {r.gate && <p>前置里程碑：首次制造{itemName(r.gate)}。</p>}
        {!!r.power_kw && <p>额定功率：{r.power_kw} kW，需匹配设备能源。</p>}
        {!!r.conditions?.length && (
          <p>每批完成时还需消费匹配的真实作业凭据，具体要求见设备检视。</p>
        )}
      </article>
    );
  };
  return (
    <>
      <button
        ref={trigger}
        className="recipe-guide-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        获取来源和关联配方
      </button>
      {open &&
        createPortal(
          <div
            className="recipe-guide-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={panel}
              className="recipe-guide-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleID}
            >
              <header className="recipe-guide-header">
                <h2 id={titleID}>{definition.name} · 获取来源和关联配方</h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="关闭获取来源和关联配方"
                >
                  关闭 ×
                </button>
              </header>
              <div
                className="recipe-guide-content"
                tabIndex={0}
                aria-label="配方详情滚动区域"
              >
                <section aria-label="获取方式">
                  <h3>获取方式</h3>
                  {definition.fixed ? (
                    <p>
                      创建厂区时自动提供的固定设施，无需合成或消耗安装道具。
                    </p>
                  ) : definition.item ? (
                    <>
                      <div className="recipe-guide-install">
                        {item && <DefinitionIcon definition={item} />}
                        <div>
                          <strong>
                            安装「{definition.name}」实际消耗：
                            {item?.name ?? definition.item} × 1
                          </strong>
                          <p>从当前厂区仓库扣除；拆除返还同一道具。</p>
                        </div>
                      </div>
                      {item?.name !== definition.name && (
                        <p className="recipe-guide-alias">
                          建筑名称「{definition.name}」对应道具「
                          {item?.name ?? definition.item}
                          」；请按道具名查找制作配方。
                        </p>
                      )}
                      {definition.role === "source" && (
                        <p>
                          仅可安装在起始厂区地图顶部垃圾堆；数量受当前阶段限制。
                        </p>
                      )}
                      <h4>生产安装道具的配方（{sources.length}）</h4>
                      <div className="recipe-guide-grid">
                        {sources.map(recipeCard)}
                      </div>
                      {!sources.length && (
                        <p className="no-recipes">
                          当前目录未配置该安装道具的生产配方，暂无可展示的制作来源。
                        </p>
                      )}
                    </>
                  ) : (
                    <p>该设施未配置安装道具，没有对应的道具制作配方。</p>
                  )}
                </section>
                <section aria-label="关联加工配方">
                  <h3>该设施可执行的配方（{related.length}）</h3>
                  <div className="recipe-guide-grid">
                    {related.map(recipeCard)}
                  </div>
                  {!related.length && (
                    <p className="no-recipes">
                      {definition.fixed
                        ? "工厂仓库接收产线物品并计入本区仓库，不执行加工配方。"
                        : "该设施不执行加工配方；获取方式见上方。"}
                    </p>
                  )}
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
