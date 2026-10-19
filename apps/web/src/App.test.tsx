import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getHealth } from "./api/client";

vi.mock("./api/client", () => ({ getHealth: vi.fn() }));
vi.mock("./AccountPanel", () => ({ default: () => null }));
const mockHealth = vi.mocked(getHealth);
const health = {
  status: "ok",
  database: "ok",
  version: "0.1.0",
  environment: "test",
} as const;
afterEach(() => {
  mockHealth.mockReset();
  vi.useRealTimers();
});
describe("server status page", () => {
  it("shows live server version and database readiness", async () => {
    mockHealth.mockResolvedValue(health);
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "BAKA FACTORY · 霓虹工厂",
    );
    expect(await screen.findByText("Server: Online")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    expect(screen.getByText("SQLite · Ready")).toBeInTheDocument();
  });
  it("allows a failed connection to recover through retry", async () => {
    mockHealth
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(health);
    render(<App />);
    expect(await screen.findByText("Server: Offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新检查服务器状态" }));
    expect(await screen.findByText("Server: Online")).toBeInTheDocument();
  });
  it("disables repeated checks while a request is pending and cancels on unmount", async () => {
    mockHealth.mockImplementation(() => new Promise(() => {}));
    const view = render(<App />);
    expect(screen.getByRole("button")).toBeDisabled();
    await waitFor(() => expect(mockHealth).toHaveBeenCalledOnce());
    const signal = mockHealth.mock.calls[0][0];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("shows Offline when a request times out", async () => {
    vi.useFakeTimers();
    mockHealth.mockImplementation(
      (signal) =>
        new Promise((_, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText("Server: Offline")).toBeInTheDocument();
  });
});
