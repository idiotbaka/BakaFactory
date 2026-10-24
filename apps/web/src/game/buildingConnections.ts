import type {
  BuildingDefinition,
  BuildingInstance,
  BuildingPlacement,
} from "../api/client";
import { conveyorConnections } from "./conveyorVisuals";
import { fluidPipeConnections } from "./fluidVisuals";
import { direction } from "./local/catalog";
import {
  PORT_E,
  PORT_N,
  PORT_S,
  PORT_W,
  type RouteKind,
} from "./routeGeometry";

export type ConnectionContext = {
  x: number;
  y: number;
  rotation: BuildingPlacement["rotation"];
  buildings: ReadonlyMap<string, BuildingInstance>;
  instanceID?: string;
};
const bits = [PORT_E, PORT_S, PORT_W, PORT_N];
const mask = (ports: number[]) =>
  ports.reduce((value, side) => value | bits[side], 0);

export function buildingConnections(
  kind: RouteKind,
  definition: BuildingDefinition,
  context: ConnectionContext,
) {
  if (kind === "belt") {
    const { incoming, front } = conveyorConnections(context);
    const ports =
      !incoming.includes(1) && !incoming.includes(3)
        ? PORT_E | PORT_W
        : mask([0, ...incoming]);
    return {
      ports,
      open: mask(incoming) | (front ? PORT_E : 0),
      rotation: context.rotation,
    };
  }
  if (kind === "pipe") {
    const incoming = fluidPipeConnections(context);
    const connected = mask([0, ...incoming]);
    const ports = connected === PORT_E ? connected | PORT_W : connected;
    return { ports, open: ports, rotation: context.rotation };
  }
  let ports = 0;
  for (let side = 0; side < 4; side++) {
    const [dx, dy] = direction(side * 90);
    const neighbor = context.buildings.get(
      `${context.x + dx},${context.y + dy}`,
    );
    // A machine never visually bridges two independent conductor networks.
    // Enabled state and derived power are not evidence of a successful transfer.
    if (
      neighbor &&
      neighbor.id !== context.instanceID &&
      neighbor.building_type === definition.id
    )
      ports |= bits[side];
  }
  return ports
    ? { ports, open: ports, rotation: 0 }
    : { ports: PORT_E | PORT_W, open: 0, rotation: context.rotation };
}
