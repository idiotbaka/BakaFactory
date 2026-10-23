import { describe, it, expect } from "vitest";
import { createWorld } from "./world";
import { catalog, recipeDefinitions, itemID } from "./catalog";
import { newMachine } from "./state";
import { diagnoseFactory, industryOutcome } from "./diagnostics";
import { recordCraft } from "./industry";
import { Observations } from "./observations";
const user = {
  id: "diagnosis",
  username: "diagnosis",
  display_name: "诊断",
  created_at: "now",
  last_login_at: "now",
};
describe("read-only diagnostics and durable game outcomes", () => {
  it("uses confirmed supplied work power without falsely flagging a fully powered machine after credit consumption", () => {
    const f = createWorld(user, "供能诊断");
    f.simulation.industry!.stage = 6;
    f.simulation.industry!.quests!.completed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    f.simulation.industry!.quests!.claimed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    f.simulation.industry!.milestones = catalog
      .stages!.slice(0, 5)
      .map((s) => s.milestone_item);
    const r = catalog.recipes.find(
      (r) => r.building_type === "m27" && (r.power_kw ?? 0) > 0,
    )!;
    f.buildings.push({
      id: "powered",
      factory_id: f.id,
      building_type: "m27",
      x: 3,
      y: 0,
      rotation: 0,
      configuration: { recipe_id: r.id },
    });
    const m = newMachine();
    m.input = Object.keys(r.inputs).map((item) => ({ item, count: 100 }));
    m.supplied_kw = r.power_kw;
    m.work_energy_kj = 0;
    m.status = "working";
    f.simulation.buildings.powered = m;
    expect(diagnoseFactory(f).issues.some((i) => i.kind === "缺能")).toBe(
      false,
    );
    m.supplied_kw = 0;
    expect(diagnoseFactory(f).issues.some((i) => i.kind === "缺能")).toBe(true);
  });
  it("reports exact local input/output shortages and nameplate rates without creating incidents or changing stock", () => {
    const f = createWorld(user, "诊断"),
      r = recipeDefinitions.get("r1007")!,
      input = Object.keys(r.inputs)[0],
      output = Object.keys(r.outputs)[0];
    f.buildings.push({
      id: "m",
      factory_id: f.id,
      building_type: "m03",
      x: 3,
      y: 0,
      rotation: 0,
      configuration: { recipe_id: r.id },
    });
    f.simulation.buildings.m = newMachine();
    f.simulation.buildings.m.output = [{ item: output, count: 99 }];
    f.simulation.warehouse[input] = 8;
    const before = structuredClone(f),
      report = diagnoseFactory(f);
    expect(report.issues.map((i) => i.kind)).toContain("缺料");
    expect(report.issues.map((i) => i.kind)).toContain("副产物 / 产物堵塞");
    expect(report.issues[0].detail).toContain("本区仓 8");
    expect(report.rates.find((i) => i.item === output)?.output).toBe(
      (r.outputs[output] * 60000) / r.duration_ms,
    );
    expect(f).toEqual(before);
  });
  it("does not call entering P6 or acquiring an item a completed manufacturing milestone", () => {
    const f = createWorld(user, "终局");
    f.simulation.industry!.stage = 6;
    f.simulation.industry!.quests!.completed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    f.simulation.industry!.quests!.claimed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < f.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    f.simulation.industry!.milestones = catalog
      .stages!.slice(0, 5)
      .map((s) => s.milestone_item);
    f.simulation.warehouse[itemID("智能机器人")] = 1;
    expect(industryOutcome(f).complete).toBe(false);
    recordCraft(f, { [itemID("智能机器人")]: 1 });
    expect(industryOutcome(f).complete).toBe(true);
    f.simulation.warehouse[itemID("智能机器人")] = 0;
    expect(industryOutcome(f).complete).toBe(true);
    expect(industryOutcome(f).sandbox).toBe(false);
    recordCraft(f, { [itemID("可扩展智能工厂许可证")]: 1 });
    expect(industryOutcome(f).sandbox).toBe(true);
  });
  it("counts only confirmed production deltas, bounds the window and ignores duplicate / edited ticks", () => {
    const o = new Observations();
    let before = createWorld(user, "观察");
    for (let n = 0; n < 70; n++) {
      const next = structuredClone(before);
      next.simulation.tick++;
      recordCraft(next, { [itemID("基础铁板")]: 2 });
      o.record(before, next);
      o.record(before, next);
      before = next;
    }
    expect(o.snapshot().ticks).toBe(60);
    expect(o.snapshot().produced[itemID("基础铁板")]).toBe(120);
    o.record(before, structuredClone(before));
    expect(o.snapshot().ticks).toBe(60);
    o.clear();
    expect(o.snapshot().ticks).toBe(0);
  });
});
