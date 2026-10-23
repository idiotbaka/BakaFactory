import type { components } from "../../api/schema";
import { catalog } from "./catalog";

type Industry = components["schemas"]["IndustryState"];
type Quest = components["schemas"]["QuestDefinition"];

export function finalQuestRequirement(
  p: Industry | undefined,
  q: Quest,
  definitions: readonly Quest[] = catalog.quests ?? [],
) {
  const others = definitions.filter(
    (other) => other.tier === q.tier && !other.stage_final,
  );
  const completed = new Set(p?.quests?.completed ?? []);
  return {
    total: others.length,
    required: Math.ceil(others.length / 2),
    completed: others.filter((other) => completed.has(other.id)).length,
  };
}

export function questVisible(
  p: Industry | undefined,
  q: Quest,
  definitions: readonly Quest[] = catalog.quests ?? [],
) {
  if (q.tier > (p?.stage ?? 1)) return false;
  // Historical claims remain visible even if more ordinary quests are added.
  if (!q.stage_final || p?.quests?.claimed.includes(q.id)) return true;
  const requirement = finalQuestRequirement(p, q, definitions);
  return requirement.completed >= requirement.required;
}
