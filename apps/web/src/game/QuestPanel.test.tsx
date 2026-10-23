import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestPanel from "./QuestPanel";
import QuestNotifications from "./QuestNotifications";
import IndustryViews from "./IndustryViews";
import { createLocalFactory } from "./local/state";
import { catalog } from "./local/catalog";

const user = {
  id: "quests-ui",
  username: "quests-ui",
  display_name: "任务",
  created_at: "now",
  last_login_at: "now",
};
afterEach(() => vi.useRealTimers());
describe("quest interface", () => {
  it("presents mechanism unlocks as a claimable reward without inventing an item payout", () => {
    const factory = createLocalFactory(user, "机制"),
      act = vi.fn();
    factory.simulation.industry!.quests!.completed = [
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
      "p1_free_hands",
    ];
    render(
      <QuestPanel
        factory={factory}
        catalog={catalog}
        disabled={false}
        act={act}
      />,
    );
    const card = within(
      screen.getByRole("article", { name: "是时候解放双手了" }),
    );
    expect(card.getByText("仓库中解锁下单功能")).toBeInTheDocument();
    expect(card.getByText("阶段终局任务")).toBeInTheDocument();
    expect(
      card.getByText("完成本任务并领取奖励后解锁 P2 阶段。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "是时候解放双手了" }),
    ).toHaveClass("is-stage-final");
    expect(card.queryByRole("listitem")).not.toBeInTheDocument();
    expect(
      card.getByRole("button", { name: "流水线机械手" }),
    ).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: "领取奖励" }));
    expect(act).toHaveBeenCalledWith({
      type: "claim_quest",
      id: "p1_free_hands",
    });
  });
  it("keeps recommended order, leaves unclaimed completions pending and moves claimed tasks to completed", () => {
    const factory = createLocalFactory(user, "任务"),
      world = vi.fn();
    const props = { factory, catalog, disabled: false, act: world };
    const progress = factory.simulation.industry!.quests!;
    progress.completed = ["p1_belt"];
    const { rerender } = render(<QuestPanel {...props} />);
    expect(
      screen.getAllByRole("article").map((x) => x.getAttribute("aria-label")),
    ).toEqual(
      catalog
        .quests!.filter((q) => q.tier === 1 && !q.stage_final)
        .map((q) => q.title),
    );
    const ready = within(
      screen.getByRole("article", { name: "获得物流：手摇传送带" }),
    );
    const reward = within(ready.getByRole("listitem"));
    expect(
      reward.getByRole("button", { name: "手摇传送带" }),
    ).toBeInTheDocument();
    expect(ready.getByRole("listitem")).toHaveTextContent("手摇传送带 × 15");
    fireEvent.click(ready.getByRole("button", { name: "领取奖励" }));
    expect(world).toHaveBeenCalledWith({ type: "claim_quest", id: "p1_belt" });
    expect(
      within(
        screen.getByRole("article", { name: "获得设备：简易拆解台" }),
      ).getByRole("button", { name: "领取奖励" }),
    ).toBeDisabled();
    rerender(<QuestPanel {...props} disabled />);
    expect(ready.getByRole("button", { name: "领取奖励" })).toBeDisabled();
    progress.claimed = ["p1_belt"];
    rerender(<QuestPanel {...props} />);
    expect(screen.getAllByRole("article")).toHaveLength(
      catalog.quests!.filter((q) => q.tier === 1 && !q.stage_final).length - 1,
    );
    fireEvent.click(screen.getByRole("button", { name: /^已完成/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("P1 · 已领奖")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "领取奖励" }),
    ).not.toBeInTheDocument();
  });
  it("hides the final and its pending count until four ordinary tasks are achieved, then keeps a historical claim visible", () => {
    const factory = createLocalFactory(user, "终局显示");
    const p = factory.simulation.industry!;
    const props = { factory, catalog, disabled: false, act: vi.fn() };
    const ids = catalog
      .quests!.filter((q) => q.tier === 1 && !q.stage_final)
      .map((q) => q.id);
    p.quests!.completed = ids.slice(0, 3);
    const { rerender } = render(<QuestPanel {...props} />);
    expect(
      screen.queryByRole("article", { name: "是时候解放双手了" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "待完成（8）" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 4 项/)).toBeInTheDocument();
    p.quests!.completed.push(ids[3]);
    rerender(<QuestPanel {...props} />);
    expect(
      screen.getByRole("article", { name: "是时候解放双手了" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "待完成（9）" }),
    ).toBeInTheDocument();
    p.quests!.completed = ["p1_free_hands"];
    p.quests!.claimed = ["p1_free_hands"];
    p.stage = 2;
    rerender(<QuestPanel {...props} />);
    expect(
      screen.getByRole("article", { name: "液压时代入场券" }),
    ).toHaveTextContent("解锁 P3 阶段");
    fireEvent.click(screen.getByRole("button", { name: /^已完成/ }));
    expect(
      screen.getByRole("article", { name: "是时候解放双手了" }),
    ).toHaveClass("is-stage-final");
  });
  it("does not signal a hidden stale final completion as a claimable reward", () => {
    const factory = createLocalFactory(user, "隐藏红点");
    factory.simulation.industry!.quests!.completed = ["p1_free_hands"];
    render(
      <IndustryViews
        factory={factory}
        catalog={catalog}
        disabled={false}
        act={vi.fn()}
        view="factory"
        onViewChange={vi.fn()}
      >
        {null}
      </IndustryViews>,
    );
    expect(
      screen.queryByRole("img", { name: "有任务奖励待领取" }),
    ).not.toBeInTheDocument();
  });
  it("places the quest entry immediately after factory and signals only unclaimed rewards", () => {
    const factory = createLocalFactory(user, "红点"),
      onViewChange = vi.fn();
    factory.simulation.industry!.quests!.completed = ["p1_belt"];
    const props = {
      factory,
      catalog,
      disabled: false,
      act: vi.fn(),
      children: null,
      view: "factory" as const,
      onViewChange,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const tabs = within(
      screen.getByRole("navigation", { name: "工厂视图" }),
    ).getAllByRole("button");
    expect(tabs[0]).toHaveTextContent("工厂");
    expect(tabs[1]).toHaveTextContent("任务");
    expect(
      within(tabs[1]).getByRole("img", { name: "有任务奖励待领取" }),
    ).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(onViewChange).toHaveBeenCalledWith("quests");
    factory.simulation.industry!.quests!.claimed = ["p1_belt"];
    rerender(<IndustryViews {...props} />);
    expect(
      screen.queryByRole("img", { name: "有任务奖励待领取" }),
    ).not.toBeInTheDocument();
  });
  it("shows each confirmed completion for three seconds without restarting on snapshot refresh", () => {
    vi.useFakeTimers();
    const notices = [
      { sequence: 1, id: "p1_belt" },
      { sequence: 2, id: "p1_feeder" },
    ];
    const { rerender } = render(
      <QuestNotifications notices={notices} catalog={catalog} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "任务达成：获得物流：手摇传送带",
    );
    act(() => vi.advanceTimersByTime(2000));
    rerender(
      <QuestNotifications
        notices={structuredClone(notices)}
        catalog={catalog}
      />,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "任务达成：获得物流：自动投料机",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<QuestNotifications notices={notices} catalog={catalog} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(
      <QuestNotifications
        notices={[...notices, { sequence: 3, id: "p1_smelter" }]}
        catalog={catalog}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("简易熔炼炉");
    rerender(<QuestNotifications notices={[]} catalog={catalog} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
