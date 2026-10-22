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
  while (
    stage < 6 &&
    p.milestones.includes(catalog.stages![stage - 1].milestone_item)
  ) {
    if (stage === 1 && !orderRewardClaimed(p) && !(legacy && p.stage >= 2))
      break;
    stage++;
  }
  return stage;
}
