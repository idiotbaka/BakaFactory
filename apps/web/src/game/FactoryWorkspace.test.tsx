import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryWorkspace from "./FactoryWorkspace";
import definitions from "../../../server/internal/catalog/definitions.json";
import {
  ApiError,
  createFactory,
  getCatalog,
  getFactory,
  listFactories,
  placeBuilding,
  updateBuilding,
  deleteBuilding,
  type Catalog,
  type FactoryDetail,
} from "../api/client";
vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  createFactory: vi.fn(),
  getCatalog: vi.fn(),
  getFactory: vi.fn(),
  listFactories: vi.fn(),
  placeBuilding: vi.fn(),
  updateBuilding: vi.fn(),
  deleteBuilding: vi.fn(),
}));
const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
const factory: FactoryDetail = {
  id: "factory",
  owner_id: "owner",
  name: "持久化工厂",
  width: 21,
  height: 21,
  created_at: "now",
  buildings: [
    {
      id: "bus-instance",
      factory_id: "factory",
      building_type: "bus",
      x: 0,
      y: 0,
      rotation: 0,
      configuration: {},
    },
  ],
};
afterEach(() => {
  vi.resetAllMocks();
  localStorage.removeItem("bakafactory:power-saving");
});
function prepare(existing = false) {
  // The same JSON is validated by the server catalog tests; TS infers optional
  // undefined recipe keys that are absent from the actual JSON objects.
  vi.mocked(getCatalog).mockResolvedValue(definitions as unknown as Catalog);
  vi.mocked(listFactories).mockResolvedValue(existing ? [factory] : []);
  vi.mocked(getFactory).mockResolvedValue(factory);
}
describe("factory workspace", () => {
  it("offers build hotkeys and immersion without submitting game edits or stealing typed input", async () => {
    prepare(true);
    render(
      <>
        <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />
        <input aria-label="备注" />
      </>,
    );
    await screen.findByRole("heading", { name: "持久化工厂" });
    const palette = screen.getByRole("complementary", { name: "实体图鉴" });
    const miner = within(palette).getByRole("button", { name: /^采矿机/ });
    const input = screen.getByLabelText("备注");
    fireEvent.keyDown(input, { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(input, { key: "f" });
    const workspace = screen.getByRole("region", { name: "工厂工作台" });
    expect(workspace).not.toHaveClass("is-immersive");
    fireEvent.keyDown(window, { key: "f" });
    expect(workspace).toHaveClass("is-immersive");
    expect(miner).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "F" });
    expect(workspace).not.toHaveClass("is-immersive");
    fireEvent.keyDown(window, { key: "1" });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "6" });
    expect(
      within(palette).getByRole("button", { name: /^物品输入口/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(updateBuilding).not.toHaveBeenCalled();
    expect(deleteBuilding).not.toHaveBeenCalled();
  });
  it("persists energy-saving graphics while keeping the same factory", async () => {
    prepare(true);
    const view = render(
      <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "持久化工厂" });
    fireEvent.click(screen.getByRole("button", { name: /节能模式/ }));
    expect(screen.getByRole("region", { name: "工厂工作台" })).toHaveClass(
      "is-eco",
    );
    expect(localStorage.getItem("bakafactory:power-saving")).toBe("true");
    view.unmount();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("heading", { name: "持久化工厂" });
    expect(screen.getByRole("button", { name: /节能已开启/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "工厂仓库 WH (0,0)" }),
    ).toBeInTheDocument();
    expect(createFactory).not.toHaveBeenCalled();
  });
  it("hides the fixed Bus from the palette and toggles continuous placement without hiding Bus on the board", async () => {
    prepare(true);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("heading", { name: "持久化工厂" });
    const palette = screen.getByRole("complementary", { name: "实体图鉴" });
    expect(
      within(palette).queryByRole("button", { name: /工厂仓库/ }),
    ).not.toBeInTheDocument();
    const miner = within(palette).getByRole("button", { name: /^采矿机/ });
    fireEvent.click(miner);
    expect(miner).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/连续放置 采矿机/)).toBeInTheDocument();
    fireEvent.click(miner);
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(miner);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(miner).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(miner);
    fireEvent.click(screen.getByRole("button", { name: "物品" }));
    expect(screen.queryByText(/连续放置 采矿机/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "工厂仓库 WH (0,0)" }),
    ).toBeInTheDocument();
  });
  it("creates a named factory and shows its persisted center Bus", async () => {
    prepare();
    vi.mocked(createFactory).mockResolvedValue(factory);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("button", { name: "创建第一座工厂" });
    fireEvent.change(screen.getByLabelText("工厂名称"), {
      target: { value: "持久化工厂" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建第一座工厂" }));
    expect(
      await screen.findByRole("heading", { name: "持久化工厂" }),
    ).toBeInTheDocument();
    expect(createFactory).toHaveBeenCalledWith("持久化工厂");
    expect(
      screen.getByRole("button", { name: "工厂仓库 WH (0,0)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 个建筑实例 / 441 格")).toBeInTheDocument();
    expect(screen.queryByLabelText("工厂名称")).not.toBeInTheDocument();
  });
  it("restores the server factory and renders correct grid boundaries", async () => {
    prepare(true);
    const view = render(
      <FactoryWorkspace user={user} onSessionExpired={vi.fn()} />,
    );
    await screen.findByRole("button", { name: "工厂仓库 WH (0,0)" });
    expect(getFactory).toHaveBeenCalledWith("factory", expect.any(AbortSignal));
    expect(view.container.querySelectorAll(".map-tile")).toHaveLength(441);
    expect(view.container.querySelector(".map-tile")).toHaveAttribute(
      "title",
      "(-10, 10)",
    );
    expect(
      view.container.querySelector(".map-tile:last-child"),
    ).toHaveAttribute("title", "(10, -10)");
    expect(
      screen.queryByRole("button", { name: "创建第一座工厂" }),
    ).not.toBeInTheDocument();
  });
  it("inspects machine and item definitions and associated recipes", async () => {
    prepare(true);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("heading", { name: "持久化工厂" });
    fireEvent.click(screen.getByRole("button", { name: /^熔炉/ }));
    const inspector = screen.getByRole("complementary", { name: "实体详情" });
    expect(
      within(inspector).getByRole("heading", { name: "熔炉" }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText("铁板熔炼")).toBeInTheDocument();
    expect(within(inspector).getByText("4s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "物品" }));
    fireEvent.click(screen.getByRole("button", { name: /^齿轮/ }));
    expect(
      within(inspector).getByRole("heading", { name: "齿轮" }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText("齿轮装配")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "工厂仓库 WH (0,0)" }));
    expect(within(inspector).getByText("中心固定")).toBeInTheDocument();
    expect(within(inspector).getByText("(0, 0)")).toBeInTheDocument();
  });
  it("keeps the creation form available after a failed request", async () => {
    prepare();
    vi.mocked(createFactory).mockRejectedValue(new Error("服务暂时不可用"));
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("button", { name: "创建第一座工厂" });
    fireEvent.click(screen.getByRole("button", { name: "创建第一座工厂" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "服务暂时不可用",
    );
    expect(
      screen.getByRole("button", { name: "创建第一座工厂" }),
    ).toBeEnabled();
  });
  it("reloads an already-created factory after a concurrent creation conflict", async () => {
    prepare();
    vi.mocked(listFactories)
      .mockResolvedValueOnce([])
      .mockResolvedValue([factory]);
    vi.mocked(createFactory).mockRejectedValue(
      new ApiError(409, "已有一个工厂"),
    );
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    await screen.findByRole("button", { name: "创建第一座工厂" });
    fireEvent.click(screen.getByRole("button", { name: "创建第一座工厂" }));
    expect(
      await screen.findByRole("heading", { name: "持久化工厂" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("已有一个工厂");
  });
  it("reports expired sessions to the account view", async () => {
    prepare();
    vi.mocked(listFactories).mockRejectedValue(new ApiError(401, "请先登录"));
    const expired = vi.fn();
    render(<FactoryWorkspace user={user} onSessionExpired={expired} />);
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  });
  it("retries a failed factory load", async () => {
    prepare(true);
    vi.mocked(listFactories)
      .mockRejectedValueOnce(new Error("网络不可用"))
      .mockResolvedValue([factory]);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络不可用");
    fireEvent.click(screen.getByRole("button", { name: "重新读取工厂" }));
    expect(
      await screen.findByRole("heading", { name: "持久化工厂" }),
    ).toBeInTheDocument();
  });
});
