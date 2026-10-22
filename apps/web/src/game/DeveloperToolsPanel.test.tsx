import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import IndustryViews from "./IndustryViews";
import { createWorld, actWorld } from "./local/world";
import { catalog } from "./local/catalog";

const user = {
  id: "developer-ui",
  username: "developer-ui",
  display_name: "开发",
  created_at: "now",
  last_login_at: "now",
};
describe("developer tools", () => {
  it("places the tab after diagnostics and controls the persisted switch through a world action", () => {
    const factory = createWorld(user, "开发"),
      world = vi.fn(),
      onViewChange = vi.fn();
    const props = {
      factory,
      catalog,
      disabled: false,
      act: vi.fn(),
      world,
      children: null,
      view: "developer" as const,
      onViewChange,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const tabs = within(
      screen.getByRole("navigation", { name: "工厂视图" }),
    ).getAllByRole("button");
    const index = tabs.findIndex((b) => b.textContent === "诊断");
    expect(tabs[index + 1]).toHaveTextContent("开发者工具");
    fireEvent.click(tabs[index + 1]);
    expect(onViewChange).toHaveBeenCalledWith("developer");
    expect(screen.queryByLabelText("搜索工作室或仓库")).not.toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: /仓库下单始终可用/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(world).toHaveBeenCalledWith({
      type: "developer_settings",
      warehouse_orders_always_available: true,
    });
    const enabled = actWorld(factory, {
      type: "developer_settings",
      warehouse_orders_always_available: true,
    });
    rerender(<IndustryViews {...props} factory={enabled} />);
    expect(toggle).toBeChecked();
    rerender(
      <IndustryViews
        {...props}
        factory={enabled}
        view="warehouse"
        onOrder={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "下单粗密封圈" })).toBeEnabled();
    expect(enabled.simulation.industry!.stage).toBe(1);
    expect(enabled.simulation.industry!.quests!.claimed).toEqual([]);
  });
  it("disables edits while paused and waits for dependent orders to finish before switching off", () => {
    const factory = actWorld(createWorld(user, "开发"), {
      type: "developer_settings",
      warehouse_orders_always_available: true,
    });
    const props = {
      factory,
      catalog,
      disabled: true,
      act: vi.fn(),
      world: vi.fn(),
      children: null,
      view: "developer" as const,
      onViewChange: vi.fn(),
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const toggle = screen.getByRole("switch", { name: /仓库下单始终可用/ });
    expect(toggle).toBeDisabled();
    factory.simulation.industry!.workshop = {
      recipe_id: "r1030",
      progress: 0,
      remaining: 1,
      total: 1,
      order: {
        item: "i0050",
        requested: 1,
        step_index: 0,
        steps: [{ recipe_id: "r1030", batches: 1 }],
        inventory: { i0009: 2, i0029: 1 },
      },
    };
    rerender(<IndustryViews {...props} disabled={false} />);
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("完成或取消订单");
    factory.simulation.industry!.quests!.claimed = ["p1_free_hands"];
    rerender(<IndustryViews {...props} disabled={false} />);
    expect(toggle).toBeEnabled();
  });
});
