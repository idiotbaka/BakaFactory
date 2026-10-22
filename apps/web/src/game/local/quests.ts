import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { catalog, recipeDefinitions } from "./catalog";
import { discoverItems } from "./discovery";
import { store } from "./inventory";
import { expectedStage, orderQuestID } from "./progression";

export type Quest = components["schemas"]["QuestDefinition"];
export type QuestProgress = components["schemas"]["QuestProgress"];
export const newQuestProgress = (): QuestProgress => ({
  completed: [],
  claimed: [],
  workshop_batches: {},
  automated_received: 0,
});
export function questAmount(
  p: components["schemas"]["IndustryState"] | undefined,
  q: Quest,
) {
  if (q.goal.type === "automated_delivery")
    return p?.quests?.automated_received ?? 0;
  if (q.goal.type === "craft_item")
    return Math.min(q.goal.count, p?.crafted[q.goal.target] ?? 0);
  return q.goal.type === "obtain_item"
    ? p?.discovered_items?.includes(q.goal.target) ||
      (p?.crafted[q.goal.target] ?? 0) > 0
      ? 1
      : 0
    : (p?.quests?.workshop_batches[q.goal.target] ?? 0);
}
export function recordWarehouseDelivery(f: LocalFactory, count: number) {
  if (count <= 0 || !f.simulation.industry) return;
  const p = (f.simulation.industry.quests ??= newQuestProgress());
  p.automated_received = Math.min(
    Number.MAX_SAFE_INTEGER,
    (p.automated_received ?? 0) + count,
  );
}

export function restoreQuestProgress(f: LocalFactory) {
  const p = f.simulation.industry!;
  const legacy = p.quests?.automated_received === undefined;
  const quests = (p.quests ??= newQuestProgress());
  quests.automated_received ??= 0;
  // Preserve the already unlocked industrial stages of pre-feature saves.
  if (legacy && p.stage >= 2) {
    if (!quests.completed.includes(orderQuestID))
      quests.completed.push(orderQuestID);
    if (!quests.claimed.includes(orderQuestID))
      quests.claimed.push(orderQuestID);
  }
}
// Called only on the next atomic state, after actual production / acquisition.
export function syncQuests(f: LocalFactory) {
  const p = f.simulation.industry;
  if (!p) return;
  const progress = (p.quests ??= newQuestProgress());
  for (const q of catalog.quests ?? [])
    if (
      q.tier <= p.stage &&
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
  // The caller owns a cloned world; failure commits neither items nor claim.
  store(root.simulation.warehouse, q.rewards);
  p.claimed.push(id);
  root.simulation.industry!.stage = expectedStage(root.simulation.industry!);
  discoverItems(root, Object.keys(q.rewards));
  syncQuests(root);
}
export function validQuestProgress(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some(
      (k) =>
        ![
          "completed",
          "claimed",
          "workshop_batches",
          "automated_received",
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
