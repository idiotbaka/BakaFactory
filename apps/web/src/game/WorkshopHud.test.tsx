import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WorkshopHud from "./WorkshopHud";
import { createWorld, projectFactory } from "./local/world";
import { catalog, recipeDefinitions } from "./local/catalog";
describe("persistent top manual-work progress", () => {
  it("identifies mechanical orders and shows remaining work across recipe steps", () => {
    const factory = createWorld(
      {
        id: "order-hud",
        username: "hud",
        display_name: "机械手",
        created_at: "now",
        last_login_at: "now",
      },
      "主厂",
    );
    factory.simulation.industry!.workshop = {
      recipe_id: "r1030",
      progress: 1,
      remaining: 1,
      total: 2,
      order: {
        item: "i0053",
        requested: 3,
        step_index: 0,
        inventory: { i0009: 2, i0029: 1, i0050: 3 },
        steps: [
          { recipe_id: "r1030", batches: 2 },
          { recipe_id: "r1033", batches: 2 },
        ],
      },
    };
    const onCancel = vi.fn();
    render(
      <WorkshopHud
        factory={factory}
        catalog={catalog}
        paused={false}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("机械手自动加工中")).toBeInTheDocument();
    expect(screen.getByText("工序 1 / 2 · 尚余 3 批")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消订单并回收物料" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("manages remaining batches in the HUD and respects pause and headquarters restrictions", () => {
    const factory = createWorld(
      {
        id: "cancel-hud",
        username: "hud",
        display_name: "队列",
        created_at: "now",
        last_login_at: "now",
      },
      "主厂",
    );
    factory.simulation.industry!.workshop = {
      recipe_id: "r1001",
      progress: 4,
      remaining: 2,
      total: 3,
    };
    const onCancel = vi.fn();
    const props = { factory, catalog, paused: false, onCancel };
    const { rerender } = render(<WorkshopHud {...props} />);
    const hud = within(screen.getByRole("region", { name: "工作室加工" }));
    expect(hud.getByText("尚余 2 批（含当前批）")).toBeInTheDocument();
    const cancel = hud.getByRole("button", {
      name: "取消队列并返还未完成原料",
    });
    expect(cancel).toBeEnabled();
    rerender(<WorkshopHud {...props} paused />);
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<WorkshopHud {...props} canCancel={false} />);
    expect(cancel).toBeDisabled();
    expect(hud.getByTitle("请切换到起始回收场取消队列")).toBeInTheDocument();
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
    // A full output warehouse stops work but must still allow cancellation.
    rerender(<WorkshopHud {...props} blocked />);
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(factory.simulation.industry!.workshop!.remaining).toBe(2);
    factory.simulation.industry!.workshop = { recipe_id: "r1001", progress: 0 };
    rerender(<WorkshopHud {...props} />);
    expect(hud.getByText("第 1 / 1 批")).toBeInTheDocument();
    expect(hud.getByText("尚余 1 批（含当前批）")).toBeInTheDocument();
    delete factory.simulation.industry!.workshop;
    rerender(<WorkshopHud {...props} />);
    expect(hud.getByText("队列空闲")).toBeInTheDocument();
    expect(hud.queryByRole("button")).not.toBeInTheDocument();
    expect(hud.queryByText(/尚余/)).not.toBeInTheDocument();
  });
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
    expect(hud.getByRole("progressbar")).toHaveAttribute("max", "5");
    rerender(<WorkshopHud {...props} paused />);
    expect(hud.getByText(/已暂停/)).toBeInTheDocument();
    expect(hud.getByRole("progressbar")).toHaveAttribute("value", "4");
    rerender(<WorkshopHud {...props} blocked />);
    expect(hud.getByText(/产物上限等待/)).toBeInTheDocument();
    expect(root.simulation.industry!.workshop?.remaining).toBe(2);
    root.simulation.industry!.workshop!.progress = 9;
    rerender(<WorkshopHud {...props} paused />);
    expect(hud.getByRole("progressbar")).toHaveAttribute("value", "5");
    expect(root.simulation.industry!.workshop!.progress).toBe(9);
  });
});
