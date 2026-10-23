import type { components } from "../../api/schema";
import { catalog } from "./catalog";

type Industry = components["schemas"]["IndustryState"];
export const orderQuestID = "p1_free_hands";
export const orderRewardClaimed = (p: Industry | undefined) =>
  !!p?.quests?.claimed.includes(orderQuestID);
export const ordersUnlocked = (p: Industry | undefined) =>
  p?.developer?.warehouse_orders_always_available === true ||
  orderRewardClaimed(p);

export function expectedStage(p: Industry, legacy = false) {
  let stage = 1;
  if (!legacy) {
    while (stage < 6) {
      const final = catalog.quests?.find(
        (q) => q.stage_final && q.tier === stage,
      );
      if (!final || !p.quests?.claimed.includes(final.id)) break;
      stage++;
    }
    return stage;
  }
  // Used only while validating an old snapshot before its one-time upgrade.
  while (
    stage < 6 &&
    p.milestones.includes(catalog.stages![stage - 1].milestone_item)
  ) {
    if (
      stage === 1 &&
      !orderRewardClaimed(p) &&
      !(p.quests?.automated_received === undefined && p.stage >= 2)
    )
      break;
    stage++;
  }
  return stage;
}
