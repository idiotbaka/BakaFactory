import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import DiagnosticsPanel from "./DiagnosticsPanel";
import { createWorld } from "./local/world";
import { newMachine } from "./local/state";
import { catalog } from "./local/catalog";
describe("factory diagnostics panel", () => {
  it("separates theoretical and confirmed rates and locates a real machine without supplying materials", () => {
    const f = createWorld(
      {
        id: "ui",
        username: "ui",
        display_name: "诊断",
        created_at: "now",
        last_login_at: "now",
      },
      "工厂",
    );
    f.simulation.industry!.stage = 6;
    f.simulation.industry!.quests!.completed.push("p1_free_hands");
    f.simulation.industry!.quests!.claimed.push("p1_free_hands");
    f.simulation.industry!.milestones = catalog
      .stages!.slice(0, 5)
      .map((s) => s.milestone_item);
    f.buildings.push({
      id: "machine",
      factory_id: f.id,
      building_type: "m03",
      x: 2,
      y: 0,
      rotation: 0,
      configuration: { recipe_id: "r1007" },
    });
    f.simulation.buildings.machine = newMachine();
    const onLocate = vi.fn(),
      before = structuredClone(f);
    render(<DiagnosticsPanel factory={f} onLocate={onLocate} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "进入 P6 尚不等于完成主目标",
    );
    fireEvent.click(screen.getByRole("button", { name: /\(2,0\)/ }));
    expect(onLocate).toHaveBeenCalledWith("machine");
    expect(f).toEqual(before);
    fireEvent.change(screen.getByLabelText("诊断物品搜索"), {
      target: { value: "绝缘线缆" },
    });
    expect(screen.getByText(/web_cable_start/)).toBeInTheDocument();
    expect(screen.getByText(/名义产出/)).toBeInTheDocument();
  });
});
