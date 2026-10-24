import { memo, type CSSProperties } from "react";
import {
  buildingArtwork,
  buildingSpriteURL,
  buildingStageColor,
} from "./buildingArtwork";
import RouteVisual from "./RouteVisual";
import "./BuildingSprite.css";

function BuildingSprite({
  id,
  mode = "gui",
  rotation = 0,
  level = 0,
}: {
  id: string;
  mode?: "gui" | "map";
  rotation?: number;
  level?: number;
}) {
  const art = buildingArtwork(id);
  if (!art) return null;
  return (
    <span
      className={`building-sprite building-sprite-${mode} ${art.renderer === "image" ? "building-facade" : "building-connection"}`}
      data-building-id={id}
      aria-hidden="true"
      style={
        { "--building-stage-color": buildingStageColor(id) } as CSSProperties
      }
    >
      {art.renderer === "image" ? (
        <img
          className="building-face"
          src={buildingSpriteURL(id)}
          width={128}
          height={128}
          alt=""
          draggable={false}
          decoding="async"
        />
      ) : (
        <RouteVisual
          kind={art.renderer}
          mode={mode}
          rotation={rotation}
          id={id}
          level={level}
        />
      )}
      {mode === "map" && level > 0 && art.renderer === "image" && (
        <span
          className="building-fluid-level"
          style={{ "--fluid-level": Math.min(1, level) } as CSSProperties}
        />
      )}
    </span>
  );
}
export default memo(BuildingSprite);
