import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Catalog, FactoryDetail, ItemTransfer } from "../api/client";
import definitions from "../../../server/internal/catalog/definitions.json";
import ConveyorItemsLayer from "./ConveyorItemsLayer";
import { SimulationAnimationProvider } from "./SimulationAnimation";

let now = 0;
let handle = 0;
let callbacks: Map<number, FrameRequestCallback>;
beforeEach(() => {
  now = 0;
  handle = 0;
  callbacks = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame(at: number) {
  act(() => {
    now = at;
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(at);
  });
}
function factory(tick: number): FactoryDetail {
  const buildings = [
    "miner",
    "item_output",
    "conveyor",
    "item_input",
    "furnace",
  ].map((kind, index) => ({
    id: kind,
    factory_id: "factory",
    building_type: kind,
    x: index - 2,
    y: 0,
    rotation: 0 as const,
    configuration: {},
  }));
  const transfer: ItemTransfer = {
    id: `event-${tick}`,
    payload_id: "ore",
    item: "iron_ore",
    tick,
    source: buildings[tick === 1 ? 0 : 2],
    via: buildings[tick === 1 ? 1 : 3],
    target: buildings[tick === 1 ? 2 : 4],
  };
  return {
    id: "factory",
    owner_id: "owner",
    name: "Factory",
    width: 21,
    height: 21,
    created_at: "now",
    buildings,
    simulation: {
      tick,
      tick_rate: 1,
      warehouse: {},
      transfers: tick ? [transfer] : [],
      buildings: {
        conveyor: {
          input: [],
          output: [],
          progress: 0,
          duration: 0,
          cooldown: 0,
          status: tick === 1 ? "transporting" : "idle",
          belt:
            tick === 1
              ? { id: "ore", item: "iron_ore", progress: 0 }
              : undefined,
        },
        furnace: {
          input: tick === 2 ? [{ item: "iron_ore", count: 1 }] : [],
          output: [],
          progress: 0,
          duration: 4,
          cooldown: 0,
          status: "working",
        },
      },
    },
  };
}
function view(detail: FactoryDetail, tickRate = 1) {
  return (
    <SimulationAnimationProvider
      factoryID={detail.id}
      simulation={detail.simulation}
      tickRate={tickRate}
    >
      <ConveyorItemsLayer
        factory={detail}
        catalog={definitions as unknown as Catalog}
      />
    </SimulationAnimationProvider>
  );
}

it.each([1, 4])(
  "keeps one continuous item and confirmed inventory at %s TPS",
  (tickRate) => {
    const { container, rerender } = render(view(factory(0), tickRate));
    now = 1000 / tickRate;
    rerender(view(factory(1), tickRate));
    const icon = container.querySelector<HTMLSpanElement>(".conveyor-payload")!;
    const sprite = icon.querySelector("img")!;
    expect(sprite).not.toBeNull();
    expect(icon.querySelector(".item-sprite")).toHaveAttribute(
      "data-item-id",
      "iron_ore",
    );
    expect(icon.style.transform).toContain("267px,315px");
    frame(1500 / tickRate);
    expect(icon.style.transform).toContain("297px,315px");
    const halfway = icon.style.transform;
    rerender(view(factory(1), tickRate));
    expect(icon.style.transform).toBe(halfway);
    frame(2000 / tickRate);
    expect(icon.style.transform).toContain("327px,315px");
    const received = factory(2);
    rerender(view(received, tickRate));
    expect(container.querySelectorAll(".conveyor-payload")).toHaveLength(1);
    expect(container.querySelector(".conveyor-payload")).toBe(icon);
    expect(icon.querySelector("img")).toBe(sprite);
    expect(icon.style.transform).toContain("327px,315px");
    frame(2875 / tickRate);
    expect(Number(icon.style.opacity)).toBeCloseTo(0.5);
    frame(3000 / tickRate);
    expect(container.querySelector(".conveyor-payload")).toBeNull();
    // Visual completion never changes the server-confirmed inventory.
    expect(received.simulation?.buildings.furnace.input).toEqual([
      { item: "iron_ore", count: 1 },
    ]);
  },
);
