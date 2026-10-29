import { buildingDefinitions, isChest } from "./catalog";

// Low logistics are traversable, but robots exchange only with storage and
// production endpoints. Keep this shared by the form, map picker and actions.
export function freightEndpointSupported(type: string): boolean {
  const d = buildingDefinitions.get(type);
  return (
    type === "bus" ||
    isChest(type) ||
    d?.role === "tank" ||
    (d?.category === "machine" && d.role !== "station")
  );
}
