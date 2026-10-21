import type { BuildingInstance } from "../../api/client";
import { buildingDefinitions, isFluid, isFluidNode } from "./catalog";

export type FluidTarget = "auto" | "input" | "fuel" | "medium";
export const fluidRate = (b: BuildingInstance) =>
  typeof b.configuration.fluid_rate === "number"
    ? b.configuration.fluid_rate
    : (buildingDefinitions.get(b.building_type)?.fluid_rate ?? 0);
export const fluidTarget = (b: BuildingInstance): FluidTarget =>
  typeof b.configuration.fluid_target === "string"
    ? (b.configuration.fluid_target as FluidTarget)
    : "auto";
export const fluidLimit = (b: BuildingInstance) =>
  typeof b.configuration.fluid_limit === "number"
    ? b.configuration.fluid_limit
    : 0;
export const splitWeights = (b: BuildingInstance): number[] =>
  Array.isArray(b.configuration.split_weights)
    ? (b.configuration.split_weights as number[])
    : [1, 1, 1];
export const fluidBranchFilter = (b: BuildingInstance, rotation: number) =>
  typeof b.configuration[`branch_${rotation}`] === "string"
    ? (b.configuration[`branch_${rotation}`] as string)
    : "";
export function acceptsFluid(type: string, item: string) {
  const d = buildingDefinitions.get(type);
  return (
    !!d &&
    isFluidNode(type) &&
    isFluid(item) &&
    (!d.input_whitelist?.length || d.input_whitelist.includes(item))
  );
}
export function validFluidConfig(
  b: Pick<BuildingInstance, "building_type" | "configuration">,
) {
  const c = b.configuration,
    d = buildingDefinitions.get(b.building_type)!,
    node = isFluidNode(b.building_type);
  if (
    c.fluid_rate !== undefined &&
    (!node ||
      !Number.isInteger(c.fluid_rate) ||
      (c.fluid_rate as number) < 0 ||
      (c.fluid_rate as number) > (d.fluid_rate ?? 0))
  )
    return false;
  if (
    c.fluid_target !== undefined &&
    (!node ||
      !["auto", "input", "fuel", "medium"].includes(c.fluid_target as string))
  )
    return false;
  if (
    c.fluid_limit !== undefined &&
    (!node ||
      !Number.isInteger(c.fluid_limit) ||
      (c.fluid_limit as number) < 0 ||
      (c.fluid_limit as number) > 500)
  )
    return false;
  if (
    c.split_weights !== undefined &&
    (d.role !== "valve" ||
      !Array.isArray(c.split_weights) ||
      c.split_weights.length !== 3 ||
      c.split_weights.some(
        (v) => !Number.isInteger(v) || (v as number) < 0 || (v as number) > 10,
      ))
  )
    return false;
  if (node) {
    if (
      c.filter &&
      (typeof c.filter !== "string" || !acceptsFluid(b.building_type, c.filter))
    )
      return false;
    for (const [key, value] of Object.entries(c))
      if (
        key.startsWith("branch_") &&
        value &&
        (typeof value !== "string" || !isFluid(value))
      )
        return false;
  }
  return true;
}
