import { memo } from "react";
import BuildingVisual, { type BuildingVisualProps } from "./BuildingVisual";

function FluidVisual(props: BuildingVisualProps) {
  return <BuildingVisual {...props} />;
}
export default memo(FluidVisual);
