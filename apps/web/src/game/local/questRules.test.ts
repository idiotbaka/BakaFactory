import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { initialIndustry, recordCraft } from "./industry";
import { finalQuestRequirement, questVisible } from "./questRules";
import { syncQuests, type Quest } from "./quests";
import { createWorld, actWorld } from "./world";
import { toSave, validateSave } from "./state";
import { recipeAvailable } from "./production";
import { industryOutcome } from "./diagnostics";

const user = {
  id: "final-quests",
  username: "final-quests",
  display_name: "终局任务",
  created_at: "now",
  last_login_at: "now",
};
const final = catalog.quests!.find((q) => q.id === "p1_free_hands")!;
const ordinary = catalog.quests!.filter((q) => q.tier === 1 && !q.stage_final);

describe("stage final quest gates", () => {
  it("requires four of eight ordinary completions, including unclaimed ones, and excludes other tiers and the final itself", () => {
    const p = initialIndustry();
    p.quests!.completed = ordinary.slice(0, 3).map((q) => q.id);
    expect(finalQuestRequirement(p, final)).toEqual({
      total: 8,
      required: 4,
      completed: 3,
    });
    expect(questVisible(p, final)).toBe(false);
    p.quests!.completed.push(final.id, "p2_industrial_license");
    expect(questVisible(p, final)).toBe(false);
    p.quests!.completed.push(ordinary[3].id);
    expect(p.quests!.claimed).toEqual([]);
    expect(questVisible(p, final)).toBe(true);
  });

  it("rounds nine ordinary tasks up to five and handles zero ordinary tasks", () => {
    const definitions: Quest[] = [
      ...catalog.quests!,
      { ...ordinary[0], id: "p1_extra" },
    ];
    const p = initialIndustry();
    p.quests!.completed = ordinary.slice(0, 4).map((q) => q.id);
    expect(finalQuestRequirement(p, final, definitions).required).toBe(5);
    expect(questVisible(p, final, definitions)).toBe(false);
    p.quests!.completed.push("p1_extra");
    expect(questVisible(p, final, definitions)).toBe(true);
    expect(questVisible(p, final, [final])).toBe(true);
    expect(questVisible(p, { ...final, tier: 2 }, [final])).toBe(false);
  });

  it("records an early crafted milestone without completing, notifying or claiming a hidden final", () => {
    let root = createWorld(user, "提前手搓");
    recordCraft(root, { i0060: 1 });
    syncQuests(root);
    expect(root.simulation.industry!.milestones).toContain("i0060");
    expect(root.simulation.industry!.quests!.completed).not.toContain(final.id);
    const before = structuredClone(root);
    expect(() =>
      actWorld(root, { type: "claim_quest", id: final.id }),
    ).toThrow();
    expect(root).toEqual(before);
    // Even a stale early completion cannot bypass the actual visibility gate.
    root.simulation.industry!.quests!.completed.push(final.id);
    expect(() => actWorld(root, { type: "claim_quest", id: final.id })).toThrow(
      "至少一半",
    );
    root.simulation.industry!.quests!.completed = ordinary
      .slice(0, 4)
      .map((q) => q.id);
    syncQuests(root);
    expect(root.simulation.industry!.quests!.completed).toContain(final.id);
    expect(root.simulation.industry!.stage).toBe(1);
    root = actWorld(root, { type: "claim_quest", id: final.id });
    expect(root.simulation.industry!.stage).toBe(2);
    expect(root.simulation.industry!.crafted.i0060).toBe(1);
  });

  it("requires a final claim at every P1–P5 transition and preserves manufacture achievements independently", () => {
    let root = createWorld(user, "六阶段门槛");
    root.simulation.industry!.quests!.completed = ordinary
      .slice(0, 4)
      .map((q) => q.id);
    const nextRecipes = ["r2001", "r3001", "r4001", "r5001", "r6001"];
    for (let tier = 1; tier <= 5; tier++) {
      const q = catalog.quests!.find((q) => q.stage_final && q.tier === tier)!;
      root.simulation.industry!.quests!.completed.push(
        ...catalog
          .quests!.filter(
            (q) =>
              q.tier === tier &&
              !q.stage_final &&
              !root.simulation.industry!.quests!.completed.includes(q.id),
          )
          .map((q) => q.id),
      );
      recordCraft(root, { [catalog.stages![tier - 1].milestone_item]: 1 });
      syncQuests(root);
      expect(root.simulation.industry!.stage).toBe(tier);
      expect(root.simulation.industry!.quests!.completed).toContain(q.id);
      expect(recipeAvailable(root, nextRecipes[tier - 1])).toBe(false);
      expect(industryOutcome(root).stages[tier - 1].complete).toBe(false);
      expect(industryOutcome(root).stages[tier - 1].manufactured).toBe(true);
      root = actWorld(root, { type: "claim_quest", id: q.id });
      expect(root.simulation.industry!.stage).toBe(tier + 1);
      expect(recipeAvailable(root, nextRecipes[tier - 1])).toBe(true);
      expect(industryOutcome(root).stages[tier - 1].complete).toBe(true);
      root = validateSave(toSave(root), user.id);
    }
  });

  it("upgrades an old P3 only once, keeps its rewards and ordinary history unchanged and gates the next milestone", () => {
    const root = createWorld(user, "旧阶段");
    const p = root.simulation.industry!;
    p.stage = 3;
    p.milestones = catalog.stages!.slice(0, 2).map((s) => s.milestone_item);
    p.quests!.completed = [final.id];
    p.quests!.claimed = [final.id];
    delete p.quests!.stage_quests_version;
    const before = structuredClone(root);
    const restored = validateSave(toSave(root), user.id);
    expect(root).toEqual(before);
    expect(restored.simulation.industry!.stage).toBe(3);
    expect(restored.simulation.industry!.quests!.claimed).toEqual([
      final.id,
      "p2_industrial_license",
    ]);
    expect(restored.simulation.industry!.quests!.stage_quests_version).toBe(1);
    expect(restored.simulation.warehouse).toEqual(root.simulation.warehouse);
    expect(questVisible(restored.simulation.industry, final)).toBe(true);
    expect(validateSave(toSave(restored), user.id)).toEqual(restored);
    recordCraft(restored, { [catalog.stages![2].milestone_item]: 1 });
    expect(restored.simulation.industry!.stage).toBe(3);
  });

  it("rejects forged new stages and invalid rule versions without downgrading or clearing saves", () => {
    const root = createWorld(user, "新阶段");
    const p = root.simulation.industry!;
    p.milestones = ["i0060"];
    p.crafted.i0060 = 1;
    p.stage = 2;
    expect(() => validateSave(toSave(root), user.id)).toThrow();
    p.stage = 1;
    for (const stage_quests_version of [null, 0, 2, "1"]) {
      const bad = structuredClone(toSave(root));
      Object.assign(bad.factory.simulation!.industry!.quests!, {
        stage_quests_version,
      });
      expect(() => validateSave(bad, user.id)).toThrow();
    }
  });
});
