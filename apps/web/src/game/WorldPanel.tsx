import { useCallback, useId, useState } from "react";
import {
  ioLimit,
  ioUnlocked,
  pickupType,
  intakeType,
} from "./local/warehouseIO";
import { itemDefinitions } from "./local/catalog";
import type { FactoryDetail } from "../api/client";
import {
  districtLimit,
  expansionCost,
  type DistrictSummary,
  type WorldAction,
} from "./local/world";
import WorldOperationDialog, {
  type DistrictOperation,
} from "./WorldOperationDialog";

export default function WorldPanel({
  factory,
  districts,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  districts: DistrictSummary[];
  disabled: boolean;
  act: (action: WorldAction) => void;
}) {
  const [name, setName] = useState("");
  const [operation, setOperation] = useState<DistrictOperation | null>(null);
  const closeOperation = useCallback(() => setOperation(null), []);
  const nameID = useId();
  const stage = factory.simulation?.industry?.stage ?? 1;
  const unlocked = ioUnlocked(factory.simulation);
  const limit = districtLimit(stage);
  const expansionAvailable = Object.entries(expansionCost()).every(
    ([item, cost]) => (factory.simulation?.warehouse[item] ?? 0) >= -cost,
  );
  const validName = !!name.trim() && !/\p{Cc}/u.test(name);
  const target = districts.find((d) => d.id === operation?.id);
  return (
    <section className="world-panel" aria-label="厂区管理">
      <section className="world-expansion" aria-label="扩建厂区">
        <div className="world-expansion-heading">
          <h4>扩建厂区</h4>
          <span className="world-capacity">
            {districts.length} / {limit} 厂区
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !disabled &&
              validName &&
              expansionAvailable &&
              districts.length < limit
            )
              act({ type: "expand_district", name });
          }}
        >
          <label className="sr-only" htmlFor={nameID}>
            新厂区名称
          </label>
          <input
            id={nameID}
            maxLength={32}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
            placeholder="为新工厂起个名字"
          />
          <button
            type="submit"
            disabled={
              disabled ||
              !validName ||
              !expansionAvailable ||
              districts.length >= limit
            }
          >
            {districts.length >= limit ? "已达阶段上限" : "＋ 扩建厂区"}
          </button>
        </form>
        <div className="world-expansion-footer">
          <span>扩建消耗</span>
          {Object.entries(expansionCost()).map(([id, cost]) => (
            <span
              className={
                (factory.simulation?.warehouse[id] ?? 0) < -cost
                  ? "is-short"
                  : ""
              }
              key={id}
            >
              {itemDefinitions.get(id)?.name} × {-cost}
            </span>
          ))}
        </div>
      </section>
      <div className="world-list-heading">
        <h4>我的工厂</h4>
        <span>共用总仓库 · 各厂同步生产</span>
      </div>
      <div className="world-districts">
        {districts.map((d) => {
          const active = factory.id === d.id;
          const pickupFull =
            (d.pickup_terminals ?? 0) >= ioLimit(stage, pickupType);
          const intakeFull =
            (d.intake_terminals ?? 0) >= ioLimit(stage, intakeType);
          return (
            <article
              className={"world-district-card" + (active ? " is-active" : "")}
              aria-label={d.name}
              key={d.id}
            >
              <div className="world-district-heading">
                <button
                  className="world-district-select"
                  disabled={disabled}
                  aria-pressed={active}
                  title={active ? "当前工厂" : "切换至" + d.name}
                  onClick={() => act({ type: "select_district", id: d.id })}
                >
                  {d.name}
                </button>
                <span className="world-building-count">{d.buildings} 建筑</span>
              </div>
              <div className="world-district-tags" aria-label="工厂状态">
                {active && <span className="world-tag is-current">当前</span>}
                {d.headquarters && <span className="world-tag">起始厂</span>}
                {unlocked ? (
                  <>
                    <span className="world-tag is-pickup">
                      取货 {d.pickup_terminals ?? 0}/
                      {ioLimit(stage, pickupType)}
                    </span>
                    <span className="world-tag is-intake">
                      存入 {d.intake_terminals ?? 0}/
                      {ioLimit(stage, intakeType)}
                    </span>
                  </>
                ) : (
                  <span className="world-tag">终端未解锁</span>
                )}
              </div>
              <div className="world-district-actions">
                {unlocked && (
                  <>
                    <button
                      className="world-upgrade-pickup"
                      disabled={disabled || pickupFull}
                      title={
                        pickupFull
                          ? "取货终端已达当前阶段上限"
                          : "查看取货终端升级费用与安装说明"
                      }
                      onClick={() =>
                        setOperation({ id: d.id, kind: pickupType })
                      }
                    >
                      {pickupFull ? "取货已满" : "＋ 取货升级"}
                    </button>
                    <button
                      className="world-upgrade-intake"
                      disabled={disabled || intakeFull}
                      title={
                        intakeFull
                          ? "存入终端已达当前阶段上限"
                          : "查看存入终端升级费用与安装说明"
                      }
                      onClick={() =>
                        setOperation({ id: d.id, kind: intakeType })
                      }
                    >
                      {intakeFull ? "存入已满" : "＋ 存入升级"}
                    </button>
                  </>
                )}
                <button
                  className="world-rename"
                  disabled={disabled}
                  onClick={() => setOperation({ id: d.id, kind: "rename" })}
                >
                  改名
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {operation && target && (
        <WorldOperationDialog
          key={operation.id + ":" + operation.kind}
          operation={operation}
          district={target}
          factory={factory}
          disabled={disabled}
          act={act}
          onClose={closeOperation}
        />
      )}
    </section>
  );
}
