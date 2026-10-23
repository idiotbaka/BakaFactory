import { memo, type CSSProperties } from "react";
import { entityColor } from "./entityTheme";
import { conveyorPaths } from "./conveyorVisuals";
import type {
  BuildingDefinition,
  BuildingInstance,
  BuildingPlacement,
} from "../api/client";

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
  const { body, rails, ribs } = conveyorPaths({
    x,
    y,
    rotation,
    buildings,
    instanceID,
  });
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
        <path className="conveyor-ribs" d={ribs} />
        <path className="conveyor-rails" d={rails} />
        <path className="conveyor-arrow" d="m12 10 5 5-5 5" />
      </svg>
    </span>
  );
}
export default memo(ConveyorVisual);
