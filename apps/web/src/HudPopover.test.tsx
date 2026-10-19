import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import HudPopover from "./HudPopover";

it("dismisses HUD overlays from outside and gives Escape priority over map shortcuts", () => {
  const { container } = render(
    <>
      <HudPopover className="test-popover" label="玩家档案">
        <input aria-label="昵称" />
      </HudPopover>
      <button>地图外部</button>
    </>,
  );
  const summary = screen.getByText("玩家档案");
  const panel = container.querySelector("details")!;
  fireEvent.click(summary);
  expect(panel.open).toBe(true);
  fireEvent.pointerDown(screen.getByLabelText("昵称"));
  expect(panel.open).toBe(true);
  const mapShortcut = vi.fn();
  window.addEventListener("keydown", mapShortcut);
  try {
    fireEvent.keyDown(screen.getByLabelText("昵称"), { key: "Escape" });
    expect(panel.open).toBe(false);
    expect(summary).toHaveFocus();
    expect(mapShortcut).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", mapShortcut);
  }
  fireEvent.click(summary);
  fireEvent.pointerDown(screen.getByRole("button", { name: "地图外部" }));
  expect(panel.open).toBe(false);
});
