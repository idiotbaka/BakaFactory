import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import IndustryViews from "./IndustryViews";
import { createWorld, actWorld } from "./local/world";
import { catalog } from "./local/catalog";
import { newMachine } from "./local/state";

const user = {
  id: "developer-ui",
  username: "developer-ui",
  display_name: "开发",
  created_at: "now",
  last_login_at: "now",
};
describe("developer tools", () => {
  it("applies validated TPS only through the session control and offers a reset", () => {
    const factory = createWorld(user, "模拟倍速"),
      onTickRateChange = vi.fn();
    const props = {
      factory,
      catalog,
      disabled: false,
      act: vi.fn(),
      world: vi.fn(),
      view: "developer" as const,
      developerToolsVisible: true,
      onViewChange: vi.fn(),
      onTickRateChange,
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const input = screen.getByLabelText("模拟 TPS");
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "应用 TPS" }));
    expect(onTickRateChange).toHaveBeenCalledWith(4);
    expect(props.world).not.toHaveBeenCalled();
    rerender(<IndustryViews {...props} tickRate={4} />);
    expect(screen.getByLabelText("模拟 TPS")).toHaveValue(4);
    fireEvent.change(screen.getByLabelText("模拟 TPS"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 TPS" }));
    expect(screen.getByRole("alert")).toHaveTextContent("整数");
    expect(onTickRateChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "恢复 2 TPS" }));
    expect(onTickRateChange).toHaveBeenLastCalledWith(2);
    rerender(<IndustryViews {...props} tickRate={4} disabled />);
    expect(screen.getByRole("button", { name: "应用 TPS" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "恢复 2 TPS" })).toBeDisabled();
  });
  it("hides the entry and developer content by default, including a stale selected view", () => {
    const factory = createWorld(user, "默认隐藏"),
      props = {
        factory,
        catalog,
        disabled: false,
        act: vi.fn(),
        world: vi.fn(),
        view: "developer" as const,
        onViewChange: vi.fn(),
      };
    const { rerender } = render(
      <IndustryViews {...props}>
        <span>原工厂地图</span>
      </IndustryViews>,
    );
    expect(
      screen.queryByRole("button", { name: "开发者工具" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("原工厂地图")).toBeVisible();
    rerender(
      <IndustryViews {...props} developerToolsVisible>
        <span>原工厂地图</span>
      </IndustryViews>,
    );
    expect(
      screen.getByRole("button", { name: "开发者工具" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
    rerender(
      <IndustryViews {...props} developerToolsVisible={false}>
        <span>原工厂地图</span>
      </IndustryViews>,
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("原工厂地图")).toBeVisible();
    expect(props.world).not.toHaveBeenCalled();
  });
  it("preserves diagnostic observations and locate actions inside the diagnostics subpage without changing the world", () => {
    const factory = createWorld(user, "诊断子页"),
      world = vi.fn(),
      onLocateBuilding = vi.fn();
    factory.buildings.push({
      id: "machine",
      factory_id: factory.id,
      building_type: "m03",
      x: 2,
      y: 0,
      rotation: 0,
      configuration: { recipe_id: "r1007" },
    });
    factory.simulation.buildings.machine = newMachine();
    const before = structuredClone(factory);
    render(
      <IndustryViews
        factory={factory}
        catalog={catalog}
        disabled
        act={vi.fn()}
        world={world}
        view="developer"
        developerToolsVisible
        onViewChange={vi.fn()}
        onLocateBuilding={onLocateBuilding}
        observation={{
          ticks: 7,
          produced: {},
          solid: 12,
          fluid: 3,
          freight: 2,
        }}
      >
        {null}
      </IndustryViews>,
    );
    fireEvent.click(screen.getByRole("button", { name: "闭环诊断" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /最近 7 个运行 tick/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /\(2,0\)/ }));
    expect(onLocateBuilding).toHaveBeenCalledWith("machine");
    fireEvent.click(screen.getByRole("button", { name: "功能测试" }));
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(world).not.toHaveBeenCalled();
    expect(factory).toEqual(before);
  });
  it("places feature testing under developer tools and controls the persisted switch through a world action", () => {
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
      developerToolsVisible: true,
      onViewChange,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const tabs = within(
      screen.getByRole("navigation", { name: "工厂视图" }),
    ).getAllByRole("button");
    expect(tabs.some((b) => b.textContent === "诊断")).toBe(false);
    expect(tabs.at(-1)).toHaveTextContent("开发者工具");
    fireEvent.click(tabs.at(-1)!);
    expect(onViewChange).toHaveBeenCalledWith("developer");
    expect(screen.getByRole("button", { name: "功能测试" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
      developerToolsVisible: true,
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
