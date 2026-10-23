// Existential quest reachability, never a reward grant or runtime completion.
// Counts and physical routes remain the player's responsibility to validate.
export function advanceQuestStages(c, stage, items, recipes, canDeliver) {
  const completed = new Set();
  const goal = (q) => {
    if (["obtain_item", "craft_item"].includes(q.goal.type))
      return items.has(q.goal.target);
    if (q.goal.type === "workshop_recipe") return recipes.has(q.goal.target);
    return q.goal.type === "automated_delivery" && canDeliver;
  };
  for (const q of c.quests ?? [])
    if (!q.stage_final && q.tier <= stage && goal(q)) completed.add(q.id);
  while (stage < 6) {
    const final = c.quests?.find((q) => q.stage_final && q.tier === stage);
    if (!final) break;
    const others = c.quests.filter((q) => !q.stage_final && q.tier === stage);
    if (
      others.filter((q) => completed.has(q.id)).length <
        Math.ceil(others.length / 2) ||
      !goal(final)
    )
      break;
    completed.add(final.id);
    stage++;
  }
  return stage;
}
