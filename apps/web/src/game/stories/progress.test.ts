import { describe, it, expect } from "vitest";
import {
  newlyClaimedStories,
  retainPendingStories,
  unlockedStoryIDs,
  openingStoryID,
  p1StoryID,
  p2HatchStoryID,
} from "./progress";
import { storyDefinitions } from "./definitions";

describe("chapter claim triggers and authored P1 story", () => {
  it("queues the hatch chapter only on a fresh reward and retains its five approved pages", () => {
    expect(newlyClaimedStories([], ["p2_crowded_hatch"])).toEqual([
      p2HatchStoryID,
    ]);
    expect(
      newlyClaimedStories(["p2_crowded_hatch"], ["p2_crowded_hatch"]),
    ).toEqual([]);
    expect(
      newlyClaimedStories([], ["p2_crowded_hatch"], [p2HatchStoryID]),
    ).toEqual([]);
    expect(retainPendingStories([p2HatchStoryID], [], [])).toEqual([]);
    expect(unlockedStoryIDs(["p2_crowded_hatch"])).toContain(p2HatchStoryID);
    const story = storyDefinitions[p2HatchStoryID];
    expect(story.title).toBe("P2 前期：舱门过于拥挤");
    expect(story.pages).toHaveLength(5);
    expect(
      story.pages.every((p) => p.paragraphs.length === 5 && p.alt && p.image),
    ).toBe(true);
    expect(story.pages[4].paragraphs[4]).toBe(
      "系统批注：「此处接收工业成品。厂长尚未完成加工。」",
    );
  });
  it("unlocks only on the exact reward claim and queues no repeat or viewed events", () => {
    expect(unlockedStoryIDs()).toEqual([openingStoryID]);
    expect(unlockedStoryIDs(["p1_free_hands"])).toEqual([
      openingStoryID,
      p1StoryID,
    ]);
    expect(newlyClaimedStories([], ["p1_free_hands"])).toEqual([p1StoryID]);
    expect(newlyClaimedStories([], ["p1_feeder"])).toEqual([]);
    expect(newlyClaimedStories(["p1_free_hands"], ["p1_free_hands"])).toEqual(
      [],
    );
    expect(newlyClaimedStories([], ["p1_free_hands"], [p1StoryID])).toEqual([]);
  });
  it("prunes completed and no-longer-unlocked pending entries while retaining future metadata", () => {
    expect(retainPendingStories([p1StoryID, "future_chapter"], [], [])).toEqual(
      ["future_chapter"],
    );
    expect(retainPendingStories([p1StoryID], [], ["p1_free_hands"])).toEqual([
      p1StoryID,
    ]);
    expect(
      retainPendingStories([p1StoryID], [p1StoryID], ["p1_free_hands"]),
    ).toEqual([]);
  });
  it("uses the approved five cards and five narrative lines each, with separate illustrations", () => {
    const story = storyDefinitions[p1StoryID];
    expect(story.title).toBe("P1：工厂开饭了");
    expect(story.pages).toHaveLength(5);
    expect(
      story.pages.every(
        (page) =>
          page.paragraphs.length === 5 &&
          page.paragraphs.every((line) => !!line && !line.includes("\n")) &&
          !!page.alt &&
          !!page.image,
      ),
    ).toBe(true);
    expect(new Set(story.pages.map((page) => page.image)).size).toBe(5);
  });
});
