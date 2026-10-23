import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { questAmount, questItemAmount } from "./local/quests";
import { questVisible } from "./local/questRules";
import DefinitionIcon from "./DefinitionIcon";
import { ItemInfoProvider, ItemName, ItemText } from "./ItemInfo";

export default function QuestPanel({
  factory,
  catalog,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  disabled: boolean;
  act?: (action: WorldAction) => void;
}) {
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const p = factory.simulation?.industry,
    progress = p?.quests;
  const quests = (catalog.quests ?? []).filter((q) =>
    questVisible(p, q, catalog.quests),
  );
  const claimed = new Set(progress?.claimed ?? []);
  const completed = new Set(progress?.completed ?? []);
  const list = quests.filter(
    (q) => claimed.has(q.id) === (tab === "completed"),
  );
  const hiddenFinal = catalog.quests?.find(
    (q) =>
      q.stage_final &&
      q.tier === (p?.stage ?? 1) &&
      !questVisible(p, q, catalog.quests),
  );
  return (
    <ItemInfoProvider catalog={catalog} industry={p}>
      <section className="quest-panel" aria-label="阶段任务">
        {hiddenFinal && (
          <p className="quest-final-hint">
            终局任务会在工厂发展到一定程度后出现
          </p>
        )}
        <div className="quest-tabs" role="group" aria-label="任务分类">
          <button
            aria-pressed={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            待完成（{quests.filter((q) => !claimed.has(q.id)).length}）
          </button>
          <button
            aria-pressed={tab === "completed"}
            onClick={() => setTab("completed")}
          >
            已完成（{quests.filter((q) => claimed.has(q.id)).length}）
          </button>
        </div>
        {!list.length && (
          <p>
            {tab === "completed"
              ? "还没有已领取奖励的任务。"
              : "当前阶段任务已全部领奖，继续建设工厂吧。"}
          </p>
        )}
        <ol className="quest-list">
          {list.map((q) => {
            const done = completed.has(q.id),
              taken = claimed.has(q.id);
            return (
              <li key={q.id}>
                <article
                  className={`quest-card${done && !taken ? " is-ready" : ""}${taken ? " is-claimed" : ""}${q.stage_final ? " is-stage-final" : ""}`}
                  aria-label={q.title}
                >
                  <header className="quest-card-heading">
                    <h4>
                      <ItemText>{q.title}</ItemText>
                    </h4>
                    <div className="quest-tags" aria-label="任务标签">
                      <span className="quest-tag quest-stage-tag">
                        P{q.tier}
                      </span>
                      <span
                        className={`quest-tag quest-status-tag${taken ? " is-claimed" : done ? " is-ready" : ""}`}
                      >
                        {taken ? "已领奖" : done ? "已达成 · 待领奖" : "进行中"}
                      </span>
                      {q.stage_final && (
                        <span className="quest-tag quest-final-label">
                          阶段终局任务
                        </span>
                      )}
                    </div>
                  </header>
                  <p className="quest-description">
                    <ItemText>{q.description}</ItemText>
                  </p>
                  {q.stage_final && (
                    <p className="quest-final-unlock">
                      完成本任务并领取奖励后解锁 P{q.tier + 1} 阶段。
                    </p>
                  )}
                  {q.goal.type === "factory_delivery" ? (
                    <ul
                      className="quest-delivery-progress"
                      aria-label="自动化入库进度"
                    >
                      {q.goal.items?.map((id) => {
                        const item = catalog.items.find((i) => i.id === id);
                        return (
                          <li key={id}>
                            {item && (
                              <DefinitionIcon definition={item} compact />
                            )}
                            <div>
                              <ItemName item={id} />
                              <span>
                                {done
                                  ? q.goal.count
                                  : Math.min(
                                      q.goal.count,
                                      questItemAmount(p, id),
                                    )}{" "}
                                / {q.goal.count}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="quest-progress">
                      进度：
                      {done
                        ? q.goal.count
                        : Math.min(q.goal.count, questAmount(p, q))}{" "}
                      / {q.goal.count}
                    </p>
                  )}
                  {(Object.keys(q.rewards).length > 0 ||
                    !!q.unlocks?.length) && (
                    <section
                      className="quest-reward-section"
                      aria-label="任务奖励"
                    >
                      <h5>任务奖励</h5>
                      {Object.keys(q.rewards).length > 0 && (
                        <ul className="quest-rewards">
                          {Object.entries(q.rewards).map(([id, n]) => {
                            const item = catalog.items.find((i) => i.id === id);
                            return (
                              <li
                                key={id}
                                className="workshop-material-card quest-reward-card"
                              >
                                {item && (
                                  <DefinitionIcon definition={item} compact />
                                )}
                                <div>
                                  <strong>
                                    <ItemName item={id} />
                                  </strong>
                                  <span>× {n.toLocaleString()}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {!!q.unlocks?.length && (
                        <p className="quest-mechanism-reward">
                          {q.unlocks.includes("warehouse_orders") &&
                            "仓库中解锁下单功能"}
                        </p>
                      )}
                    </section>
                  )}
                  {!taken && (
                    <button
                      className="quest-claim"
                      disabled={!done || disabled || !act}
                      onClick={() => act?.({ type: "claim_quest", id: q.id })}
                    >
                      领取奖励
                    </button>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      </section>
    </ItemInfoProvider>
  );
}
