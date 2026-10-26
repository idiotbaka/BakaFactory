import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FactoryDetail } from "../api/client";
import type { DistrictSummary, WorldAction } from "./local/world";
import {
  ioCost,
  ioLimit,
  ioUnlocked,
  pickupType,
  intakeType,
} from "./local/warehouseIO";
import { buildingDefinitions, itemDefinitions } from "./local/catalog";
import DefinitionIcon from "./DefinitionIcon";

export type DistrictOperation = {
  id: string;
  kind: "rename" | typeof pickupType | typeof intakeType;
};

export default function WorldOperationDialog({
  operation,
  district,
  factory,
  disabled,
  act,
  onClose,
}: {
  operation: DistrictOperation;
  district: DistrictSummary;
  factory: FactoryDetail;
  disabled: boolean;
  act: (action: WorldAction) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(district.name);
  const panel = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleID = useId(),
    descriptionID = useId(),
    nameID = useId();
  const rename = operation.kind === "rename";
  useEffect(() => {
    const dialog = panel.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    if (rename) input.current?.select();
    const key = (event: KeyboardEvent) => {
      // Native dialog owns focus/inert; block background factory shortcuts
      // without interfering with normal text input or Tab navigation.
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose, rename]);
  const stage = factory.simulation?.industry?.stage ?? 1;
  const count =
    (operation.kind === pickupType
      ? district.pickup_terminals
      : district.intake_terminals) ?? 0;
  const limit = ioLimit(stage, operation.kind);
  const cost = ioCost(stage, operation.kind);
  const [item, amount] = Object.entries(cost)[0];
  const stock = factory.simulation?.warehouse[item] ?? 0;
  const canInstall =
    ioUnlocked(factory.simulation) && count < limit && stock >= -amount;
  const validName =
    !!name.trim() && [...name.trim()].length <= 32 && !/\p{Cc}/u.test(name);
  const label = operation.kind === pickupType ? "取货终端" : "存入终端";
  const definition = buildingDefinitions.get(operation.kind);
  return createPortal(
    <dialog
      ref={panel}
      className="world-action-dialog"
      aria-labelledby={titleID}
      aria-describedby={descriptionID}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || (rename ? !validName : !canInstall)) return;
          act(
            operation.kind === "rename"
              ? { type: "rename_district", id: district.id, name: name.trim() }
              : {
                  type: "upgrade_io",
                  id: district.id,
                  terminal: operation.kind,
                },
          );
          onClose();
        }}
      >
        <header className="world-dialog-heading">
          <h3 id={titleID}>{rename ? "修改工厂名称" : `升级${label}`}</h3>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="world-dialog-body">
          <p className="world-dialog-target" id={descriptionID}>
            {district.name}
          </p>
          {rename ? (
            <label htmlFor={nameID}>
              工厂名称
              <input
                ref={input}
                id={nameID}
                value={name}
                maxLength={32}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : (
            <>
              <div className="world-terminal-preview">
                {definition && <DefinitionIcon definition={definition} />}
                <div>
                  <span>{label}</span>
                  <span className="world-terminal-capacity">
                    {count} → {count + 1} / {limit}
                  </span>
                </div>
              </div>
              <p className="world-install-hint">
                确认后，终端会自动创建在该工厂内的空闲格子中，可以自由拖动到合适位置。
              </p>
              <p className="world-install-detail">
                {operation.kind === pickupType
                  ? "取货终端初装暂停，选好物品后启用；可旋转，不可删除。"
                  : "存入终端四面均可接货，无需调整朝向；不可删除。"}
              </p>
              <div className="world-dialog-cost">
                <span>本次消耗</span>
                <span>
                  {itemDefinitions.get(item)?.name} × {-amount}
                </span>
                <span className={stock < -amount ? "is-short" : ""}>
                  库存 {stock.toLocaleString()}
                  {stock < -amount ? " · 材料不足" : ""}
                </span>
              </div>
              {count >= limit && <p role="status">已达当前阶段上限。</p>}
            </>
          )}
        </div>
        <footer className="world-dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="world-dialog-confirm"
            type="submit"
            disabled={disabled || (rename ? !validName : !canInstall)}
          >
            {rename ? "保存名称" : "确认安装"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
