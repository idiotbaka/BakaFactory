import { fireEvent, screen, within } from "@testing-library/react";
import { vi } from "vitest";

// jsdom has neither layout nor scrollIntoView. Supply only the browser
// geometry needed to open the real control; options still use real clicks.
export function openGameSelect(trigger: HTMLElement) {
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    x: 24,
    y: 24,
    left: 24,
    top: 24,
    right: 264,
    bottom: 60,
    width: 240,
    height: 36,
    toJSON: () => ({}),
  });
  if (!Element.prototype.scrollIntoView)
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  fireEvent.click(trigger);
  return within(screen.getByRole("listbox"));
}
