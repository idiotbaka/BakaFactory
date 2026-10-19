import { memo, type CSSProperties } from "react";
import { entityColor } from "./entityTheme";
import type {
  BuildingDefinition,
  BuildingInstance,
  BuildingPlacement,
} from "../api/client";

// Screen-clockwise rotation: east, south, west, north. Factory Y points up.
const directions = [
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
] as const;

function ConveyorVisual({
  definition,
  x,
  y,
  rotation,
  buildings,
  instanceID,
}: {
  definition: BuildingDefinition;
  x: number;
  y: number;
  rotation: BuildingPlacement["rotation"];
  buildings: ReadonlyMap<string, BuildingInstance>;
  instanceID?: string;
}) {
  const direction = directions[rotation / 90];
  function connects(offset: number) {
    const neighbor = buildings.get(
      `${x + direction.x * offset},${y + direction.y * offset}`,
    );
    return (
      neighbor?.building_type === "conveyor" &&
      neighbor.rotation === rotation &&
      neighbor.id !== instanceID
    );
  }
  const back = connects(-1),
    front = connects(1);
  // Connected ends reach the exact cell edge; exposed ends get rounded caps.
  // Only the rails are stroked at a connection, so no cross-cell seam remains.
  const left = back ? 0 : 5,
    right = front ? 30 : 25;
  const body = `M${left} 4 H${right} ${front ? "V26" : "Q28 4 28 7 V23 Q28 26 25 26"} H${left} ${back ? "Z" : "Q2 26 2 23 V7 Q2 4 5 4 Z"}`;
  const rails = `M${left} 4 H${right} ${front ? "M30 26" : "Q28 4 28 7 V23 Q28 26 25 26"} H${left} ${back ? "" : "Q2 26 2 23 V7 Q2 4 5 4"}`;
  return (
    <span
      className="conveyor-visual"
      style={{ "--entity-color": entityColor(definition) } as CSSProperties}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 30 30"
        fill="none"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <path className="conveyor-bed" d={body} />
        <path className="conveyor-ribs" d="M8 7v16M22 7v16" />
        <path className="conveyor-rails" d={rails} />
        <path className="conveyor-arrow" d="m12 10 5 5-5 5" />
      </svg>
    </span>
  );
}
export default memo(ConveyorVisual);
