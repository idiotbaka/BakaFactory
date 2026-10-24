import { memo, type CSSProperties } from "react";
import type { BuildingDefinition, MachineState } from "../api/client";
import { buildingArtwork, buildingStageColor } from "./buildingArtwork";
import {
  buildingConnections,
  type ConnectionContext,
} from "./buildingConnections";
import BuildingSprite from "./BuildingSprite";
import DefinitionIcon from "./DefinitionIcon";
import RouteVisual from "./RouteVisual";

export type BuildingVisualProps = ConnectionContext & {
  definition: BuildingDefinition;
  machine?: MachineState;
};
function BuildingVisual({
  definition,
  machine,
  ...context
}: BuildingVisualProps) {
  const art = buildingArtwork(definition.id);
  const fluid = (definition.fluid_capacity ?? 0) > 0;
  const level = fluid
    ? Math.max(
        0,
        Math.min(
          1,
          (machine?.fluid?.count ?? 0) /
            Math.max(1, definition.fluid_capacity ?? 1),
        ),
      )
    : 0;
  const kind = art?.renderer !== "image" ? art?.renderer : undefined;
  const connection = kind
    ? buildingConnections(kind, definition, context)
    : fluid
      ? buildingConnections("pipe", definition, context)
      : undefined;
  return (
    <span
      className={`building-map-visual ${kind === "belt" ? "conveyor-visual" : fluid ? "fluid-visual" : ""}`}
      data-building-id={definition.id}
      style={
        {
          "--building-stage-color": buildingStageColor(definition.id),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {kind && connection ? (
        <RouteVisual
          id={definition.id}
          kind={kind}
          {...connection}
          level={level}
          arrow={kind === "belt" || kind === "pipe"}
        />
      ) : (
        <>
          {fluid && connection && (
            <RouteVisual
              id={definition.id}
              kind="pipe"
              {...connection}
              level={level}
            />
          )}
          {art ? (
            <BuildingSprite id={definition.id} mode="map" level={level} />
          ) : (
            <DefinitionIcon
              definition={definition}
              compact
              rotation={context.rotation}
            />
          )}
          {definition.id !== "bus" && (
            <svg
              className="building-map-arrow"
              viewBox="0 0 10 10"
              style={{ transform: `rotate(${context.rotation}deg)` }}
            >
              <path
                d="M3 1L7 5 3 9"
                fill="none"
                stroke="#eeedf9"
                strokeWidth="1.25"
              />
            </svg>
          )}
        </>
      )}
    </span>
  );
}
export default memo(BuildingVisual);
