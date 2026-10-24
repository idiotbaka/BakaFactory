import { memo, type CSSProperties } from "react";
import type { Definition } from "../api/client";
import { entityColor } from "./entityTheme";
import ItemSprite from "./ItemSprite";
import { itemSpriteURL } from "./itemSprites";
import BuildingSprite from "./BuildingSprite";
import { buildingArtwork } from "./buildingArtwork";

const bodies: Record<string, string> = {
  bus: "M15 5h18l10 10v18L33 43H15L5 33V15Z",
  miner: "M10 38V15l7-7h14l7 7v23H10Z",
  furnace: "M11 40V13l7-7h12l7 7v27H11Z",
  assembler: "M6 34V17l10-9h16l10 9v17l-8 7H14Z",
  conveyor: "M4 11h40v26H4Z",
  item_output: "M5 10h15v28H5Z",
  item_input: "M28 10h15v28H28Z",
};

const paths: Record<string, string> = {
  tank: "M11 10Q24 3 37 10V38Q24 45 11 38ZM11 10Q24 17 37 10M16 23h16M16 29h16M6 24h5m26 0h5",
  valve: "M3 24H45M24 3V45M14 14H34V34H14ZM14 14L34 34M34 14L14 34",
  pump: "M3 24H10M38 24H45M24 10A14 14 0 1 0 24 38A14 14 0 1 0 24 10M19 16L32 24 19 32ZM14 40H34",
  generator:
    "M7 14h34v25H7ZM13 8h22v6M17 20l-5 7 5 7m14-14 5 7-5 7M25 18l-7 12h9l-3 7 10-14h-9z",
  cable: "M4 18h11l5 12h8l5-12h11M4 25h8m24 0h8M19 6h10v8H19ZM20 36h8v7h-8z",
  shaft:
    "M3 20h14v8H3ZM31 20h14v8H31ZM17 14h14v20H17ZM21 10h6m-6 28h6M21 19h6v10h-6z",
  pressure:
    "M3 18h12v12H3ZM33 18h12v12H33ZM15 10h18v28H15ZM20 17h8m-4 0v14m-5-5 5 5 5-5",
  pipe: "M3 18h21V5h12v25H15v13H3ZM3 15v18m12 7v5m6-40h18",
  battery: "M15 5h18v5M9 10h30v34H9ZM26 15l-10 14h8l-3 10 11-16h-8z",
  recycler:
    "M11 18 20 6l9 6-4 2M20 6l-2 9M36 17l7 13-10 6v-5M43 30H30M25 40H10L5 29l5 2M10 40l7-11",
  chest: "M7 17h34v23H7ZM5 10h38v7H5ZM20 17v10h8V17M11 31h6m14 0h6",
  feeder:
    "M5 18h12v13H5ZM17 24h10l7-10M27 24l7 10M34 14h8v7M34 34h8v-7M22 37v5h12",
  splitter:
    "M5 24h15l10-13h11M20 24h21M20 24l10 13h11M35 6l6 5-6 5M35 19l6 5-6 5M35 32l6 5-6 5",
  fluid:
    "M24 5C21 13 11 22 11 30a13 13 0 0 0 26 0C37 22 27 13 24 5ZM17 30c0 5 3 8 7 8",
  robot:
    "M12 14h24v21H12ZM19 14V8h10v6M18 23h2m8 0h2M19 30h10M6 20v12m36-12v12M18 35v8m12-8v8",
  bus: "m24 13 10 6v11l-10 6-10-6V19z M14 19l10 6 10-6M24 25v11M2 20h3m-3 8h3m38-8h3m-3 8h3M20 2v3m8-3v3m-8 38v3m8-3v3",
  miner:
    "M6 38h36v5H6z M17 15h14l-4 7h-6z M24 22v12m-5-6 5 6 5-6M14 11h3m14 0h3M14 17v14m20-14v14M9 41h4m5 0h4m5 0h4m5 0h4",
  furnace:
    "M16 40V23h16v17M20 32l4-7 4 7v4h-8zM16 12h16M17 17h3m3 0h3m3 0h3M7 20h4m26 0h4M7 33h4m26 0h4M15 6V3m18 3V3",
  assembler:
    "m24 17 9 7-9 8-9-8z M24 13v4m0 15v5M10 16l5 5m18 0 5-5M10 32l5-5m18 0 5 5M18 8V4h12v4M16 41v3m16-3v3M20 24h8",
  conveyor:
    "M7 13h34v23H7z M11 19h26m-26 12h26 M15 22l5 3-5 3m11-6 5 3-5 3 M11 13v-4m26 4v-4m-26 27v4m26-4v4",
  item_output: "M10 16h5m-5 8h5m-5 8h5M20 24h23m-9-9 9 9-9 9M25 16v16",
  item_input: "M33 16h5m-5 8h5m-5 8h5M4 24h24m-9-9 9 9-9 9M7 16v16",
  ore: "M9 33l3-17 10-7 13 6 5 18-13 7-18-7z M12 16l13 9 10-10m-10 10 2 15m-2-15L9 33",
  plate:
    "M8 17l22-8 11 8-22 9-11-9z M8 17v7l11 9 22-9v-7 M8 24v7l11 9 22-9v-7 M19 26v14",
  gear: "M19 7h10l2 7 7 2 5 8-5 8-7 2-2 7H19l-2-7-7-2-5-8 5-8 7-2z M24 17a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
};
function DefinitionIcon({
  definition,
  compact = false,
  rotation = 0,
}: {
  definition: Definition;
  compact?: boolean;
  rotation?: number;
}) {
  const sprite = itemSpriteURL(definition.id);
  const building = buildingArtwork(definition.id);
  return (
    <span
      className={`definition-icon entity-${definition.id} ${compact ? "compact" : ""} ${sprite ? "has-item-sprite" : building ? "has-building-art" : ""}`}
      style={{ "--entity-color": entityColor(definition) } as CSSProperties}
      aria-hidden="true"
    >
      {sprite ? (
        <ItemSprite id={definition.id} />
      ) : building ? (
        <BuildingSprite id={definition.id} rotation={rotation} />
      ) : (
        <>
          <svg
            viewBox="0 0 48 48"
            fill="none"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            {bodies[definition.icon] && (
              <path
                className="entity-body"
                d={bodies[definition.icon]}
                stroke="currentColor"
                strokeWidth="1.5"
              />
            )}
            <path
              d={paths[definition.icon] ?? "M10 10h28v28H10z"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <span className="definition-code">{definition.code}</span>
        </>
      )}
    </span>
  );
}
export default memo(DefinitionIcon);
