import type { Definition } from "../api/client";

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
