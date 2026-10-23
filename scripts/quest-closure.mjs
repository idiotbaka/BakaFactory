// Existential quest reachability, never a reward grant or runtime completion.
// Counts and physical routes remain the player's responsibility to validate.
export function advanceQuestStages(
  c,
  stage,
  items,
  recipes,
  canDeliver,
  events = {},
) {
  const completed = new Set();
  const goal = (q) => {
    if (["obtain_item", "craft_item"].includes(q.goal.type))
      return items.has(q.goal.target);
    if (q.goal.type === "workshop_recipe") return recipes.has(q.goal.target);
    if (q.goal.type === "factory_delivery")
      return (
        canDeliver &&
        q.goal.items.every((id) =>
          c.recipes.some(
            (r) =>
              r.outputs[id] &&
              recipes.has(r.id) &&
              c.buildings.some(
                (b) =>
                  b.id === r.building_type && (!b.item || items.has(b.item)),
              ),
          ),
        )
      );
    if (q.goal.type === "factory_event") return events[q.goal.target] === true;
    if (q.goal.type === "district_count")
      return (
        q.goal.count <= [6, 12, 24, 40, 70, 100][stage - 1] &&
        ["基础铁板", "简易支架"].every((name) =>
          items.has(c.items.find((i) => i.name === name)?.id),
        )
      );
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
