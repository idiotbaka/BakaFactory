import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetProgress } from "../assetPreloader";
import { useLocalGame } from "./useLocalGame";

const control = vi.hoisted(() => ({
  progress: {
    phase: "idle",
    completed: 0,
    total: 1,
    failed: 0,
  } as AssetProgress,
  listeners: new Set<() => void>(),
  load: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../gameAssets", () => ({
  gameAssetPreloader: {
    subscribe: (listener: () => void) => {
      control.listeners.add(listener);
      return () => control.listeners.delete(listener);
    },
    getSnapshot: () => control.progress,
    start: control.load,
  },
}));
vi.mock("./runtime", () => ({
  GameRuntime: class {
    start = control.start;
    close = control.close;
  },
}));
const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
const expired = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  control.progress = { phase: "idle", completed: 0, total: 1, failed: 0 };
});
afterEach(cleanup);
function publish(progress: AssetProgress) {
  control.progress = progress;
  control.listeners.forEach((listener) => listener());
}

it("starts no runtime before resource completion, including a failed attempt", async () => {
  control.load.mockImplementation(async () => {
    publish({ phase: "failed", completed: 0, total: 1, failed: 1 });
  });
  const { result } = renderHook(() => useLocalGame(user, expired));
  await act(async () => {});
  expect(control.start).not.toHaveBeenCalled();
  expect(result.current.resources.phase).toBe("failed");
  control.load.mockImplementation(async () => {
    publish({ phase: "ready", completed: 1, total: 1, failed: 0 });
  });
  await act(async () => {
    result.current.retry();
  });
  expect(control.start).toHaveBeenCalledOnce();
});

it("does not enter a factory if the player leaves while resources are loading", async () => {
  let finish!: () => void;
  control.load.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = renderHook(() => useLocalGame(user, expired));
  await act(async () => {});
  unmount();
  await act(async () => {
    publish({ phase: "ready", completed: 1, total: 1, failed: 0 });
    finish();
  });
  expect(control.start).not.toHaveBeenCalled();
  expect(control.close).not.toHaveBeenCalled();
});
