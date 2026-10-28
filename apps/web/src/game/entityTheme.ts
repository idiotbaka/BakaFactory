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
};
export function entityColor(definition: Pick<Definition, "id" | "color">) {
  return colors[definition.id] ?? definition.color;
}
