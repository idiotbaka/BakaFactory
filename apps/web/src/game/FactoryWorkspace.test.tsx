import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryWorkspace from "./FactoryWorkspace";
import { useLocalGame } from "./local/useLocalGame";
import { createLocalFactory, type LocalFactory } from "./local/state";
import type { GameRuntime } from "./local/runtime";
import { catalog, itemID } from "./local/catalog";
import { createWorld, districtSummary } from "./local/world";
import { openingStoryID, p1StoryID } from "./stories/progress";
import { openGameSelect } from "../test/gameSelect";
vi.mock("./local/useLocalGame", () => ({ useLocalGame: vi.fn() }));
const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
const commands = {
  placeBuilding: vi.fn(),
  updateBuilding: vi.fn(),
  deleteBuilding: vi.fn(),
  getFactory: vi.fn(),
};
const backup = vi.fn().mockResolvedValue(undefined),
  runtimeWorld = vi.fn().mockResolvedValue(undefined),
  runtimeAct = vi.fn().mockResolvedValue(undefined),
  restoreCloud = vi.fn().mockResolvedValue(undefined),
  chooseLocal = vi.fn().mockResolvedValue(undefined),
  retry = vi.fn(),
  markStoryViewed = vi.fn().mockResolvedValue(undefined);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.removeItem("bakafactory:power-saving");
});
function prepare(
  existing = true,
  options: {
    error?: string;
    conflict?: boolean;
    online?: boolean;
    setup?: (f: LocalFactory) => void;
    viewedStories?: string[];
    pendingStories?: string[];
  } = {},
) {
  vi.mocked(useLocalGame).mockImplementation(function useMockGame() {
    const [viewedStories, setViewedStories] = useState(
      options.viewedStories ?? [openingStoryID],
    );
    const [pendingStories, setPendingStories] = useState(
      options.pendingStories ?? [],
    );
    const [factory, setFactory] = useState<LocalFactory | null>(() => {
      if (!existing) return null;
      const f = createLocalFactory(user, "本机工厂");
      options.setup?.(f);
      return f;
    });
    const runtime = {
      commands,
      act: runtimeAct,
      world: runtimeWorld,
      backup,
      restoreCloud,
      chooseLocal,
      retryStorage: vi.fn().mockResolvedValue(undefined),
      markStoryViewed: async (id: string) => {
        await markStoryViewed(id);
        setViewedStories((previous) => [...new Set([...previous, id])]);
        setPendingStories((previous) =>
          previous.filter((pending) => pending !== id),
        );
      },
      create: async (name: string) => {
        const f = createLocalFactory(user, name);
        setFactory(f);
        return f;
      },
    } as unknown as GameRuntime;
    return {
      resources: { phase: "ready" as const, completed: 0, total: 0, failed: 0 },
      ready: !options.error,
      viewedStories,
      pendingStories,
      factory,
      districts: factory ? districtSummary(factory) : [],
      error: options.error ?? "",
      message: options.conflict
        ? "发现另一设备上传的云存档，请选择保留的进度"
        : "",
      online: options.online ?? true,
      conflict: options.conflict ?? false,
      uploading: false,
      localSavedAt: "2026-10-20T00:00:00Z",
      cloudSavedAt: null,
      dirty: true,
      paused: !!options.conflict || options.online === false,
      runtime,
      retry,
    };
  });
}
describe("local factory workspace", () => {
  it("searches palette items, buildings and logistics by partial pinyin and initials within the selected phase", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const palette = within(
      screen.getByRole("complementary", { name: "实体图鉴" }),
    );
    const search = palette.getByLabelText("搜索图鉴");
    fireEvent.click(palette.getByRole("button", { name: "物品" }));
    for (const query of ["feitongxian", "ftx", "tongx"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(palette.getByRole("button", { name: /^废铜线/ })).toHaveClass(
        "is-undiscovered",
      );
      expect(
        palette.queryByRole("button", { name: /^基础铁板/ }),
      ).not.toBeInTheDocument();
    }
    fireEvent.click(palette.getByRole("button", { name: "建筑" }));
    fireEvent.change(search, { target: { value: "sggzt" } });
    expect(
      palette.getByRole("button", { name: /^手工工作台/ }),
    ).toBeInTheDocument();
    fireEvent.click(palette.getByRole("button", { name: "物流" }));
    fireEvent.change(search, { target: { value: "chuansong" } });
    expect(
      palette.getByRole("button", { name: /^手摇传送带/ }),
    ).toBeInTheDocument();
    expect(
      palette.queryByRole("button", { name: /^机械传送带/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nonexistent" } });
    expect(
      palette
        .queryAllByRole("button")
        .filter((button) => button.classList.contains("catalog-entry")),
    ).toHaveLength(0);
    fireEvent.change(search, { target: { value: "" } });
    expect(
      palette.getByRole("button", { name: /^手摇传送带/ }),
    ).toBeInTheDocument();
  });
  it("hides map operation errors after three seconds and gives repeated errors a fresh lifetime", async () => {
    vi.useFakeTimers();
    prepare();
    runtimeAct
      .mockRejectedValueOnce(new Error("原料不足"))
      .mockRejectedValueOnce(new Error("原料不足"));
    const { unmount } = render(
      <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "工作室" }));
    const scavenge = screen.getByRole("button", { name: /拾取 1 包垃圾/ });
    await act(async () => {
      fireEvent.click(scavenge);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("原料不足");
    act(() => vi.advanceTimersByTime(2000));
    await act(async () => {
      fireEvent.click(scavenge);
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("alert")).toHaveTextContent("原料不足");
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole("alert")).toHaveTextContent("原料不足");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
  });
  it("filters each catalog by phase, locks future structures, previews future items and keeps original shortcuts", () => {
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.stage = 2;
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const palette = within(
        screen.getByRole("complementary", { name: "实体图鉴" }),
      ),
      phases = within(palette.getByRole("group", { name: "图鉴阶段" }));
    expect(phases.getByRole("button", { name: "P2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(phases.getByRole("button", { name: "P3" })).toBeDisabled();
    fireEvent.click(palette.getByRole("button", { name: "物流" }));
    expect(
      palette.getByRole("button", { name: /^流体管道/ }),
    ).toBeInTheDocument();
    fireEvent.click(phases.getByRole("button", { name: "P1" }));
    expect(
      palette.getByRole("button", { name: /^手摇传送带/ }),
    ).toBeInTheDocument();
    expect(
      palette.queryByRole("button", { name: /^流体管道/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(palette.getByRole("button", { name: "物品" }));
    expect(phases.getByRole("button", { name: "P6" })).toBeEnabled();
    fireEvent.click(phases.getByRole("button", { name: "P6" }));
    const future = catalog.items.find((i) => !i.legacy && i.tier === 6)!;
    fireEvent.change(palette.getByLabelText("搜索图鉴"), {
      target: { value: future.code },
    });
    const entries = palette
      .getAllByRole("button")
      .filter((b) => b.classList.contains("catalog-entry"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveClass("is-undiscovered");
    fireEvent.click(entries[0]);
    expect(
      screen.getByRole("complementary", { name: "实体详情" }),
    ).toHaveTextContent(future.name);
    fireEvent.click(palette.getByRole("button", { name: "建筑" }));
    expect(phases.getByRole("button", { name: "P6" })).toBeDisabled();
    fireEvent.change(palette.getByLabelText("搜索图鉴"), {
      target: { value: "" },
    });
    fireEvent.keyDown(window, { key: "1" });
    expect(phases.getByRole("button", { name: "P1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      palette.getByRole("button", { name: /^手工工作台/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("dispatches the map's quick district selector through the same world operation", async () => {
    let destination = "";
    prepare(true, {
      setup: (f) => {
        Object.assign(f, createWorld(user, "快捷切厂"));
        destination = f.districts![0].id;
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const selector = screen.getByRole("combobox", { name: "快捷切换厂区" });
    const choices = openGameSelect(selector);
    expect(choices.getAllByRole("option")).toHaveLength(6);
    fireEvent.click(choices.getByRole("option", { name: "未命名工厂 2" }));
    await vi.waitFor(() =>
      expect(runtimeWorld).toHaveBeenCalledWith({
        type: "select_district",
        id: destination,
      }),
    );
    expect(commands.placeBuilding).not.toHaveBeenCalled();
    expect(runtimeAct).not.toHaveBeenCalled();
  });
  it("opens the pending P1 chapter once and keeps its replay entry after completion", async () => {
    prepare(true, {
      pendingStories: [p1StoryID],
      setup: (f) => {
        f.simulation.industry!.quests!.completed = ["p1_free_hands"];
        f.simulation.industry!.quests!.claimed = ["p1_free_hands"];
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "P1：工厂开饭了" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "关闭剧情" }),
    ).not.toBeInTheDocument();
    for (let i = 0; i < 4; i++)
      fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(markStoryViewed).toHaveBeenCalledExactlyOnceWith(p1StoryID);
    fireEvent.click(screen.getByText("重放剧情"));
    fireEvent.click(screen.getByRole("button", { name: "P1：工厂开饭了" }));
    expect(screen.getByRole("heading", { name: /1 \/ 5/ })).toHaveTextContent(
      "零件里面",
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭剧情" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps P1 replay locked until a real claim and avoids forcing historical or conflicted progress", () => {
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.developer = {
          warehouse_orders_always_available: true,
        };
      },
    });
    const { unmount } = render(
      <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("重放剧情"));
    expect(
      screen.queryByRole("button", { name: "P1：工厂开饭了" }),
    ).not.toBeInTheDocument();
    unmount();
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.quests!.claimed = ["p1_free_hands"];
      },
    });
    const historical = render(
      <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("重放剧情"));
    expect(
      screen.getByRole("button", { name: "P1：工厂开饭了" }),
    ).toBeInTheDocument();
    historical.unmount();
    prepare(true, {
      conflict: true,
      pendingStories: [p1StoryID],
      setup: (f) => {
        f.simulation.industry!.quests!.claimed = ["p1_free_hands"];
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps manual queue management only in the top HUD across workshop and warehouse views", () => {
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.workshop = {
          recipe_id: "r1001",
          progress: 4,
          total: 3,
          remaining: 2,
        };
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const hud = within(screen.getByRole("region", { name: "工作室加工" }));
    fireEvent.click(screen.getByRole("button", { name: "工作室" }));
    expect(screen.queryByText(/当前进度见顶部横栏/)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "取消队列并返还未完成原料" }),
    ).toHaveLength(1);
    expect(hud.getByText("第 2 / 3 批")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "仓库" }));
    expect(hud.getByText("尚余 2 批（含当前批）")).toBeInTheDocument();
    fireEvent.click(
      hud.getByRole("button", { name: "取消队列并返还未完成原料" }),
    );
    expect(runtimeAct).toHaveBeenCalledExactlyOnceWith({
      type: "cancel_workshop",
    });
    expect(screen.getByRole("button", { name: "仓库" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("automatically plays the opening before naming, saves completion and waits for explicit factory creation", async () => {
    prepare(false, { viewedStories: [] });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "开场：下班计划开启" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /创建第一座工厂/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "关闭剧情" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (let i = 0; i < 4; i++)
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await screen.findByRole("button", { name: /创建第一座工厂/ });
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(markStoryViewed).toHaveBeenCalledExactlyOnceWith(openingStoryID);
    expect(screen.getByLabelText("工厂名称")).toHaveFocus();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("工厂名称"), {
      target: { value: "下班计划" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建第一座工厂/ }));
    await screen.findByRole("heading", { name: "下班计划" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not force the opening on existing factories and replays from the upward story list", () => {
    prepare(true, { viewedStories: [] });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const replay = screen.getByText("重放剧情"),
      guide = screen.getByText("操作指南");
    expect(
      replay.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(replay);
    expect(replay.closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "开场：下班计划开启" }));
    expect(replay.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByRole("region", { name: "工厂工作台" })).not.toHaveClass(
      "is-immersive",
    );
    expect(commands.placeBuilding).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(replay).toHaveFocus();
    expect(markStoryViewed).not.toHaveBeenCalled();
    fireEvent.click(replay);
    fireEvent.click(screen.getByRole("button", { name: "开场：下班计划开启" }));
    expect(screen.getByRole("heading", { name: /1 \/ 5/ })).toBeInTheDocument();
  });
  it("opens building acquisition details without changing tools or triggering editor shortcuts", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const palette = within(
      screen.getByRole("complementary", { name: "实体图鉴" }),
    );
    fireEvent.click(palette.getByRole("button", { name: "物流" }));
    const port = palette.getByRole("button", { name: /垃圾提取口/ });
    fireEvent.click(port);
    const trigger = screen.getByRole("button", { name: "获取来源和关联配方" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /垃圾提取口/ });
    const close = within(dialog).getByRole("button", {
      name: "关闭获取来源和关联配方",
    });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(port).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "工厂工作台" })).not.toHaveClass(
      "is-immersive",
    );
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByLabelText("配方详情滚动区域")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(port).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commands.placeBuilding).not.toHaveBeenCalled();
    expect(commands.updateBuilding).not.toHaveBeenCalled();
    expect(commands.deleteBuilding).not.toHaveBeenCalled();
  });
  it("separates logistics tools and keeps their placement selection", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const palette = within(
      screen.getByRole("complementary", { name: "实体图鉴" }),
    );
    expect(
      palette.queryByRole("button", { name: /^手摇传送带/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(palette.getByRole("button", { name: "物流" }));
    expect(
      palette.queryByRole("button", { name: /^手工工作台/ }),
    ).not.toBeInTheDocument();
    const belt = palette.getByRole("button", { name: /^手摇传送带/ });
    fireEvent.click(belt);
    expect(belt).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "1" });
    expect(palette.getByRole("button", { name: "建筑" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      palette.getByRole("button", { name: /^手工工作台/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("shows stock for discovered items, including spent discoveries, while preserving undiscovered inspection and order", () => {
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.discovered_items = [
          itemID("基础铁板"),
          itemID("废铜线"),
        ];
        f.simulation.warehouse[itemID("基础铁板")] = 0;
        f.simulation.warehouse[itemID("废铜线")] = 12345;
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const palette = within(
      screen.getByRole("complementary", { name: "实体图鉴" }),
    );
    fireEvent.click(palette.getByRole("button", { name: "物品" }));
    const entries = palette
      .getAllByRole("button")
      .filter((b) => b.classList.contains("catalog-entry"));
    expect(entries.map((b) => b.querySelector("strong")!.textContent)).toEqual(
      catalog.items
        .filter((i) => !i.legacy && (i.tier ?? 1) === 1)
        .map((i) => i.name),
    );
    const seen = palette.getByRole("button", { name: /^基础铁板/ }),
      unknown = palette.getByRole("button", { name: /^垃圾包/ });
    expect(seen).not.toHaveClass("is-undiscovered");
    expect(seen).toHaveTextContent("库存 0");
    const stocked = palette.getByRole("button", { name: /^废铜线/ });
    expect(stocked).not.toHaveClass("is-undiscovered");
    expect(stocked).toHaveTextContent("库存 12345");
    expect(unknown).toHaveClass("is-undiscovered");
    expect(unknown).toHaveTextContent("尚未获得");
    expect(unknown).not.toHaveTextContent("库存");
    fireEvent.click(unknown);
    expect(unknown).toHaveAttribute("aria-pressed", "true");
    expect(unknown).toHaveClass("is-undiscovered");
  });
  it("removes the header warehouse summary and retains searchable quantities in the central warehouse", () => {
    const items = catalog.items.filter((i) => !i.legacy).slice(0, 7);
    prepare(true, {
      setup: (f) => {
        for (const i of items) f.simulation.warehouse[i.id] = 42;
      },
    });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(
      screen.queryByText("当前厂区仓库", { exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "仓库" }));
    expect(
      within(screen.getByRole("region", { name: "工厂总仓库" })).getAllByRole(
        "article",
      ),
    ).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("搜索工作室或仓库"), {
      target: { value: items[0].name },
    });
    const stock = within(screen.getByRole("region", { name: "工厂总仓库" }));
    expect(stock.getAllByRole("article")).toHaveLength(1);
    expect(stock.getByText("42 u")).toBeInTheDocument();
  });
  it("preserves build shortcuts, form typing and immersion", async () => {
    prepare();
    render(
      <>
        <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />
        <input aria-label="备注" />
      </>,
    );
    const palette = screen.getByRole("complementary", { name: "实体图鉴" });
    const miner = within(palette).getByRole("button", { name: /^手工工作台/ });
    fireEvent.keyDown(screen.getByLabelText("备注"), { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByRole("region", { name: "工厂工作台" })).toHaveClass(
      "is-immersive",
    );
    fireEvent.keyDown(window, { key: "F" });
    expect(screen.getByRole("region", { name: "工厂工作台" })).not.toHaveClass(
      "is-immersive",
    );
    fireEvent.keyDown(window, { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    expect(commands.placeBuilding).not.toHaveBeenCalled();
  });
  it("creates a local factory with one warehouse initially at the origin and no warehouse build tool", async () => {
    prepare(false);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("工厂名称"), {
      target: { value: "新本机工厂" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建第一座工厂/ }));
    await screen.findByRole("heading", { name: "新本机工厂" });
    const map = await screen.findByRole("group", { name: /21 × 21 工厂地图/ });
    expect(map).toBeInTheDocument();
    expect(
      within(map).getByRole("button", { name: /工厂仓库 WH \(0,0\)/ }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "实体图鉴" }),
      ).queryByRole("button", { name: /工厂仓库/ }),
    ).not.toBeInTheDocument();
  });
  it("persists the power-saving preference", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.click(screen.getByText(/节能模式/, { selector: "button" }));
    expect(screen.getByLabelText("工厂工作台")).toHaveClass("is-eco");
    expect(localStorage.getItem("bakafactory:power-saving")).toBe("true");
  });
  it("offers explicit cloud overwrite and restore actions", async () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.click(screen.getByText("存档"));
    fireEvent.click(screen.getByRole("button", { name: "立即上传云存档" }));
    expect(backup).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/换设备只能恢复最近一次成功上传/),
    ).toBeInTheDocument();
  });
  it("surfaces a cloud conflict instead of silently loading over local progress", () => {
    prepare(true, { conflict: true });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "本机工厂" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保留本机并覆盖云端" }));
    expect(chooseLocal).toHaveBeenCalledOnce();
  });
  it("retains the fixed loading frame and supports retry on storage failure", () => {
    prepare(false, { error: "本地存档无法读取" });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("本地存档无法读取");
    fireEvent.click(screen.getByRole("button", { name: "重新读取工厂" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("blocks creation when online authorization is unavailable", () => {
    prepare(false, { online: false });
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /创建第一座工厂/ }),
    ).toBeDisabled();
  });
});

it("advertises multi-size machines, switches with E or the card control, ignores typing and defaults a new selection to 1×1", () => {
  prepare();
  render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
  const palette = within(
    screen.getByRole("complementary", { name: "实体图鉴" }),
  );
  const card = palette.getByRole("button", { name: /^手工装配台/ });
  expect(card).toHaveTextContent("多尺寸");
  fireEvent.click(card);
  const toggle = palette.getByRole("button", {
    name: "切换 手工装配台 占地尺寸",
  });
  expect(toggle).toHaveTextContent("⇄ 切换为2x2");
  expect(toggle).toHaveClass("multi-size-tag");
  expect(card).not.toContainElement(toggle);
  expect(card.querySelector(".multi-size-tag")).toBeNull();
  expect(card).toHaveAttribute("aria-pressed", "true");
  expect(toggle).toHaveAttribute("title", "当前尺寸：1×1 · E 键切换尺寸");
  fireEvent.keyDown(window, { key: "e" });
  expect(toggle).toHaveTextContent("⇄ 切换为1x1");
  const search = screen.getByRole("textbox", { name: "搜索图鉴" });
  fireEvent.keyDown(search, { key: "e" });
  expect(toggle).toHaveTextContent("⇄ 切换为1x1");
  fireEvent.click(toggle);
  expect(card).toHaveAttribute("aria-pressed", "true");
  expect(toggle).toHaveTextContent("⇄ 切换为2x2");
  fireEvent.keyDown(window, { key: "e" });
  fireEvent.click(palette.getByRole("button", { name: /^手动分拣台/ }));
  expect(
    palette.queryByRole("button", { name: /切换 .* 占地尺寸/ }),
  ).toBeNull();
  fireEvent.click(card);
  expect(
    palette.getByRole("button", { name: "切换 手工装配台 占地尺寸" }),
  ).toHaveTextContent("⇄ 切换为2x2");
  expect(screen.getByText("支持尺寸").nextElementSibling).toHaveTextContent(
    "1×1 / 2×2",
  );
});
