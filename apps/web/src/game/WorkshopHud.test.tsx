import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import WorkshopHud from "./WorkshopHud";
import { createWorld, projectFactory } from "./local/world";
import { catalog, recipeDefinitions } from "./local/catalog";
describe("persistent top manual-work progress", () => {
  it("shows the same queue in another factory and freezes visual work when paused or backpressured", () => {
    const root = createWorld(
        {
          id: "hud",
          username: "hud",
          display_name: "进度",
          created_at: "now",
          last_login_at: "now",
        },
        "主厂",
      ),
      r = recipeDefinitions.get("r1001")!;
    root.simulation.industry!.workshop = {
      recipe_id: r.id,
      progress: 4,
      remaining: 2,
      total: 3,
    };
    root.active_district_id = root.districts![0].id;
    const f = projectFactory(root),
      props = { factory: f, catalog, paused: false };
    const { rerender } = render(<WorkshopHud {...props} />),
      hud = within(screen.getByRole("region", { name: "工作室加工" }));
    expect(hud.getByText(r.name)).toBeInTheDocument();
    expect(hud.getByText("第 2 / 3 批")).toBeInTheDocument();
    expect(hud.getByRole("progressbar")).toHaveAttribute("value", "4");
    rerender(<WorkshopHud {...props} paused />);
    expect(hud.getByText(/已暂停/)).toBeInTheDocument();
    expect(hud.getByRole("progressbar")).toHaveAttribute("value", "4");
    rerender(<WorkshopHud {...props} blocked />);
    expect(hud.getByText(/产物上限等待/)).toBeInTheDocument();
    expect(root.simulation.industry!.workshop?.remaining).toBe(2);
  });
});
