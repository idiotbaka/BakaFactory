import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemInfoProvider, ItemName, ItemText } from "./ItemInfo";
import IndustryViews from "./IndustryViews";
import QuestPanel from "./QuestPanel";
import { catalog, itemID, recipeDefinitions } from "./local/catalog";
import { createLocalFactory } from "./local/state";
import { createItemInfoIndex, splitItemText } from "./itemInfoModel";

const user = {
  id: "item-info-ui",
  username: "item-info-ui",
  display_name: "道具来源",
  created_at: "now",
  last_login_at: "now",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("item acquisition popovers", () => {
  it("resolves whole canonical names and facility aliases without rewriting quest text", () => {
    const index = createItemInfoIndex(catalog);
    const text =
      "初阶自动投料机；自动投料机或垃圾提取口。设备·简易拆解台 / 简易拆解台";
    const parts = splitItemText(text, index);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(
      parts.filter((part) => part.item).map((part) => [part.text, part.item]),
    ).toEqual([
      ["初阶自动投料机", "i0059"],
      ["自动投料机", "i0059"],
      ["垃圾提取口", "i0059"],
      ["设备·简易拆解台", "i0017"],
      ["简易拆解台", "i0017"],
    ]);
    // Repeated renders must not inherit the global regex cursor.
    expect(splitItemText(text, index)).toEqual(parts);
    expect(splitItemText("尚未定义的物品，不含编号猜测。", index)).toEqual([
      { text: "尚未定义的物品，不含编号猜测。" },
    ]);
  });

  it("links quest titles, descriptions and rewards to the actual manufacturing recipe", () => {
    const factory = createLocalFactory(user, "任务"),
      act = vi.fn();
    const before = JSON.stringify(factory);
    render(
      <QuestPanel
        factory={factory}
        catalog={catalog}
        disabled={false}
        act={act}
      />,
    );
    const quest = within(
      screen.getByRole("article", { name: "获得物流：自动投料机" }),
    );
    expect(
      quest.getAllByRole("button", { name: "初阶自动投料机" }),
    ).toHaveLength(2);
    const trigger = quest.getByRole("button", { name: "垃圾提取口" });
    fireEvent.click(trigger);
    const card = within(screen.getByRole("dialog", { name: "初阶自动投料机" }));
    expect(card.getByText("I0059")).toBeInTheDocument();
    expect(
      card.getByText(/安装用途：自动投料机、垃圾提取口/),
    ).toBeInTheDocument();
    const source = within(card.getByRole("region", { name: /^R1039 / }));
    expect(source.getByText("加工设备：手工装配台")).toBeInTheDocument();
    expect(source.getByText(/15 秒 \/ 批/)).toBeInTheDocument();
    expect(
      source.getByRole("button", { name: "机械抓取爪" }).closest("li"),
    ).toHaveTextContent("机械抓取爪 × 2");
    expect(
      source.getByRole("button", { name: "低速传动轴" }).closest("li"),
    ).toHaveTextContent("低速传动轴 × 2");
    expect(
      source.getByRole("button", { name: "分拣料箱" }).closest("li"),
    ).toHaveTextContent("分拣料箱 × 1");
    fireEvent.click(source.getByRole("button", { name: "机械抓取爪" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "机械抓取爪" }),
    ).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "关闭道具详情" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(JSON.stringify(factory)).toBe(before);
    expect(act).not.toHaveBeenCalled();
  });

  it("exposes workshop inputs and outputs, distinguishes scavenging from recipes and cleans up when changing views", () => {
    const factory = createLocalFactory(user, "工作室"),
      act = vi.fn();
    factory.simulation.warehouse[itemID("垃圾包")] = 12;
    const props = {
      factory,
      catalog,
      disabled: false,
      act,
      onViewChange: vi.fn(),
      children: <span>原地图</span>,
    };
    const { rerender } = render(<IndustryViews {...props} view="workshop" />);
    const recipe = within(
      screen
        .getByLabelText(`${recipeDefinitions.get("r1001")!.name}加工批数`)
        .closest("article")!,
    );
    fireEvent.click(
      within(recipe.getByRole("region", { name: "每批原料" })).getByRole(
        "button",
        { name: "垃圾包" },
      ),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(/无尽垃圾堆/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).queryByRole("region", {
        name: /^R1001 /,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(recipe.getByRole("region", { name: "每批产物" })).getByRole(
        "button",
        { name: "铁质碎片" },
      ),
    );
    expect(
      within(screen.getByRole("dialog", { name: "铁质碎片" })).getByRole(
        "region",
        { name: /^R1001 / },
      ),
    ).toBeInTheDocument();
    rerender(<IndustryViews {...props} view="warehouse" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("region", { name: "当前厂区库存" })).getByRole(
        "button",
        { name: "垃圾包" },
      ),
    );
    expect(screen.getByRole("dialog", { name: "垃圾包" })).toBeInTheDocument();
    rerender(<IndustryViews {...props} view="factory" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("原地图")).toBeVisible();
    expect(act).not.toHaveBeenCalled();
  });

  it("keeps outside controls usable, isolates focused-card shortcuts and removes listeners on close", () => {
    const outside = vi.fn(),
      shortcuts = vi.fn();
    window.addEventListener("keydown", shortcuts);
    try {
      render(
        <ItemInfoProvider catalog={catalog}>
          <ItemName item="i0059" />
          <ItemText>垃圾包</ItemText>
          <button onClick={outside}>外部操作</button>
        </ItemInfoProvider>,
      );
      const trigger = screen.getByRole("button", { name: "初阶自动投料机" });
      fireEvent.click(trigger);
      const card = screen.getByRole("dialog");
      fireEvent.click(within(card).getByRole("heading", { level: 3 }));
      fireEvent.scroll(within(card).getByLabelText("道具详情滚动区域"));
      expect(card).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("button", { name: "关闭道具详情" }), {
        key: "f",
      });
      expect(shortcuts).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.keyDown(window, { key: "f" });
      expect(shortcuts).toHaveBeenCalledTimes(1);
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: "外部操作" }));
      expect(outside).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(trigger);
      fireEvent.scroll(document);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(trigger);
      fireEvent.resize(window);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      window.removeEventListener("keydown", shortcuts);
    }
  });

  it("fits a long source card next to a trigger at the lower right viewport edge", () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("item-info-card")
          ? new DOMRect(0, 0, 420, 600)
          : new DOMRect(990, 730, 22, 20);
      },
    );
    render(
      <ItemInfoProvider catalog={catalog}>
        <ItemName item="i0059" />
      </ItemInfoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "初阶自动投料机" }));
    expect(screen.getByRole("dialog")).toHaveStyle({
      left: "592px",
      top: "122px",
      visibility: "visible",
    });
  });

  it("shows future-stage, milestone and real-work prerequisites without unlocking production", () => {
    const recipe = catalog.recipes.find(
      (r) => !r.legacy && r.gate && (r.tier ?? 1) > 1 && r.conditions?.length,
    )!;
    const id = Object.keys(recipe.outputs)[0];
    const factory = createLocalFactory(user, "前置");
    render(
      <ItemInfoProvider
        catalog={catalog}
        industry={factory.simulation.industry}
      >
        <ItemName item={id} />
      </ItemInfoProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    const source = within(
      screen.getByRole("region", {
        name: `${recipe.id.toUpperCase()} ${recipe.name}`,
      }),
    );
    expect(source.getByText("阶段条件未满足")).toBeInTheDocument();
    expect(source.getByText(/未达成/)).toBeInTheDocument();
    expect(source.getByText(/真实作业凭据/)).toBeInTheDocument();
    expect(factory.simulation.industry!.stage).toBe(1);
  });
});
