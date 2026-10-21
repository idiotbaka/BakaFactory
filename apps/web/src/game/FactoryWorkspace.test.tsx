import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryWorkspace from "./FactoryWorkspace";
import { useLocalGame } from "./local/useLocalGame";
import { createLocalFactory, type LocalFactory } from "./local/state";
import type { GameRuntime } from "./local/runtime";
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
  restoreCloud = vi.fn().mockResolvedValue(undefined),
  chooseLocal = vi.fn().mockResolvedValue(undefined),
  retry = vi.fn();
afterEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("bakafactory:power-saving");
});
function prepare(
  existing = true,
  options: { error?: string; conflict?: boolean; online?: boolean } = {},
) {
  vi.mocked(useLocalGame).mockImplementation(function useMockGame() {
    const [factory, setFactory] = useState<LocalFactory | null>(() =>
      existing ? createLocalFactory(user, "本机工厂") : null,
    );
    const runtime = {
      commands,
      backup,
      restoreCloud,
      chooseLocal,
      retryStorage: vi.fn().mockResolvedValue(undefined),
      create: async (name: string) => {
        const f = createLocalFactory(user, name);
        setFactory(f);
        return f;
      },
    } as unknown as GameRuntime;
    return {
      ready: !options.error,
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
