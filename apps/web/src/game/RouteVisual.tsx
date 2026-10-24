import { memo, type CSSProperties } from "react";
import { PORT_E, PORT_W, routeGeometry, type RouteKind } from "./routeGeometry";

function RouteVisual({
  kind,
  ports = PORT_E | PORT_W,
  open = ports,
  rotation = 0,
  mode = "map",
  arrow = false,
  level = 0,
  id = "",
}: {
  kind: RouteKind;
  ports?: number;
  open?: number;
  rotation?: number;
  mode?: "map" | "gui";
  arrow?: boolean;
  level?: number;
  id?: string;
}) {
  const trim =
    id === "hand_belt"
      ? "#b8a57a"
      : id === "return_pipe"
        ? "#ad92ff"
        : "#37cbd9";
  const channel =
    kind === "shaft"
      ? "#a0b2c7"
      : kind === "cable"
        ? "#ff62cb"
        : kind === "hydraulic"
          ? "#ad92ff"
          : level > 0
            ? "#a6f8f7"
            : "#287d96";
  return (
    <svg
      className={`building-route route-${kind} route-${mode}`}
      viewBox="0 0 30 30"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-route-kind={kind}
      data-ports={ports}
      data-open-ports={open}
      style={
        { "--route-trim": trim, "--route-channel": channel } as CSSProperties
      }
    >
      <g transform={`rotate(${rotation} 15 15)`}>
        {routeGeometry(kind, ports, open).map((path) => (
          <path
            key={path.fill}
            className={`route-layer-${path.layer}`}
            fill={path.fill}
            d={path.d}
          />
        ))}
        {arrow && (
          <path
            className="building-route-arrow"
            d="M12 10L18 15 12 20"
            fill="none"
            stroke="#eeedf9"
            strokeWidth="1"
          />
        )}
      </g>
    </svg>
  );
}
export default memo(RouteVisual);
