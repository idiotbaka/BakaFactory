import { memo } from "react";
import BuildingVisual, { type BuildingVisualProps } from "./BuildingVisual";

// Compatibility entry point; map and previews share the production renderer.
function ConveyorVisual(props: BuildingVisualProps) {
  return <BuildingVisual {...props} />;
}
export default memo(ConveyorVisual);
