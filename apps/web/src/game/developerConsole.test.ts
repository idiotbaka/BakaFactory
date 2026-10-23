import { afterEach, describe, expect, it, vi } from "vitest";
import { installDeveloperConsole } from "./developerConsole";

afterEach(() => delete window.bakaFactory);

describe("account-scoped developer console entry", () => {
  it("queries without writing, toggles through persistence and leaves the developer view only after closing succeeds", async () => {
    const runtime = {
        developerToolsVisible: false,
        setDeveloperToolsVisible: vi.fn(async (enabled: boolean) => {
          runtime.developerToolsVisible = enabled;
          return enabled;
        }),
      },
      hidden = vi.fn(),
      cleanup = installDeveloperConsole(runtime, hidden);
    expect(window.bakaFactory!.devTools()).toBe(false);
    expect(runtime.setDeveloperToolsVisible).not.toHaveBeenCalled();
    await expect(window.bakaFactory!.devTools(true)).resolves.toBe(true);
    expect(hidden).not.toHaveBeenCalled();
    expect(window.bakaFactory!.devTools()).toBe(true);
    await expect(window.bakaFactory!.devTools(false)).resolves.toBe(false);
    expect(hidden).toHaveBeenCalledOnce();
    cleanup();
    expect(window.bakaFactory).toBeUndefined();
  });
  it("does not close the page on a failed write and invalidates stale account handles without removing the new entry", async () => {
    const runtime = {
        developerToolsVisible: true,
        setDeveloperToolsVisible: vi
          .fn()
          .mockRejectedValue(new Error("保存失败")),
      },
      hidden = vi.fn();
    const cleanupOld = installDeveloperConsole(runtime, hidden),
      stale = window.bakaFactory!;
    await expect(stale.devTools(false)).rejects.toThrow("保存失败");
    expect(hidden).not.toHaveBeenCalled();
    const cleanupNew = installDeveloperConsole(runtime, hidden),
      current = window.bakaFactory;
    cleanupOld();
    expect(window.bakaFactory).toBe(current);
    expect(() => stale.devTools(true)).toThrow("失效");
    cleanupNew();
    expect(window.bakaFactory).toBeUndefined();
  });
});
