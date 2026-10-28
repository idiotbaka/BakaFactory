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
    building_type: ["m02", "feeder", "mechanical_belt", "feeder", "m05"][index],
    x: index - 2,
    y: 0,
    rotation: 0 as const,
    configuration: {},
  }));
  const transfer: ItemTransfer = {
    id: `event-${tick}`,
    payload_id: "ore",
    item: "i0002",
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
      tick_rate: 2,
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
            tick === 1 ? { id: "ore", item: "i0002", progress: 0 } : undefined,
        },
        furnace: {
          input: tick === 2 ? [{ item: "i0002", count: 1 }] : [],
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
function view(detail: FactoryDetail, tickRate = 2, zoom = 1) {
  return (
    <SimulationAnimationProvider
      factoryID={detail.id}
      simulation={detail.simulation}
      tickRate={tickRate}
    >
      <ConveyorItemsLayer
        factory={detail}
        catalog={definitions as unknown as Catalog}
        zoom={zoom}
      />
    </SimulationAnimationProvider>
  );
}

it.each([2, 4])(
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
      "i0002",
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
      { item: "i0002", count: 1 },
    ]);
  },
);

it("shows confirmed counts at 120%, reuses the moving node and keeps screen text size fixed", () => {
  const detail = factory(1);
  detail.buildings[2].building_type = "flexible_belt";
  const payload = detail.simulation!.buildings.conveyor.belt!;
  payload.count = 20;
  const { container, rerender } = render(view(detail, 2, 1.19));
  const icon = container.querySelector<HTMLElement>(".conveyor-payload")!;
  expect(icon.querySelector(".conveyor-payload-count")).toBeNull();
  rerender(view(detail, 2, 1.2));
  const count = icon.querySelector(".conveyor-payload-count")!;
  expect(count.textContent).toBe("20");
  const before = icon.style.transform;
  frame(250);
  expect(icon.style.transform).not.toBe(before);
  expect(icon.querySelector(".conveyor-payload-count")).toBe(count);
  expect(container.querySelector(".conveyor-payload")).toBe(icon);
  const position = icon.style.transform;
  rerender(view(detail, 2, 2));
  expect(icon.style.transform).toBe(position);
  expect(
    container
      .querySelector<HTMLElement>(".conveyor-items-layer")!
      .style.getPropertyValue("--payload-label-scale"),
  ).toBe("0.5");
  const changed = structuredClone(detail);
  changed.simulation!.buildings.conveyor.belt!.count = 100;
  rerender(view(changed, 2, 2));
  expect(count.textContent).toBe("100");
  expect(icon.style.transform).toBe(position);
  rerender(view(changed, 2, 1.19));
  expect(icon.querySelector(".conveyor-payload-count")).toBeNull();
  expect(changed.simulation!.buildings.conveyor.belt!.count).toBe(100);
});

it("shows the implicit single item and removes the number before an absorption animation", () => {
  const { container, rerender } = render(view(factory(1), 2, 1.2));
  expect(container.querySelector(".conveyor-payload-count")?.textContent).toBe(
    "1",
  );
  now = 500;
  rerender(view(factory(2), 2, 1.2));
  expect(container.querySelector(".conveyor-payload-count")).toBeNull();
  expect(container.querySelector(".conveyor-payload")).not.toBeNull();
});
