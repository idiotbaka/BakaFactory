import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryWorkspace from "./FactoryWorkspace";
import { useLocalGame } from "./local/useLocalGame";
import { createLocalFactory, type LocalFactory } from "./local/state";
import type { GameRuntime } from "./local/runtime";
import { catalog, itemID } from "./local/catalog";
import { openingStoryID } from "./stories/progress";
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
  runtimeAct = vi.fn().mockResolvedValue(undefined),
  restoreCloud = vi.fn().mockResolvedValue(undefined),
  chooseLocal = vi.fn().mockResolvedValue(undefined),
  retry = vi.fn(),
  markStoryViewed = vi.fn().mockResolvedValue(undefined);
afterEach(() => {
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
  } = {},
) {
  vi.mocked(useLocalGame).mockImplementation(function useMockGame() {
    const [viewedStories, setViewedStories] = useState(
      options.viewedStories ?? [openingStoryID],
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
      backup,
      restoreCloud,
      chooseLocal,
      retryStorage: vi.fn().mockResolvedValue(undefined),
      markStoryViewed: async (id: string) => {
        await markStoryViewed(id);
        setViewedStories((previous) => [...new Set([...previous, id])]);
      },
      create: async (name: string) => {
        const f = createLocalFactory(user, name);
        setFactory(f);
        return f;
      },
    } as unknown as GameRuntime;
    return {
      ready: !options.error,
      viewedStories,
      factory,
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
    const port = palette.getByRole("button", { name: /^垃圾提取口/ });
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
  it("dims never-obtained items while preserving order, inspection and previously spent discoveries", () => {
    prepare(true, {
      setup: (f) => {
        f.simulation.industry!.discovered_items = [itemID("基础铁板")];
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
      catalog.items.filter((i) => !i.legacy).map((i) => i.name),
    );
    const seen = palette.getByRole("button", { name: /^基础铁板/ }),
      unknown = palette.getByRole("button", { name: /^垃圾包/ });
    expect(seen).not.toHaveClass("is-undiscovered");
    expect(unknown).toHaveClass("is-undiscovered");
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
      within(screen.getByRole("region", { name: "当前厂区库存" })).getAllByRole(
        "article",
      ),
    ).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("搜索工作室或仓库"), {
      target: { value: items[0].name },
    });
    const stock = within(screen.getByRole("region", { name: "当前厂区库存" }));
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
  it("creates a local factory and retains the fixed warehouse", async () => {
    prepare(false);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("工厂名称"), {
      target: { value: "新本机工厂" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建第一座工厂/ }));
    await screen.findByRole("heading", { name: "新本机工厂" });
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "实体图鉴" }),
      ).queryByRole("button", { name: /工厂仓库/ }),
    ).not.toBeInTheDocument();
  });
  it("persists the power-saving preference", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /节能模式/ }));
    expect(screen.getByRole("region", { name: "工厂工作台" })).toHaveClass(
      "is-eco",
    );
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
