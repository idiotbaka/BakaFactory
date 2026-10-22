import { describe, it, expect } from "vitest";
import { newlyClaimedStories, retainPendingStories, unlockedStoryIDs, openingStoryID, p1StoryID } from "./progress";
import { storyDefinitions } from "./definitions";

describe("chapter claim triggers and authored P1 story", () => {
  it("unlocks only on the exact reward claim and queues no repeat or viewed events", () => {
    expect(unlockedStoryIDs()).toEqual([openingStoryID]);
    expect(unlockedStoryIDs(["p1_free_hands"])).toEqual([openingStoryID, p1StoryID]);
    expect(newlyClaimedStories([], ["p1_free_hands"])).toEqual([p1StoryID]);
    expect(newlyClaimedStories([], ["p1_feeder"])).toEqual([]);
    expect(newlyClaimedStories(["p1_free_hands"], ["p1_free_hands"])).toEqual([]);
    expect(newlyClaimedStories([], ["p1_free_hands"], [p1StoryID])).toEqual([]);
  });
  it("prunes completed and no-longer-unlocked pending entries while retaining future metadata", () => {
    expect(retainPendingStories([p1StoryID, "future_chapter"], [], [])).toEqual(["future_chapter"]);
    expect(retainPendingStories([p1StoryID], [], ["p1_free_hands"])).toEqual([p1StoryID]);
    expect(retainPendingStories([p1StoryID], [p1StoryID], ["p1_free_hands"])).toEqual([]);
  });
  it("uses the approved five cards and five narrative lines each, with separate illustrations", () => {
    const story = storyDefinitions[p1StoryID];
    expect(story.title).toBe("P1：工厂开饭了");
    expect(story.pages).toHaveLength(5);
    expect(story.pages.every((page) => page.paragraphs.length === 5 && page.paragraphs.every((line) => !!line && !line.includes("\n")) && !!page.alt && !!page.image)).toBe(true);
    expect(new Set(story.pages.map((page) => page.image)).size).toBe(5);
  });
});
