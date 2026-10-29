import { describe, it, expect } from "vitest";
import {
  newlyClaimedStories,
  retainPendingStories,
  unlockedStoryIDs,
  openingStoryID,
  p1StoryID,
  p2HatchStoryID,
  p2ShaftStoryID,
  p2ClockworkStoryID,
} from "./progress";
import { storyDefinitions } from "./definitions";

describe("chapter claim triggers and authored P1 story", () => {
  it("queues the clockwork colleague only on its first reward and leaves historical claims replayable", () => {
    const quest = "p2_clockwork_colleague";
    expect(unlockedStoryIDs()).not.toContain(p2ClockworkStoryID);
    expect(unlockedStoryIDs(["p2_shaft_work"])).not.toContain(
      p2ClockworkStoryID,
    );
    expect(newlyClaimedStories([], [quest])).toEqual([p2ClockworkStoryID]);
    expect(newlyClaimedStories([quest], [quest])).toEqual([]);
    expect(newlyClaimedStories([], [quest], [p2ClockworkStoryID])).toEqual([]);
    expect(unlockedStoryIDs([quest])).toContain(p2ClockworkStoryID);
    expect(retainPendingStories([p2ClockworkStoryID], [], [quest])).toEqual([
      p2ClockworkStoryID,
    ]);
    expect(
      retainPendingStories([p2ClockworkStoryID], [p2ClockworkStoryID], [quest]),
    ).toEqual([]);
    expect(retainPendingStories([p2ClockworkStoryID], [], [])).toEqual([]);
    expect(newlyClaimedStories([], [quest, "p2_shaft_work"])).toEqual([
      p2ShaftStoryID,
      p2ClockworkStoryID,
    ]);
    const story = storyDefinitions[p2ClockworkStoryID];
    expect(story.title).toBe("P2 中期：第一位会走路的帕鲁同事");
    expect(story.pages).toHaveLength(5);
    expect(
      story.pages.every((p) => p.paragraphs.length === 5 && p.alt && p.image),
    ).toBe(true);
    expect(new Set(story.pages.map((p) => p.image)).size).toBe(5);
    expect(story.pages.map((p) => p.title)).toEqual([
      "隆重欢迎新同事……等等，它的头呢？",
      "叫醒服务：按住车屁股拧三十圈",
      "堵车不路怒，天选运煤工",
      "不掉 SAN 值的梦中情「帕鲁」",
      "离岗交接？先等同事长出脑子再说",
    ]);
    expect(story.pages[4].paragraphs[4]).toBe(
      "但至少今天，运煤的活有人包了。你轻轻摸了摸它的车斗：「辛苦啦，小同事。」",
    );
  });
  it("unlocks the shaft chapter on its reward, without replaying historical or viewed claims", () => {
    const claims = ["p2_shaft_work"];
    expect(unlockedStoryIDs()).not.toContain(p2ShaftStoryID);
    expect(newlyClaimedStories([], [])).toEqual([]);
    expect(newlyClaimedStories([], claims)).toEqual([p2ShaftStoryID]);
    expect(newlyClaimedStories(claims, claims)).toEqual([]);
    expect(newlyClaimedStories([], claims, [p2ShaftStoryID])).toEqual([]);
    expect(unlockedStoryIDs(claims)).toContain(p2ShaftStoryID);
    expect(retainPendingStories([p2ShaftStoryID], [], claims)).toEqual([
      p2ShaftStoryID,
    ]);
    expect(
      retainPendingStories([p2ShaftStoryID], [p2ShaftStoryID], claims),
    ).toEqual([]);
    expect(retainPendingStories([p2ShaftStoryID], [], [])).toEqual([]);
    const story = storyDefinitions[p2ShaftStoryID];
    expect(story.title).toBe("P2 前期：机械动力，应力过载");
    expect(story.pages).toHaveLength(5);
    expect(
      story.pages.every((p) => p.paragraphs.length === 5 && p.alt && p.image),
    ).toBe(true);
    expect(new Set(story.pages.map((p) => p.image)).size).toBe(5);
    expect(story.pages.map((p) => p.title)).toEqual([
      "袖子挽起来，机器还是不动",
      "一台炉子带全村",
      "传说中的应力过载……就这？",
      "偷看了一眼未来的动力图鉴",
      "力大砖飞，先转起来再说",
    ]);
    expect(story.pages[4].paragraphs[4]).toBe(
      "你按住被震乱的蓝色刘海，慢吞吞竖起拇指：「能让机器自己干活，就是好能源……唔，离下班又近了一点。」",
    );
  });
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
      "系统批注：「此处接收工业成品。厂长尚未完成加工。」……唔，连下班都要排工序呀。",
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
