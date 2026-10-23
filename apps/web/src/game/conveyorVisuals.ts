import type { BuildingInstance, BuildingPlacement } from "../api/client";
import { direction, isBelt } from "./local/catalog";

type ConveyorGeometry = {
  x: number;
  y: number;
  rotation: BuildingPlacement["rotation"];
  buildings: ReadonlyMap<string, BuildingInstance>;
  instanceID?: string;
};
type Point = { x: number; y: number };
type Opening = { start: Point; end: Point; edge: string };

// Local SVG coordinates turn with the belt. World Y points up, SVG Y down.
export function conveyorPaths({
  x,
  y,
  rotation,
  buildings,
  instanceID,
}: ConveyorGeometry): { body: string; rails: string; ribs: string } {
  const incoming: number[] = [];
  let front = false;
  for (let local = 0; local < 4; local++) {
    const world = (rotation + local * 90) % 360,
      [dx, dy] = direction(world),
      neighbor = buildings.get(`${x + dx},${y + dy}`);
    if (
      !neighbor ||
      neighbor.id === instanceID ||
      !isBelt(neighbor.building_type)
    )
      continue;
    if (local === 0) front = true;
    if (neighbor.rotation === (world + 180) % 360) incoming.push(local);
  }
  // Only layout arrows determine appearance. Power, filters, speed and the
  // actual transport reservations must not change these openings.
  if (!incoming.includes(1) && !incoming.includes(3)) {
    const back = incoming.includes(2),
      left = back ? 0 : 5,
      right = front ? 30 : 25;
    // Keep the original straight belt skin, including its rounded free ends.
    return {
      body: `M${left} 4 H${right} ${front ? "V26" : "Q28 4 28 7 V23 Q28 26 25 26"} H${left} ${back ? "Z" : "Q2 26 2 23 V7 Q2 4 5 4 Z"}`,
      rails: `M${left} 4 H${right} ${front ? "M30 26" : "Q28 4 28 7 V23 Q28 26 25 26"} H${left} ${back ? "" : "Q2 26 2 23 V7 Q2 4 5 4"}`,
      ribs: "M8 7v16M22 7v16",
    };
  }
  const ports = [...new Set([0, ...incoming])].sort((a, b) => a - b),
    openings: Opening[] = [
      {
        start: { x: front ? 30 : 25, y: 4 },
        end: { x: front ? 30 : 25, y: 26 },
        edge: front ? "V26" : "Q28 4 28 7V23Q28 26 25 26",
      },
      { start: { x: 26, y: 30 }, end: { x: 4, y: 30 }, edge: "H4" },
      { start: { x: 0, y: 26 }, end: { x: 0, y: 4 }, edge: "V4" },
      { start: { x: 4, y: 0 }, end: { x: 26, y: 0 }, edge: "H26" },
    ];
  const links = ports.map((port, index) => {
    const next = ports[(index + 1) % ports.length],
      a = openings[port].end,
      b = openings[next].start;
    // Keep bends mostly square, rounding only the corner by up to 3 units.
    // Opposite ports remain straight; no large quarter-circle elbows.
    if ((next - port + 4) % 4 === 2) return `L${b.x} ${b.y}`;
    const corner = port % 2 ? { x: a.x, y: b.y } : { x: b.x, y: a.y },
      before = Math.abs(a.x - corner.x) + Math.abs(a.y - corner.y),
      after = Math.abs(b.x - corner.x) + Math.abs(b.y - corner.y),
      radius = Math.min(3, before, after),
      near = (point: Point, length: number) => ({
        x: corner.x + ((point.x - corner.x) * radius) / length,
        y: corner.y + ((point.y - corner.y) * radius) / length,
      }),
      from = near(a, before),
      to = near(b, after);
    return `L${from.x} ${from.y}Q${corner.x} ${corner.y} ${to.x} ${to.y}L${b.x} ${b.y}`;
  });
  const first = openings[ports[0]].start,
    body =
      `M${first.x} ${first.y}` +
      ports.map((port, i) => openings[port].edge + links[i]).join("") +
      "Z",
    rails = ports
      .map((port, i) => {
        const { start, end, edge } = openings[port];
        // Never draw a rail across a connected opening or inside a junction.
        const cap = port === 0 && !front ? `M${start.x} ${start.y}${edge}` : "";
        return cap + `M${end.x} ${end.y}${links[i]}`;
      })
      .join(""),
    ribs = ["M22 7V23", "M7 22H23", "M8 7V23", "M7 8H23"];
  return { body, rails, ribs: ports.map((port) => ribs[port]).join("") };
}
