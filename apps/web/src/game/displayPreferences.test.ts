import { afterEach, expect, it, vi } from "vitest";
import { readPowerSaving, savePowerSaving } from "./displayPreferences";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem("bakafactory:power-saving");
});
it("restores an explicit graphics preference across mounts", () => {
  savePowerSaving(true);
  expect(readPowerSaving()).toBe(true);
  savePowerSaving(false);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(readPowerSaving()).toBe(false);
});
it("defaults to reduced-motion preference and tolerates blocked storage", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readPowerSaving()).toBe(true);
  expect(() => savePowerSaving(false)).not.toThrow();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  expect(readPowerSaving()).toBe(false);
});
