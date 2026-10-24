import type { Definition } from "../api/client";

export const phaseColors: Readonly<Record<number, string>> = {
  1: "#ffc879",
  2: "#a5d4b2",
  3: "#74edce",
  4: "#46eff2",
  5: "#b69aff",
  6: "#ff72cf",
};

// Presentation only. Server definitions still own recipes and gameplay.
const colors: Record<string, string> = {
  bus: "#46eff2",
  miner: "#ffc879",
  furnace: "#ff759b",
  assembler: "#b69aff",
  conveyor: "#54dce8",
  item_output: "#ff72cf",
  item_input: "#74edce",
  iron_ore: "#8bd9ef",
  iron_plate: "#b4baff",
  gear: "#ffd58e",
};
export function entityColor(definition: Pick<Definition, "id" | "color">) {
  return colors[definition.id] ?? definition.color;
}
