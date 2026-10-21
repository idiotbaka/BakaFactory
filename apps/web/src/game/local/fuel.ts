import type { BuildingDefinition, MachineState } from "../../api/client";
import { itemID } from "./catalog";
import { remove } from "./inventory";

const biomass = itemID("干燥生物质"),
  carbon = itemID("生物炭"),
  solid = itemID("固体燃料块"),
  liquid = itemID("液体燃料");
export function fuelValues(d: BuildingDefinition): Record<string, number> {
  if (d.energy === "heat")
    return { [biomass]: 280, [carbon]: 1650, [solid]: 3600 };
  if (d.id === "m09") return { [biomass]: 264, [carbon]: 990, [solid]: 1980 };
  if (d.id === "m21") return { [liquid]: 6080 };
  if (d.id === "m28") return { [liquid]: 6400 };
  if (d.id === "m20") return { [itemID("高压蒸汽")]: 100 };
  return {};
}
export function fuelAvailable(m: MachineState, d: BuildingDefinition) {
  const values = fuelValues(d);
  return (
    (m.energy_kj ?? 0) +
    (m.fuel ?? []).reduce((sum, s) => sum + (values[s.item] ?? 0) * s.count, 0)
  );
}
// Fuel has its own inventory: recipe biomass/coal is never charged twice as
// both a chemical ingredient and heat. Unused burn energy survives saves.
export function spendFuel(
  m: MachineState,
  d: BuildingDefinition,
  amount: number,
) {
  if (fuelAvailable(m, d) < amount) return false;
  const values = fuelValues(d);
  m.energy_kj ??= 0;
  while (m.energy_kj < amount) {
    const stack = m.fuel?.find((s) => values[s.item]);
    if (!stack) return false;
    m.energy_kj += values[stack.item];
    remove(m.fuel!, stack.item);
  }
  m.energy_kj -= amount;
  return true;
}
