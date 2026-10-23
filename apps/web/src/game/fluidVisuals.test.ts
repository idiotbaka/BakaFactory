import { describe, expect, it } from "vitest";
import type { BuildingInstance, BuildingPlacement } from "../api/client";
import { fluidPipePath } from "./fluidVisuals";

const turns: BuildingPlacement["rotation"][] = [0, 90, 180, 270];
const offsets = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
] as const;
function neighbor(
  rotation: BuildingPlacement["rotation"],
  inlet: number,
  changes: Partial<BuildingInstance> = {},
): BuildingInstance {
  const side = (rotation + inlet * 90) % 360,
    [dx, dy] = offsets[side / 90];
  return {
    id: `upstream-${inlet}`,
    factory_id: "visual-only",
    building_type: "pipe",
    x: 4 + dx,
    y: -3 + dy,
    rotation: ((side + 180) % 360) as BuildingPlacement["rotation"],
    configuration: {},
    ...changes,
  };
}
function geometry(
  rotation: BuildingPlacement["rotation"],
  nodes: BuildingInstance[],
  instanceID?: string,
) {
  return fluidPipePath({
    x: 4,
    y: -3,
    rotation,
    buildings: new Map(nodes.map((node) => [`${node.x},${node.y}`, node])),
    instanceID,
  });
}

describe("directional fluid pipe appearance", () => {
  it.each(turns)(
    "draws both elbows in local SVG coordinates at rotation %s with world Y pointing up",
    (rotation) => {
      expect(geometry(rotation, [neighbor(rotation, 1)])).toBe(
        "M48 24L32 24Q24 24 24 32L24 48",
      );
      expect(geometry(rotation, [neighbor(rotation, 3)])).toBe(
        "M48 24L32 24Q24 24 24 16L24 0",
      );
      expect(geometry(rotation, [neighbor(rotation, 2)])).toBe("M0 24H48");
    },
  );
  it("does not connect a merely adjacent pipe or a solid / hydraulic power line", () => {
    expect(geometry(0, [neighbor(0, 1, { rotation: 0 })])).toBe("M0 24H48");
    for (const building_type of ["hand_belt", "hydraulic_line", "m02"])
      expect(geometry(0, [neighbor(0, 1, { building_type })])).toBe("M0 24H48");
  });
  it("joins multiple incoming arrows without retaining an unused rear arm", () => {
    expect(geometry(0, [neighbor(0, 1), neighbor(0, 3)])).toBe(
      "M24 24L48 24M24 24L24 48M24 24L24 0",
    );
    expect(geometry(0, [neighbor(0, 1), neighbor(0, 2), neighbor(0, 3)])).toBe(
      "M24 24L48 24M24 24L24 48M24 24L0 24M24 24L24 0",
    );
  });
  it("uses the same geometry in a placement preview and ignores the moved instance's old cell", () => {
    const upstream = neighbor(180, 1);
    expect(geometry(180, [upstream])).toContain("Q24 24");
    expect(geometry(180, [upstream], upstream.id)).toBe("M0 24H48");
    expect(geometry(180, [])).toBe("M0 24H48");
  });
  it("depends only on directed layout, not fluid compatibility, enabled state or stock", () => {
    const upstream = neighbor(0, 3, {
        building_type: "return_pipe",
        configuration: { enabled: false, filter: "i0014", fluid_rate: 0 },
      }),
      before = structuredClone(upstream);
    expect(geometry(0, [upstream])).toContain("Q24 24");
    expect(upstream).toEqual(before);
  });
});
