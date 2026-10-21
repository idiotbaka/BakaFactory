import { describe, it, expect } from "vitest";
import { auditClosure } from "../../../../../scripts/gameplay-closure.mjs";
import { catalog, itemID } from "./catalog";
describe("energy and actual-work start-up closure", () => {
  it("reaches every industrial recipe and all six milestones through paid energy and real job capabilities", () => {
    const r = auditClosure(catalog);
    expect(r.stage).toBe(6);
    expect(r.unreachable).toEqual([]);
    expect(r.milestones.every((s) => s.reached)).toBe(true);
    expect(r.capabilities).toEqual(
      expect.arrayContaining(["heat", "shaft", "hydraulic", "electric"]),
    );
    expect(r.reached).toContain("r5050");
  });
  it("detects the first electric cable cycle and the steam / hydraulic pipe cycle", () => {
    for (const id of ["web_cable_start", "web_pipe_early"]) {
      const c = structuredClone(catalog);
      c.recipes = c.recipes.filter((r) => r.id !== id);
      const audit = auditClosure(c);
      expect(audit.unreachable.length).toBeGreaterThan(0);
      expect(audit.milestones.some((s) => !s.reached)).toBe(true);
    }
  });
  it("does not grant training samples without compatible paid charging or real camera components", () => {
    const c = structuredClone(catalog);
    c.buildings = c.buildings.filter((b) => b.role !== "station");
    const a = auditClosure(c);
    expect(a.unreachable.map((r) => r.id)).toEqual(
      expect.arrayContaining(["r5048", "r5049", "r5050"]),
    );
    const camera = structuredClone(catalog);
    for (const r of camera.recipes) delete r.outputs[itemID("摄像头组件")];
    expect(auditClosure(camera).unreachable.map((r) => r.id)).toContain(
      "r5050",
    );
  });
  it("keeps the boot cable finite, gated, manual and less efficient than the industrial route", () => {
    const r = catalog.recipes.find((r) => r.id === "web_cable_start")!;
    expect(r.building_type).toBe("m08");
    expect(r.power_kw).toBe(0);
    expect(r.duration_ms).toBe(15000);
    expect(r.tier).toBe(4);
    expect(r.gate).toBe(catalog.stages![2].milestone_item);
    expect(r.inputs[itemID("粗铜丝")]).toBe(5);
    expect(r.inputs[itemID("绝缘胶")]).toBe(2);
    expect(r.outputs[itemID("绝缘线缆")]).toBe(2);
  });
});
