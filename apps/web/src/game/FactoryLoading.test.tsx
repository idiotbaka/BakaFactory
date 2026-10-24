import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryLoading from "./FactoryLoading";
afterEach(cleanup);

it("shows measured progress and keeps the final unit for save initialization", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <FactoryLoading
      resources={{ phase: "loading", completed: 2, total: 4, failed: 0 }}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "5");
  expect(screen.getByText("40%")).toBeInTheDocument();
  rerender(
    <FactoryLoading
      resources={{ phase: "ready", completed: 4, total: 4, failed: 0 }}
      onRetry={retry}
    />,
  );
  expect(screen.getByText("80%")).toBeInTheDocument();
  expect(screen.getByText("正在读取存档并校验登录")).toBeInTheDocument();
  rerender(
    <FactoryLoading
      resources={{ phase: "failed", completed: 3, total: 4, failed: 1 }}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("1 项资源未能加载");
  fireEvent.click(screen.getByRole("button", { name: "重新加载资源" }));
  expect(retry).toHaveBeenCalledOnce();
});
