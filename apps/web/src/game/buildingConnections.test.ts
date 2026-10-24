import { describe, expect, it } from "vitest";
import type {
  BuildingDefinition,
  BuildingInstance,
  BuildingPlacement,
  Catalog,
} from "../api/client";
import definitions from "../../../server/internal/catalog/definitions.json";
import {
  buildingConnections,
  type ConnectionContext,
} from "./buildingConnections";
import { PORT_E, PORT_N, PORT_S, PORT_W } from "./routeGeometry";

const catalog = definitions as unknown as Catalog;
const definition = (id: string) =>
  catalog.buildings.find((b) => b.id === id)! as BuildingDefinition;
const offsets = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];
function context(
  rotation: BuildingPlacement["rotation"],
  neighbors: BuildingInstance[] = [],
): ConnectionContext {
  return {
    x: 4,
    y: -3,
    rotation,
    buildings: new Map(neighbors.map((b) => [`${b.x},${b.y}`, b])),
  };
}
function neighbor(
  rotation: number,
  local: number,
  changes: Partial<BuildingInstance> = {},
): BuildingInstance {
  const world = (rotation + local * 90) % 360,
    [dx, dy] = offsets[world / 90];
  return {
    id: `neighbor-${local}`,
    factory_id: "visual",
    building_type: "hand_belt",
    x: 4 + dx,
    y: -3 + dy,
    rotation: ((world + 180) % 360) as BuildingPlacement["rotation"],
    configuration: {},
    ...changes,
  };
}

describe("production building connection selection", () => {
  it.each([0, 90, 180, 270] as const)(
    "keeps directed belt openings and square rotation %s",
    (rotation) => {
      const incoming = neighbor(rotation, 1),
        before = structuredClone(incoming);
      expect(
        buildingConnections(
          "belt",
          definition("hand_belt"),
          context(rotation, [incoming]),
        ),
      ).toEqual({ ports: PORT_E | PORT_S, open: PORT_S, rotation });
      expect(incoming).toEqual(before);
      expect(
        buildingConnections(
          "belt",
          definition("hand_belt"),
          context(rotation, [neighbor(rotation, 1, { rotation })]),
        ),
      ).toEqual({ ports: PORT_E | PORT_W, open: 0, rotation });
    },
  );
  it("shares preview exclusions, mixed tiers and layout-only filtering", () => {
    const upstream = neighbor(0, 3, {
      building_type: "electric_belt",
      configuration: { enabled: false, filter: "i0014" },
    });
    const c = context(0, [upstream]);
    expect(buildingConnections("belt", definition("hand_belt"), c)).toEqual({
      ports: PORT_E | PORT_N,
      open: PORT_N,
      rotation: 0,
    });
    expect(
      buildingConnections("belt", definition("hand_belt"), {
        ...c,
        instanceID: upstream.id,
      }),
    ).toEqual({ ports: PORT_E | PORT_W, open: 0, rotation: 0 });
  });
  it("keeps the pipe rear fallback when only an opposing output faces it", () => {
    const opposing = neighbor(0, 0, { building_type: "pipe" });
    expect(
      buildingConnections("pipe", definition("pipe"), context(0, [opposing])),
    ).toEqual({ ports: PORT_E | PORT_W, open: PORT_E | PORT_W, rotation: 0 });
    const tee = [
      neighbor(0, 1, { building_type: "return_pipe" }),
      neighbor(0, 3, { building_type: "tank" }),
    ];
    expect(
      buildingConnections("pipe", definition("pipe"), context(0, tee)),
    ).toEqual({
      ports: PORT_E | PORT_S | PORT_N,
      open: PORT_E | PORT_S | PORT_N,
      rotation: 0,
    });
  });
  it("does not connect conductor tiles through machines or another energy kind", () => {
    const nodes = [
      neighbor(0, 0, { building_type: "m09" }),
      neighbor(0, 1, { building_type: "shaft" }),
      neighbor(0, 2, { building_type: "cable" }),
    ];
    expect(
      buildingConnections("shaft", definition("shaft"), context(0, nodes)),
    ).toEqual({ ports: PORT_S, open: PORT_S, rotation: 0 });
  });
});
