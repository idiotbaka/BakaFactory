import { memo, useMemo, type CSSProperties } from "react";
import type { FactoryDetail } from "../api/client";
import { GRID_INSET, TILE_SIZE, type Camera } from "./editorGeometry";
import { powerUseKind, type PowerKind } from "./local/power";
import { powerNetworkID, powerRegions } from "./local/powerRegions";
import { powerNames } from "./PowerPanel";

const kinds: PowerKind[] = ["shaft", "hydraulic", "electric"];

const palette = [
  { fill: "rgba(83, 243, 255, 0.16)", stroke: "#53f3ff" },
  { fill: "rgba(255, 85, 184, 0.16)", stroke: "#ff55b8" },
  { fill: "rgba(104, 255, 154, 0.16)", stroke: "#68ff9a" },
  { fill: "rgba(255, 200, 87, 0.16)", stroke: "#ffc857" },
  { fill: "rgba(184, 140, 255, 0.16)", stroke: "#b88cff" },
  { fill: "rgba(255, 122, 107, 0.16)", stroke: "#ff7a6b" },
];

function PowerRegionLayer({
  factory,
  camera,
}: {
  factory: Pick<FactoryDetail, "width" | "height" | "buildings" | "simulation">;
  camera: Camera;
}) {
  const halfWidth = Math.floor(factory.width / 2),
    halfHeight = Math.floor(factory.height / 2),
    gridWidth = factory.width * TILE_SIZE,
    gridHeight = factory.height * TILE_SIZE;

  const entries = useMemo(() => {
    const networks = new Map(
      (factory.simulation?.networks ?? []).map((n) => [n.id, n]),
    );
    return powerRegions(factory.buildings).map((region, index) => {
      const color = palette[index % palette.length],
        cellSet = new Set(region.cells.map((c) => `${c.x},${c.y}`)),
        edges: string[] = [];
      let sumX = 0,
        sumY = 0;
      const rects = region.cells.map((c) => {
        const col = c.x + halfWidth,
          row = halfHeight - c.y,
          x = col * TILE_SIZE,
          y = row * TILE_SIZE;
        sumX += x + TILE_SIZE / 2;
        sumY += y + TILE_SIZE / 2;
        if (!cellSet.has(`${c.x},${c.y + 1}`))
          edges.push(`M${x},${y}H${x + TILE_SIZE}`);
        if (!cellSet.has(`${c.x + 1},${c.y}`))
          edges.push(`M${x + TILE_SIZE},${y}V${y + TILE_SIZE}`);
        if (!cellSet.has(`${c.x},${c.y - 1}`))
          edges.push(`M${x},${y + TILE_SIZE}H${x + TILE_SIZE}`);
        if (!cellSet.has(`${c.x - 1},${c.y}`))
          edges.push(`M${x},${y}V${y + TILE_SIZE}`);
        return { key: `${c.x},${c.y}`, x, y };
      });
      const avgX = sumX / region.cells.length,
        avgY = sumY / region.cells.length;
      let anchorX = avgX,
        anchorY = avgY,
        bestDist = Number.POSITIVE_INFINITY;
      for (const rect of rects) {
        const cx = rect.x + TILE_SIZE / 2,
          cy = rect.y + TILE_SIZE / 2,
          dist = (cx - avgX) ** 2 + (cy - avgY) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          anchorX = cx;
          anchorY = cy;
        }
      }
      const lines = kinds.flatMap((kind) => {
        const net = networks.get(powerNetworkID(kind, region.id)),
          consumers = region.buildings.filter(
            (b) => powerUseKind(b) === kind,
          ).length;
        if (net)
          return [
            {
              key: kind,
              text: `${powerNames[kind]} 需 ${net.demand_kw} / 供 ${net.capacity_kw} kW`,
              warning: net.capacity_kw < net.demand_kw,
            },
          ];
        if (consumers > 0)
          return [
            {
              key: kind,
              text: `${powerNames[kind]} 未接入 · ${consumers} 台`,
              warning: true,
            },
          ];
        return [];
      });
      return {
        region,
        index: index + 1,
        color,
        rects,
        boundary: edges.join(""),
        anchorX,
        anchorY,
        lines,
      };
    });
  }, [factory.buildings, factory.simulation?.networks, halfHeight, halfWidth]);

  if (!entries.length) return null;

  return (
    <div className="power-region-layer" aria-label="工厂组网覆盖层">
      <svg
        className="power-region-svg"
        viewBox={`0 0 ${gridWidth} ${gridHeight}`}
        style={{
          width: gridWidth,
          height: gridHeight,
          transform: `translate(${camera.x + GRID_INSET * camera.zoom}px, ${camera.y + GRID_INSET * camera.zoom}px) scale(${camera.zoom})`,
        }}
        aria-hidden="true"
      >
        {entries.map((entry) => (
          <g key={entry.region.id} data-region-id={entry.region.id}>
            {entry.rects.map((r) => (
              <rect
                key={r.key}
                x={r.x}
                y={r.y}
                width={TILE_SIZE}
                height={TILE_SIZE}
                fill={entry.color.fill}
              />
            ))}
            <path
              d={entry.boundary}
              fill="none"
              stroke={entry.color.stroke}
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      {entries.map((entry) =>
        entry.lines.length ? (
          <div
            key={entry.region.id}
            className="power-region-label"
            data-region-label={entry.region.id}
            style={
              {
                "--region-stroke": entry.color.stroke,
                left: camera.x + (GRID_INSET + entry.anchorX) * camera.zoom,
                top: camera.y + (GRID_INSET + entry.anchorY) * camera.zoom,
              } as CSSProperties
            }
          >
            <span className="power-region-title">
              组网 {entry.index} · {entry.region.buildings.length} 个方块
            </span>
            {entry.lines.map((line) => (
              <span
                key={line.key}
                className={`power-region-line${line.warning ? " is-warning" : ""}`}
              >
                {line.text}
              </span>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

export default memo(PowerRegionLayer);
