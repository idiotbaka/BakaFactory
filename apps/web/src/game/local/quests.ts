import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { catalog, itemDefinitions, itemID, recipeDefinitions } from "./catalog";
import { discoverItems } from "./discovery";
import { store } from "./inventory";
import { expectedStage, orderQuestID } from "./progression";
import { questVisible } from "./questRules";

export type Quest = components["schemas"]["QuestDefinition"];
export type QuestProgress = components["schemas"]["QuestProgress"];
export const questEventLimits = {
  shaft_craft: Number.MAX_SAFE_INTEGER,
  steam_tank_fill: Number.MAX_SAFE_INTEGER,
  clockwork_transport: Number.MAX_SAFE_INTEGER,
  district_count: 100,
} as const;
type QuestEvent = keyof typeof questEventLimits;
export const newQuestProgress = (): QuestProgress => ({
  stage_quests_version: 1,
  completed: [],
  claimed: [],
  workshop_batches: {},
  automated_received: 0,
});
export const questItemAmount = (
  p: components["schemas"]["IndustryState"] | undefined,
  item: string,
) =>
  Math.min(
    p?.quests?.factory_produced?.[item] ?? 0,
    p?.quests?.warehouse_received?.[item] ?? 0,
  );
export function questAmount(
  p: components["schemas"]["IndustryState"] | undefined,
  q: Quest,
) {
  if (q.goal.type === "submit_items") return 0;
  if (q.goal.type === "automated_delivery")
    return p?.quests?.automated_received ?? 0;
  if (q.goal.type === "factory_delivery")
    return q.goal.items?.length
      ? Math.min(
          ...q.goal.items.map((id) => questItemAmount(p, id)),
          q.goal.count,
        )
      : 0;
  if (q.goal.type === "factory_event" || q.goal.type === "district_count")
    return (
      p?.quests?.factory_events?.[
        q.goal.type === "district_count"
          ? "district_count"
          : (q.goal.target as QuestEvent)
      ] ?? 0
    );
  if (q.goal.type === "craft_item")
    return Math.min(q.goal.count, p?.crafted[q.goal.target] ?? 0);
  return q.goal.type === "obtain_item"
    ? p?.discovered_items?.includes(q.goal.target) ||
      (p?.crafted[q.goal.target] ?? 0) > 0
      ? 1
      : 0
    : (p?.quests?.workshop_batches[q.goal.target] ?? 0);
}
const increment = (
  counts: Record<string, number>,
  id: string,
  count: number,
) => {
  counts[id] = Math.min(Number.MAX_SAFE_INTEGER, (counts[id] ?? 0) + count);
};
export function recordFactoryOutput(
  f: LocalFactory,
  outputs: Record<string, number>,
) {
  if (!f.simulation.industry) return;
  const p = (f.simulation.industry.quests ??= newQuestProgress());
  const counts = (p.factory_produced ??= {});
  for (const [item, count] of Object.entries(outputs))
    increment(counts, item, count);
}
export function recordQuestEvent(
  f: LocalFactory,
  event: Exclude<QuestEvent, "district_count">,
) {
  if (!f.simulation.industry) return;
  const p = (f.simulation.industry.quests ??= newQuestProgress());
  increment((p.factory_events ??= {}), event, 1);
}
export function recordFluidReceipt(
  f: LocalFactory,
  buildingType: string,
  item: string,
  count: number,
) {
  if (count > 0 && buildingType === "steam_tank" && item === itemID("高压蒸汽"))
    recordQuestEvent(f, "steam_tank_fill");
}
export function recordWarehouseDelivery(
  f: LocalFactory,
  item: string,
  count: number,
) {
  if (count <= 0 || !f.simulation.industry) return;
  const p = (f.simulation.industry.quests ??= newQuestProgress());
  p.automated_received = Math.min(
    Number.MAX_SAFE_INTEGER,
    (p.automated_received ?? 0) + count,
  );
  increment((p.warehouse_received ??= {}), item, count);
}

