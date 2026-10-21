import type { LocalFactory } from "./state";
import { robotDestination, robotJourney } from "./robotFreight";
import { cellKey, endpointBuilding, type Point } from "./robotRoutes";

export type RobotRoute = {
  robot_id: string;
  factory_id: string;
  points: Point[];
  status: "idle" | "transit" | "missing" | "congested" | "no_path" | "ready";
  target?: { factory_id: string; building_id: string; x?: number; y?: number };
  arrival?: Point;
};
// Read-only next leg for one selected robot. It uses the action planner and
// current occupancy; it never reserves future cells, stock or energy.
export function previewRobotRoute(
  root: LocalFactory,
  id: string,
): RobotRoute | undefined {
  const r = root.robots?.find((r) => r.id === id);
  if (!r) return;
  const result: RobotRoute = {
    robot_id: id,
    factory_id: r.factory_id,
    points: [],
    status: "idle",
  };
  const target = robotDestination(root, r),
    building = target && endpointBuilding(root, target),
    site = !r.returning && r.construction;
  if (target)
    result.target = {
      ...target,
      ...(building
        ? { x: building.x, y: building.y }
        : site
          ? { x: site.x, y: site.y }
          : {}),
    };
  if (r.transit)
    return {
      ...result,
      status: "transit",
      arrival: {
        factory_id: r.transit.to_factory_id,
        x: r.transit.x,
        y: r.transit.y,
      },
    };
  if (!target) return result;
  if (!building && !site) return { ...result, status: "missing" };
  const occupied = new Set(
    (root.robots ?? [])
      .filter((other) => other.id !== r.id && !other.transit)
      .map(cellKey),
  );
  const plan = robotJourney(root, r, occupied);
  if (!plan)
    return {
      ...result,
      status: robotJourney(root, r) ? "congested" : "no_path",
    };
  return {
    ...result,
    status: "ready",
    points: [{ factory_id: r.factory_id, x: r.x, y: r.y }, ...plan.route],
    arrival: plan.arrival,
  };
}
