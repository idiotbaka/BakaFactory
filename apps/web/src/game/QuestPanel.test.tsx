import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestPanel from "./QuestPanel";
import QuestNotifications from "./QuestNotifications";
import IndustryViews from "./IndustryViews";
import { createLocalFactory } from "./local/state";
import { catalog, itemID } from "./local/catalog";

const user = {
  id: "quests-ui",
  username: "quests-ui",
  display_name: "任务",
  created_at: "now",
  last_login_at: "now",
};
afterEach(() => vi.useRealTimers());
describe("quest interface", () => {
  it("shows two pink key tags and separates actual material submission from claiming", () => {
    const factory = createLocalFactory(user, "舱门"),
      act = vi.fn();
    const p = factory.simulation.industry!;
    p.stage = 2;
    p.quests!.completed = ["p1_free_hands"];
    p.quests!.claimed = ["p1_free_hands"];
    factory.simulation.warehouse = {
      [itemID("基础铁板")]: 50,
      [itemID("铜条")]: 49,
    };
    const props = { factory, catalog, disabled: false, act };
    const { rerender } = render(<QuestPanel {...props} />);
    const card = within(screen.getByRole("article", { name: "舱门过于拥挤" }));
    expect(card.getByText("关键任务")).toHaveClass("quest-critical-tag");
    expect(
      within(
        screen.getByRole("article", { name: "第一位会走路的帕鲁同事" }),
      ).getByText("关键任务"),
    ).toBeInTheDocument();
    expect(card.getByRole("button", { name: "提交材料" })).toBeDisabled();
    factory.simulation.warehouse[itemID("铜条")] = 50;
    rerender(<QuestPanel {...props} />);
    fireEvent.click(card.getByRole("button", { name: "提交材料" }));
    expect(act).toHaveBeenLastCalledWith({
      type: "submit_quest",
      id: "p2_crowded_hatch",
    });
    p.quests!.completed.push("p2_crowded_hatch");
    rerender(<QuestPanel {...props} />);
    fireEvent.click(card.getByRole("button", { name: "领取奖励" }));
    expect(act).toHaveBeenLastCalledWith({
      type: "claim_quest",
      id: "p2_crowded_hatch",
    });
    expect(
      card.getByText("让你的工厂可以升级取货和供货能力"),
    ).toBeInTheDocument();
    expect(
      card.getByText(
        "（完成后，可以在厂区页面中对工厂安装新的存入和取货终端）",
      ),
    ).toBeInTheDocument();
  });
  it("shows per-item P2 progress and logistics rewards without enabling a partial completion claim", () => {
    const factory = createLocalFactory(user, "P2 进度"),
      p = factory.simulation.industry!;
    p.stage = 2;
    p.quests!.completed = ["p1_free_hands"];
    p.quests!.claimed = ["p1_free_hands"];
    const q = catalog.quests!.find((q) => q.id === "p2_iron")!,
      [iron, plate] = q.goal.items!;
    p.quests!.factory_produced = { [iron]: 100, [plate]: 60 };
    p.quests!.warehouse_received = { [iron]: 40, [plate]: 90 };
    render(
      <QuestPanel
        factory={factory}
        catalog={catalog}
        disabled={false}
        act={vi.fn()}
      />,
    );
    const card = within(
        screen.getByRole("article", { name: "铁傀儡保护协会" }),
      ),
      progress = within(card.getByRole("list", { name: "自动化入库进度" }));
    expect(progress.getByText("40 / 100")).toBeInTheDocument();
    expect(progress.getByText("60 / 100")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "领取奖励" })).toBeDisabled();
    expect(card.getByText(/× 24/)).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "科技树点歪了吗？没有" }),
    ).not.toBeInTheDocument();
  });
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
  it("prioritizes pending rewards, preserves order within each status and moves claimed tasks to completed", () => {
    const factory = createLocalFactory(user, "任务"),
      world = vi.fn();
    const props = { factory, catalog, disabled: false, act: world };
    const progress = factory.simulation.industry!.quests!;
    const { rerender } = render(<QuestPanel {...props} />);
    expect(
      screen.getAllByRole("article").map((x) => x.getAttribute("aria-label")),
    ).toEqual(
      catalog
        .quests!.filter((q) => q.tier === 1 && !q.stage_final)
        .map((q) => q.title),
    );
    progress.completed = ["p1_feeder", "p1_belt"];
    rerender(<QuestPanel {...props} />);
    expect(
      screen.getAllByRole("article").map((x) => x.getAttribute("aria-label")),
    ).toEqual([
      "给我自己动！",
      "筷子夹来夹去",
      "开局一对爪，材料全靠捡",
      "逆向工程",
      "手摇曲柄",
      "欢迎来到青铜时代",
      "这是？工作台！",
      "工厂的一小步",
    ]);
    const ready = within(screen.getByRole("article", { name: "给我自己动！" }));
    const reward = within(ready.getByRole("listitem"));
    expect(
      reward.getByRole("button", { name: "手摇传送带" }),
    ).toBeInTheDocument();
    expect(ready.getByRole("listitem")).toHaveTextContent(
      /手摇传送带\s*×\s*15/,
    );
    fireEvent.click(ready.getByRole("button", { name: "领取奖励" }));
    expect(world).toHaveBeenCalledWith({ type: "claim_quest", id: "p1_belt" });
    expect(
      within(screen.getByRole("article", { name: "逆向工程" })).getByRole(
        "button",
        { name: "领取奖励" },
      ),
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
    const tags = within(screen.getByLabelText("任务标签"));
    expect(tags.getByText("P1")).toBeInTheDocument();
    expect(tags.getByText("已领奖")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "领取奖励" }),
    ).not.toBeInTheDocument();
    progress.claimed = ["p1_feeder", "p1_belt"];
    rerender(<QuestPanel {...props} />);
    expect(
      screen.getAllByRole("article").map((x) => x.getAttribute("aria-label")),
    ).toEqual(["给我自己动！", "筷子夹来夹去"]);
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
    expect(
      screen.getByText("终局任务会在工厂发展到一定程度后出现"),
    ).toBeInTheDocument();
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
      screen.queryByRole("article", { name: "科技树点歪了吗？没有" }),
    ).not.toBeInTheDocument();
    p.quests!.completed.push(
      ...catalog
        .quests!.filter((q) => q.tier === 2 && !q.stage_final)
        .slice(0, 10)
        .map((q) => q.id),
    );
    rerender(<QuestPanel {...props} />);
    expect(
      screen.getByRole("article", { name: "科技树点歪了吗？没有" }),
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
      "任务达成：给我自己动！",
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
      "任务达成：筷子夹来夹去",
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
    expect(screen.getByRole("status")).toHaveTextContent("欢迎来到青铜时代");
    rerender(<QuestNotifications notices={[]} catalog={catalog} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
