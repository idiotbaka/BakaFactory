import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { BuildingInstance, Catalog } from "../api/client";
import definitions from "../../../server/internal/catalog/definitions.json";
import MachineNameLayer from "./MachineNameLayer";
import { machineMapName, machineNamePosition } from "./machineMapNames";
import names from "./machineMapNames.json";
import { isLogisticsBuilding } from "./catalogPresentation";
import { GRID_INSET, TILE_SIZE } from "./editorGeometry";

afterEach(cleanup);
const catalog = definitions as unknown as Catalog;
const definition = (id: string) => catalog.buildings.find((b) => b.id === id)!;
function building(type: string, x: number, y = 0): BuildingInstance {
  return {
    id: `${type}-instance`,
    factory_id: "labels",
    building_type: type,
    x,
    y,
    rotation: 0,
    configuration: {},
  };
}
const factory = {
  width: 21,
  height: 21,
  buildings: [
    building("m03", 0),
    building("m14", 1),
    building("shaft", 2),
    building("m17", 3),
    building("hand_belt", 4),
    building("cable", 5),
  ],
};

it("covers every machine with a designed short name and rejects logistics / non-machines", () => {
  const machines = catalog.buildings.filter((b) => b.category === "machine");
  expect(Object.keys(names).sort()).toEqual(machines.map((b) => b.id).sort());
  for (const d of catalog.buildings) {
    const name = machineMapName(d);
    if (d.category !== "machine" || isLogisticsBuilding(d))
      expect(name).toBeUndefined();
    else {
      expect(name).toMatch(/^[\p{Script=Han}]{1,3}$/u);
      if ([...d.name].length <= 3) expect(name).toBe(d.name);
    }
  }
  expect(machineMapName(definition("m03"))).toBe("拆解台");
  expect(machineMapName(definition("m14"))).toBe("蒸汽炉");
  expect(
    machineMapName({ ...definition("m03"), id: "future_unknown_machine" }),
  ).toBeUndefined();
});

it("reveals only eligible names at 120% and positions 12px labels outside the map transform", () => {
  const camera = { x: 45, y: -20, zoom: 1.19 };
  const { container, rerender } = render(
    <MachineNameLayer factory={factory} catalog={catalog} camera={camera} />,
  );
  expect(container.firstChild).toBeNull();
  rerender(
    <MachineNameLayer
      factory={factory}
      catalog={catalog}
      camera={{ ...camera, zoom: 1.1965 }}
    />,
  );
  expect(container.querySelector(".machine-map-name")).not.toBeNull();
  const zoomed = { ...camera, zoom: 1.2 };
  rerender(
    <MachineNameLayer factory={factory} catalog={catalog} camera={zoomed} />,
  );
  expect(
    [...container.querySelectorAll(".machine-map-name")].map(
      (el) => el.textContent,
    ),
  ).toEqual(["拆解台", "蒸汽炉"]);
  const position = machineNamePosition(factory, zoomed, { x: 0, y: 0 });
  const label = container.querySelector<HTMLElement>(
    '[data-label-for="m03-instance"]',
  )!;
  expect(label.style.left).toBe(`${position.left}px`);
  expect(label.style.top).toBe(`${position.top}px`);
  expect(label.style.transform).toBe("");
  const tileTop = zoomed.y + (GRID_INSET + 10 * TILE_SIZE) * zoomed.zoom;
  expect(position.top - 7).toBeGreaterThan(
    tileTop + (TILE_SIZE * zoomed.zoom) / 2,
  );
  expect(position.top + 7).toBeLessThan(
    tileTop + TILE_SIZE * zoomed.zoom - 2 * zoomed.zoom,
  );
  // Panning moves the fixed-size label by exactly the camera delta.
  const panned = machineNamePosition(
    factory,
    { ...zoomed, x: zoomed.x + 37, y: zoomed.y - 19 },
    { x: 0, y: 0 },
  );
  expect(panned.left - position.left).toBeCloseTo(37);
  expect(panned.top - position.top).toBeCloseTo(-19);
});

it("moves the caption to its preview and avoids two labels on an occupied target", () => {
  const props = { factory, catalog, camera: { x: 0, y: 0, zoom: 2 } };
  const { container, rerender } = render(
    <MachineNameLayer
      {...props}
      preview={{
        definition: definition("m03"),
        instanceID: "m03-instance",
        cell: { x: 1, y: 0 },
        invalid: true,
      }}
    />,
  );
  expect(container.querySelector('[data-label-for="m03-instance"]')).toBeNull();
  expect(container.querySelector('[data-label-for="m14-instance"]')).toBeNull();
  expect(container.querySelector(".is-invalid-preview")).toHaveTextContent(
    "拆解台",
  );
  expect(container.querySelectorAll(".machine-map-name")).toHaveLength(1);
  rerender(
    <MachineNameLayer
      {...props}
      preview={{
        definition: definition("shaft"),
        cell: { x: 1, y: 0 },
        invalid: true,
      }}
    />,
  );
  expect(
    container.querySelector('[data-label-for="placement-preview"]'),
  ).toBeNull();
  rerender(
    <MachineNameLayer
      {...props}
      preview={{
        definition: definition("m03"),
        cell: { x: 99, y: 0 },
        invalid: true,
      }}
    />,
  );
  expect(
    container.querySelector('[data-label-for="placement-preview"]'),
  ).toBeNull();
});

it("centres one fixed-size caption in the full 2×2 footprint including previews", () => {
  const camera = { x: 10, y: 20, zoom: 1.2 };
  const large = { ...building("m08", 4, 4), size: 2 as const };
  const floor = { width: 21, height: 21, buildings: [large] };
  const { container, rerender } = render(
    <MachineNameLayer factory={floor} catalog={catalog} camera={camera} />,
  );
  const name = container.querySelector<HTMLElement>(".machine-map-name")!;
  const position = machineNamePosition(floor, camera, large);
  expect(name.style.left).toBe(`${position.left}px`);
  expect(name.style.top).toBe(`${position.top}px`);
  expect(name.style.width).toBe(`${60 * 1.2 - 4}px`);
  rerender(
    <MachineNameLayer
      factory={floor}
      catalog={catalog}
      camera={camera}
      preview={{
        definition: definition("m08"),
        cell: { x: 4, y: 4 },
        size: 2,
        instanceID: large.id,
        invalid: false,
      }}
    />,
  );
  expect(container.querySelectorAll(".machine-map-name")).toHaveLength(1);
  expect(
    container.querySelector<HTMLElement>(".machine-map-name")!.style.left,
  ).toBe(name.style.left);
});
