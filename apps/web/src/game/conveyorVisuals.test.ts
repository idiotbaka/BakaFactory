import { describe, expect, it } from "vitest";
import type { BuildingInstance, BuildingPlacement } from "../api/client";
import { conveyorPaths } from "./conveyorVisuals";

const turns: BuildingPlacement["rotation"][] = [0, 90, 180, 270];
const offsets = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
] as const;
function neighbor(
  rotation: BuildingPlacement["rotation"],
  side: number,
  changes: Partial<BuildingInstance> = {},
): BuildingInstance {
  const world = (rotation + side * 90) % 360,
    [dx, dy] = offsets[world / 90];
  return {
    id: `neighbor-${side}`,
    factory_id: "visual-only",
    building_type: "hand_belt",
    x: -4 + dx,
    y: 3 + dy,
    rotation: ((world + 180) % 360) as BuildingPlacement["rotation"],
    configuration: {},
    ...changes,
  };
}
function geometry(
  rotation: BuildingPlacement["rotation"],
  nodes: BuildingInstance[],
  instanceID?: string,
) {
  return conveyorPaths({
    x: -4,
    y: 3,
    rotation,
    buildings: new Map(nodes.map((node) => [`${node.x},${node.y}`, node])),
    instanceID,
  });
}

describe("directed conveyor skin connections", () => {
  it("preserves the original isolated and connected straight belt skin", () => {
    expect(geometry(0, [])).toEqual({
      body: "M5 4 H25 Q28 4 28 7 V23 Q28 26 25 26 H5 Q2 26 2 23 V7 Q2 4 5 4 Z",
      rails: "M5 4 H25 Q28 4 28 7 V23 Q28 26 25 26 H5 Q2 26 2 23 V7 Q2 4 5 4",
      ribs: "M8 7v16M22 7v16",
    });
    const { body, rails } = geometry(0, [
      neighbor(0, 2),
      neighbor(0, 0, { rotation: 0 }),
    ]);
    expect(body).toBe("M0 4 H30 V26 H0 Z");
    expect(rails).toBe("M0 4 H30 M30 26 H0 ");
  });
  it.each(turns)(
    "connects either side into a downstream turning belt at rotation %s, with only slight corner rounding",
    (rotation) => {
      const front = neighbor(rotation, 0, {
        rotation: ((rotation + 90) % 360) as BuildingPlacement["rotation"],
      });
      expect(geometry(rotation, [front, neighbor(rotation, 1)]).body).toBe(
        "M30 4V26L29 26Q26 26 26 29L26 30H4L4 7Q4 4 7 4L30 4Z",
      );
      const elbow = geometry(rotation, [front, neighbor(rotation, 3)]);
      expect(elbow.body).toBe(
        "M30 4V26L7 26Q4 26 4 23L4 0H26L26 1Q26 4 29 4L30 4Z",
      );
      expect(elbow.rails).toBe(
        "M30 26L7 26Q4 26 4 23L4 0M26 0L26 1Q26 4 29 4L30 4",
      );
      expect(elbow.ribs).toBe("M22 7V23M7 8H23");
    },
  );
  it("opens three or four arms without drawing rails through the junction", () => {
    const front = neighbor(0, 0, { rotation: 0 }),
      tee = geometry(0, [front, neighbor(0, 1), neighbor(0, 3)]),
      cross = geometry(0, [
        front,
        neighbor(0, 1),
        neighbor(0, 2),
        neighbor(0, 3),
      ]);
    expect(tee.rails).toContain("M4 30L4 0");
    expect(tee.ribs).toBe("M22 7V23M7 22H23M7 8H23");
    expect(cross.rails).not.toContain("M4 30L4 0");
    expect(cross.ribs).toBe("M22 7V23M7 22H23M8 7V23M7 8H23");
    for (const rails of [tee.rails, cross.rails]) {
      expect(rails).not.toContain("M30 4V26");
      expect(rails).not.toContain("M26 30H4");
      expect(rails).not.toContain("M0 26V4");
      expect(rails).not.toContain("M4 0H26");
    }
  });
  it("ignores side neighbors that point elsewhere, pipes and feeder ports", () => {
    const isolated = geometry(0, []);
    expect(geometry(0, [neighbor(0, 1, { rotation: 0 })])).toEqual(isolated);
    for (const building_type of ["pipe", "feeder", "bus"])
      expect(geometry(0, [neighbor(0, 3, { building_type })])).toEqual(
        isolated,
      );
  });
  it("supports mixed belt tiers and preserves the rounded free output end", () => {
    const elbow = geometry(0, [
      neighbor(0, 1, { building_type: "electric_belt" }),
    ]);
    expect(elbow.body).toContain("M25 4Q28 4 28 7V23Q28 26 25 26");
    expect(elbow.rails).toContain("M25 4Q28 4 28 7V23Q28 26 25 26");
    expect(elbow.ribs).toBe("M22 7V23M7 22H23");
  });
  it("ignores the moved instance's old cell in a preview without changing layout", () => {
    const upstream = neighbor(180, 1),
      before = structuredClone(upstream);
    expect(geometry(180, [upstream])).not.toEqual(geometry(180, []));
    expect(geometry(180, [upstream], upstream.id)).toEqual(geometry(180, []));
    expect(upstream).toEqual(before);
  });
  it("keeps connections when paused or filtered, including opposing outputs, without inferring a successful transfer", () => {
    const upstream = neighbor(0, 3),
      front = neighbor(0, 0);
    expect(
      geometry(0, [
        { ...upstream, configuration: { enabled: false, filter: "i0014" } },
        front,
      ]),
    ).toEqual(geometry(0, [upstream, front]));
  });
});
