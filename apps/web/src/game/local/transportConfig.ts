import type { BuildingInstance } from "../../api/client";
import {
  buildingDefinitions,
  itemDefinitions,
  direction,
  isPort,
  isBelt,
  isChest,
} from "./catalog";
import { STEP_SECONDS, isStepValue } from "./simulationTime";
import { validFluidConfig } from "./fluidConfig";
import { isWarehouseTerminal, pickupType } from "./warehouseIO";
import { undergroundType } from "./underground";
import { canAutoEject } from "./machineOutput";

export const rotations = [0, 90, 180, 270] as const;
export type Rotation = (typeof rotations)[number];
export type FaceMode = "input" | "output" | "closed";
export type Face = { mode: FaceMode; filter: string };
export const enabled = (b: BuildingInstance) =>
  b.configuration.enabled !== false;
export const itemFilter = (b: BuildingInstance) =>
  typeof b.configuration.filter === "string" ? b.configuration.filter : "";
export const interval = (b: BuildingInstance) =>
  typeof b.configuration.interval === "number"
    ? b.configuration.interval
    : b.building_type === "feeder"
      ? STEP_SECONDS
      : 1;
export const channel = (b: BuildingInstance) =>
  b.configuration.channel === "fuel" ? "fuel" : "input";
export const branchFilter = (b: BuildingInstance, rotation: number) =>
  typeof b.configuration[`branch_${rotation}`] === "string"
    ? (b.configuration[`branch_${rotation}`] as string)
    : itemFilter(b);
export function face(b: BuildingInstance, rotation: number): Face {
  const value = b.configuration[`face_${rotation}`];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Face)
    : { mode: "input", filter: "" };
}
export function side(
  b: BuildingInstance,
  neighbor: Pick<BuildingInstance, "x" | "y">,
): number | undefined {
  return rotations.find((r) => {
    const [dx, dy] = direction(r);
    return b.x + dx === neighbor.x && b.y + dy === neighbor.y;
  });
}
export const isSolidTransport = (type: string) =>
  isBelt(type) ||
  isPort(type) ||
  isChest(type) ||
  type === "bus" ||
  isWarehouseTerminal(type) ||
  buildingDefinitions.get(type)?.role === "source";

// Configuration is persisted JSON; validate restored and edited fields equally.
// Unknown legacy presentation fields remain compatible, recognized gameplay
// fields never silently fall back to a different meaning.
export function validTransportConfig(
  b: Pick<BuildingInstance, "configuration" | "building_type">,
) {
  const c = b.configuration;
  if (b.building_type === undergroundType) {
    if (
      !["entry", "exit"].includes(c.underground_role as string) ||
      typeof c.underground_peer !== "string" ||
      !c.underground_peer.length ||
      c.underground_peer.length > 128
    )
      return false;
  } else if (
    c.underground_role !== undefined ||
    c.underground_peer !== undefined
  )
    return false;
  if (b.building_type === pickupType) {
    const values = c.output_items;
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 2 ||
      new Set(values).size !== values.length ||
      values.some(
        (id) =>
          typeof id !== "string" ||
          !itemDefinitions.has(id) ||
          itemDefinitions.get(id)?.kind === "fluid_or_gas",
      )
    )
      return false;
  } else if (c.output_items !== undefined) return false;
  if (!validFluidConfig(b)) return false;
  if (
    c.priority !== undefined &&
    (!Number.isInteger(c.priority) ||
      (c.priority as number) < 1 ||
      (c.priority as number) > 6)
  )
    return false;
  if (
    c.power_side !== undefined &&
    ![-1, 0, 90, 180, 270].includes(c.power_side as number)
  )
    return false;
  const definition = buildingDefinitions.get(b.building_type);
  if (
    c.battery_mode !== undefined &&
    (definition?.role !== "battery" ||
      !["auto", "charge", "discharge", "hold"].includes(
        c.battery_mode as string,
      ))
  )
    return false;
  if (
    c.reserve_kj !== undefined &&
    (definition?.role !== "battery" ||
      !Number.isInteger(c.reserve_kj) ||
      (c.reserve_kj as number) < 0 ||
      (c.reserve_kj as number) > (definition.capacity_kj ?? 15000))
  )
    return false;
  if (c.enabled !== undefined && typeof c.enabled !== "boolean") return false;
  if (
    c.auto_eject !== undefined &&
    (typeof c.auto_eject !== "boolean" || !canAutoEject(b.building_type))
  )
    return false;
  if (
    c.interval !== undefined &&
    (!isStepValue(c.interval, 60) ||
      (c.interval as number) < STEP_SECONDS ||
      (c.interval as number) > 60)
  )
    return false;
  if (
    c.channel !== undefined &&
    !["input", "fuel"].includes(c.channel as string)
  )
    return false;
  const validItem = (id: unknown) =>
    id === "" || (typeof id === "string" && itemDefinitions.has(id));
  if (c.filter !== undefined && !validItem(c.filter)) return false;
  for (const [key, value] of Object.entries(c)) {
    if (key.startsWith("branch_")) {
      if (!rotations.some((r) => key === `branch_${r}`) || !validItem(value))
        return false;
    }
    if (!key.startsWith("face_")) continue;
    if (
      b.building_type !== "bus" ||
      !rotations.some((r) => key === `face_${r}`) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return false;
    const f = value as Record<string, unknown>;
    if (
      !["input", "output", "closed"].includes(f.mode as string) ||
      !validItem(f.filter) ||
      (f.mode === "output" && !f.filter)
    )
      return false;
  }
  return true;
}
