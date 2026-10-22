import { useState } from "react";
import type { Catalog, FactoryDetail } from "../api/client";
import type { WorldAction } from "./local/world";
import { questAmount } from "./local/quests";
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
  const quests = (catalog.quests ?? []).filter(
    (q) => q.tier <= (p?.stage ?? 1),
  );
  const claimed = new Set(progress?.claimed ?? []);
  const completed = new Set(progress?.completed ?? []);
  const list = quests.filter(
    (q) => claimed.has(q.id) === (tab === "completed"),
  );
  return (
    <ItemInfoProvider catalog={catalog} industry={p}>
      <section className="quest-panel" aria-label="阶段任务">
        <p>
          任务无需接受，可按任意顺序完成；列表按推荐顺序排列。奖励统一送到起始厂区仓库。
        </p>
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
                  className={`quest-card${done && !taken ? " is-ready" : ""}`}
                  aria-label={q.title}
                >
                  <header>
                    <h4>
                      <ItemText>{q.title}</ItemText>
                    </h4>
                    <span>
                      P{q.tier} ·{" "}
                      {taken ? "已领奖" : done ? "已达成 · 待领奖" : "进行中"}
                    </span>
                  </header>
                  <p>
                    <ItemText>{q.description}</ItemText>
                  </p>
                  <p>
                    进度：
                    {done
                      ? q.goal.count
                      : Math.min(q.goal.count, questAmount(p, q))}{" "}
                    / {q.goal.count}
                  </p>
                  <h5>任务奖励</h5>
                  <ul className="quest-rewards">
                    {Object.entries(q.rewards).map(([id, n]) => {
                      const item = catalog.items.find((i) => i.id === id);
                      return (
                        <li key={id}>
                          {item && <DefinitionIcon definition={item} compact />}
                          <span>
                            <ItemName item={id} /> × {n}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {!!q.unlocks?.length && (
                    <p className="quest-mechanism-reward">
                      {q.unlocks.includes("warehouse_orders") &&
                        "仓库中解锁下单功能"}
                      {q.unlocks.includes("stage_2") && "，并解放下一阶段"}
                    </p>
                  )}
                  {!taken && (
                    <button
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
