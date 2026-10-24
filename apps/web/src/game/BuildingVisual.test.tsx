import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Catalog, MachineState } from "../api/client";
import definitions from "../../../server/internal/catalog/definitions.json";
import BuildingVisual from "./BuildingVisual";
import DefinitionIcon from "./DefinitionIcon";
import { buildingStageColor } from "./buildingArtwork";

afterEach(cleanup);
const catalog = definitions as unknown as Catalog;
const definition = (id: string) => catalog.buildings.find((b) => b.id === id)!;
const buildings = new Map();

it("keeps the facade upright and rotates only a code arrow on the map", () => {
  const base = { definition: definition("m11"), x: 0, y: 0, buildings };
  const { container, rerender } = render(
    <BuildingVisual {...base} rotation={0} />,
  );
  const image = container.querySelector("img")!;
  expect(container.querySelector(".building-sprite-map")).not.toBeNull();
  rerender(<BuildingVisual {...base} rotation={90} />);
  expect(container.querySelector("img")).toBe(image);
  expect(image.style.transform).toBe("");
  expect(
    container.querySelector<SVGElement>(".building-map-arrow")?.style.transform,
  ).toBe("rotate(90deg)");
  expect(buildingStageColor("m11")).toBe("#a5d4b2");
});

it("uses GUI floor lighting and code route thumbnails without raster route files", () => {
  const { container, rerender } = render(
    <DefinitionIcon definition={definition("chest")} />,
  );
  expect(container.querySelector(".building-sprite-gui img")).not.toBeNull();
  expect(container.querySelector(".building-map-arrow")).toBeNull();
  rerender(<DefinitionIcon definition={definition("mechanical_belt")} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".route-gui")).toHaveAttribute(
    "data-route-kind",
    "belt",
  );
  expect(container.querySelector(".building-route-arrow")).toBeNull();
  // Building stage is independent of the installed item's P1 stage.
  expect(buildingStageColor("shaft")).toBe("#a5d4b2");
  expect(buildingStageColor("bus")).toBe(definition("bus").color);
});

it("changes only the pipe channel color for confirmed nonzero volume", () => {
  const machine: MachineState = {
    input: [],
    output: [],
    progress: 0,
    duration: 0,
    cooldown: 0,
    status: "idle",
    fluid: { item: "i0088", count: 0 },
  };
  const base = {
    definition: definition("pipe"),
    x: 0,
    y: 0,
    rotation: 0 as const,
    buildings,
  };
  const { container, rerender } = render(
    <BuildingVisual {...base} machine={machine} />,
  );
  const route = container.querySelector<SVGElement>(".route-pipe")!;
  const paths = [...route.querySelectorAll("path")].map((p) =>
    p.getAttribute("d"),
  );
  expect(route.style.getPropertyValue("--route-channel")).toBe("#287d96");
  const filled = { ...machine, fluid: { item: "i0088", count: 1 } };
  rerender(<BuildingVisual {...base} machine={filled} />);
  expect(container.querySelector(".route-pipe")).toBe(route);
  expect(route.style.getPropertyValue("--route-channel")).toBe("#a6f8f7");
  expect(
    [...route.querySelectorAll("path")].map((p) => p.getAttribute("d")),
  ).toEqual(paths);
  expect(machine.fluid?.count).toBe(0);
  expect(filled.fluid.count).toBe(1);
});