export function restoreQuestProgress(f: LocalFactory) {
  const p = f.simulation.industry!;
  const legacy = p.quests?.automated_received === undefined;
  const legacyStages = p.quests?.stage_quests_version === undefined;
  const quests = (p.quests ??= newQuestProgress());
  quests.automated_received ??= 0;
  // Preserve the already unlocked industrial stages of pre-feature saves.
  if (legacy && p.stage >= 2) {
    if (!quests.completed.includes(orderQuestID))
      quests.completed.push(orderQuestID);
    if (!quests.claimed.includes(orderQuestID))
      quests.claimed.push(orderQuestID);
  }
  if (legacyStages) {
    // Preserve old unlocked stages, without paying rewards or fabricating
    // ordinary quest history. Future stages must follow the new quest gates.
    for (const q of catalog.quests ?? []) {
      if (!q.stage_final || q.tier >= p.stage) continue;
      if (!quests.completed.includes(q.id)) quests.completed.push(q.id);
      if (!quests.claimed.includes(q.id)) quests.claimed.push(q.id);
    }
    quests.stage_quests_version = 1;
  }
}
// Called only on the next atomic state, after actual production / acquisition.
export function syncQuests(f: LocalFactory) {
  const p = f.simulation.industry;
  if (!p) return;
  const progress = (p.quests ??= newQuestProgress());
  // World size is observable without inventing missing historic work events.
  const events = (progress.factory_events ??= {});
  events.district_count = Math.max(
    events.district_count ?? 0,
    1 + (f.districts?.length ?? 0),
  );
  // Resolve ordinary tasks first, independent of recommendation order.
  const definitions = catalog.quests ?? [];
  for (const q of [
    ...definitions.filter((q) => !q.stage_final),
    ...definitions.filter((q) => q.stage_final),
  ])
    if (
      questVisible(p, q) &&
      q.goal.type !== "submit_items" &&
      !progress.completed.includes(q.id) &&
      questAmount(p, q) >= q.goal.count
    )
      progress.completed.push(q.id);
}
export function recordWorkshopBatch(f: LocalFactory, recipe: string) {
  const p = f.simulation.industry;
  if (!p) return;
  const counts = (p.quests ??= newQuestProgress()).workshop_batches;
  counts[recipe] = Math.min(Number.MAX_SAFE_INTEGER, (counts[recipe] ?? 0) + 1);
}
export function claimQuest(root: LocalFactory, id: string) {
  syncQuests(root);
  const q = catalog.quests?.find((q) => q.id === id),
    p = root.simulation.industry?.quests;
  if (!q || !p?.completed.includes(id))
    throw new Error("任务尚未达成，不能领取奖励");
  if (p.claimed.includes(id)) throw new Error("该任务奖励已经领取");
  if (!questVisible(root.simulation.industry, q))
    throw new Error("阶段终局任务尚未开放，请先完成本阶段至少一半的其他任务");
  // The caller owns a cloned world; failure commits neither items nor claim.
  store(root.simulation.warehouse, q.rewards);
  p.claimed.push(id);
  root.simulation.industry!.stage = expectedStage(root.simulation.industry!);
  discoverItems(root, Object.keys(q.rewards));
  syncQuests(root);
}
export function submitQuest(root: LocalFactory, id: string) {
  const q = catalog.quests?.find((q) => q.id === id);
  const p = root.simulation.industry;
  if (!q || q.goal.type !== "submit_items" || !questVisible(p, q))
    throw new Error("材料提交任务尚未开放");
  const progress = (p!.quests ??= newQuestProgress());
  if (progress.completed.includes(id))
    throw new Error("该任务已提交材料，请领取奖励");
  store(
    root.simulation.warehouse,
    Object.fromEntries(q.goal.items!.map((item) => [item, -q.goal.count])),
  );
  progress.completed.push(id);
  syncQuests(root);
}
export function validQuestProgress(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (p.stage_quests_version !== undefined && p.stage_quests_version !== 1)
    return false;
  if (
    Object.keys(p).some(
      (k) =>
        ![
          "completed",
          "claimed",
          "workshop_batches",
          "automated_received",
          "stage_quests_version",
          "factory_produced",
          "warehouse_received",
          "factory_events",
        ].includes(k),
    )
  )
    return false;
  const known = new Set(catalog.quests?.map((q) => q.id));
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= known.size &&
    new Set(v).size === v.length &&
    v.every((id) => known.has(id));
  if (!ids(p.completed) || !ids(p.claimed)) return false;
  const completed = p.completed;
  if (p.claimed.some((id) => !completed.includes(id))) return false;
  if (
    p.automated_received !== undefined &&
    (typeof p.automated_received !== "number" ||
      !Number.isSafeInteger(p.automated_received) ||
      p.automated_received < 0)
  )
    return false;
  const validCounts = (value: unknown, limits: ReadonlyMap<string, number>) =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).length <= limits.size &&
    Object.entries(value).every(
      ([id, n]) =>
        limits.has(id) &&
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        n >= 0 &&
        n <= limits.get(id)!,
    );
  const itemLimits = new Map(
    [...itemDefinitions.keys()].map((id) => [id, Number.MAX_SAFE_INTEGER]),
  );
  for (const key of ["factory_produced", "warehouse_received"])
    if (p[key] !== undefined && !validCounts(p[key], itemLimits)) return false;
  if (
    p.factory_events !== undefined &&
    !validCounts(p.factory_events, new Map(Object.entries(questEventLimits)))
  )
    return false;
  const counts = p.workshop_batches;
  return (
    !!counts &&
    typeof counts === "object" &&
    !Array.isArray(counts) &&
    Object.entries(counts).length <= recipeDefinitions.size &&
    Object.entries(counts).every(
      ([id, n]) =>
        recipeDefinitions.has(id) &&
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        n >= 0,
    )
  );
}
