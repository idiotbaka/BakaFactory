import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountPanel from "./AccountPanel";
vi.mock("./game/FactoryWorkspace", () => ({ default: () => null }));
import {
  ApiError,
  authenticate,
  getCurrentUser,
  logout,
  updateProfile,
} from "./api/client";
vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  authenticate: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  updateProfile: vi.fn(),
}));
const user = {
  id: "user-1",
  username: "factory_user",
  display_name: "厂长",
  created_at: "2026-10-14T00:00:00Z",
  last_login_at: "2026-10-14T00:00:00Z",
};
afterEach(() => vi.resetAllMocks());
function enterCredentials() {
  fireEvent.change(screen.getByLabelText("用户名"), {
    target: { value: "factory_user" },
  });
  fireEvent.change(screen.getByLabelText("密码", { exact: true }), {
    target: { value: "correct-password" },
  });
}
describe("account UI", () => {
  it("registers, saves a nickname, and logs out", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(authenticate).mockResolvedValue(user);
    vi.mocked(updateProfile).mockResolvedValue({
      ...user,
      display_name: "新的厂长",
    });
    vi.mocked(logout).mockResolvedValue();
    render(<AccountPanel />);
    await screen.findByText("为你的工厂，留一个位置。");
    enterCredentials();
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号并进入" }));
    expect(await screen.findByText("欢迎，厂长")).toBeInTheDocument();
    expect(authenticate).toHaveBeenCalledWith(
      "register",
      "factory_user",
      "correct-password",
    );
    fireEvent.click(screen.getByText("玩家档案"));
    fireEvent.change(screen.getByLabelText("昵称"), {
      target: { value: "新的厂长" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存昵称" }));
    expect(await screen.findByText("欢迎，新的厂长")).toBeInTheDocument();
    expect(updateProfile).toHaveBeenCalledWith("新的厂长");
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
    expect(await screen.findByText("该继续工作了")).toBeInTheDocument();
    expect(logout).toHaveBeenCalledOnce();
  });
  it("restores a server profile on reload", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    const onUserChange = vi.fn();
    render(<AccountPanel onUserChange={onUserChange} />);
    expect(onUserChange).toHaveBeenCalledWith(undefined);
    expect(await screen.findByText("欢迎，厂长")).toBeInTheDocument();
    expect(onUserChange).toHaveBeenLastCalledWith(user);
    expect(screen.getByLabelText("昵称")).toHaveValue("厂长");
  });
  it("rejects password mismatch without sending credentials", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    render(<AccountPanel />);
    await screen.findByText("为你的工厂，留一个位置。");
    enterCredentials();
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号并进入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "两次输入的密码不一致",
    );
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("shows login errors and allows retry", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(authenticate)
      .mockRejectedValueOnce(new ApiError(401, "用户名或密码不正确"))
      .mockResolvedValueOnce(user);
    render(<AccountPanel />);
    await screen.findByText("为你的工厂，留一个位置。");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "登录并继续游戏" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "用户名或密码不正确",
    );
    fireEvent.click(screen.getByRole("button", { name: "登录并继续游戏" }));
    expect(await screen.findByText("欢迎，厂长")).toBeInTheDocument();
  });
  it("keeps the profile when logout fails", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(logout).mockRejectedValue(new Error("连接失败"));
    render(<AccountPanel />);
    await screen.findByText("欢迎，厂长");
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("连接失败");
    expect(screen.getByText("欢迎，厂长")).toBeInTheDocument();
  });
  it("returns to login when the profile session expires", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(updateProfile).mockRejectedValue(new ApiError(401, "请重新登录"));
    render(<AccountPanel />);
    await screen.findByText("欢迎，厂长");
    fireEvent.click(screen.getByText("玩家档案"));
    fireEvent.change(screen.getByLabelText("昵称"), {
      target: { value: "另一个名字" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存昵称" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请重新登录");
    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
  });
  it("allows a failed session check to recover", async () => {
    vi.mocked(getCurrentUser)
      .mockRejectedValueOnce(new Error("网络不可用"))
      .mockResolvedValueOnce(null);
    render(<AccountPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
    expect(
      await screen.findByText("为你的工厂，留一个位置。"),
    ).toBeInTheDocument();
  });
});
