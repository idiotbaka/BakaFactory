import { memo } from "react";
import type { BuildingDefinition, MachineState } from "../api/client";

function FluidVisual({
  definition,
  rotation,
  machine,
}: {
  definition: BuildingDefinition;
  rotation: number;
  machine?: MachineState;
}) {
  const level = Math.min(
    1,
    (machine?.fluid?.count ?? 0) / (definition.fluid_capacity ?? 1),
  );
  return (
    <svg
      className="fluid-visual"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <g transform={`rotate(${rotation} 24 24)`}>
        <path
          d={definition.role === "valve" ? "M0 24H48M24 0V48" : "M0 24H48"}
          stroke="currentColor"
          strokeWidth="12"
          opacity=".3"
        />
        <path
          d="M3 24H44"
          stroke="currentColor"
          strokeWidth="4"
          opacity={level ? 1 : 0.25}
        />
        {definition.role === "tank" ? (
          <>
            <rect
              x="12"
              y="7"
              width="24"
              height="34"
              rx="5"
              fill="#101220"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect
              x="16"
              y={37 - level * 26}
              width="16"
              height={level * 26}
              fill="currentColor"
              opacity=".6"
            />
          </>
        ) : definition.role === "valve" ? (
          <>
            <circle
              cx="24"
              cy="24"
              r="10"
              fill="#101220"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M24 14V34M14 24H34"
              stroke="currentColor"
              strokeWidth="2"
            />
          </>
        ) : definition.role === "pump" ? (
          <>
            <circle
              cx="24"
              cy="24"
              r="13"
              fill="#101220"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M19 17L31 24 19 31Z" fill="currentColor" />
          </>
        ) : (
          <>
            <path
              d="M12 16V32M34 16V32"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle
              cx="24"
              cy="24"
              r="4"
              fill="currentColor"
              opacity={level ? 1 : 0.2}
            />
          </>
        )}
        <path d="M38 18L44 24 38 30" stroke="currentColor" strokeWidth="2" />
      </g>
    </svg>
  );
}
export default memo(FluidVisual);
