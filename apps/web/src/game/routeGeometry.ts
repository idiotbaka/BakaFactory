/** Integer-pixel geometry shared by GUI, map and placement previews. */
export type RouteKind = "belt" | "pipe" | "shaft" | "hydraulic" | "cable";
export const ROUTE_SIZE = 30;
export const PORT_N = 1,
  PORT_E = 2,
  PORT_S = 4,
  PORT_W = 8;
export type RoutePath = Readonly<{ fill: string; d: string; layer: string }>;
const fills = [
  "",
  "var(--building-stage-color)",
  "#050509",
  "#6f89a5",
  "#344b65",
  "var(--route-trim, #37cbd9)",
  "#142136",
  "#526380",
  "var(--route-channel, #287d96)",
  "#a0b2c7",
];
const cache = new Map<string, readonly RoutePath[]>();
const at = (x: number, y: number) =>
  Math.max(0, Math.min(29, y)) * 30 + Math.max(0, Math.min(29, x));
function rect(
  mask: Uint8Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++) mask[y * 30 + x] = 1;
}
function rank(mask: Uint8Array, radius: number, grow: boolean) {
  const result = new Uint8Array(900);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++) {
      let value = grow ? 0 : 1;
      outer: for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (Boolean(mask[at(x + dx, y + dy)]) === grow) {
            value = grow ? 1 : 0;
            break outer;
          }
        }
      result[y * 30 + x] = value;
    }
  return result;
}
function pixels(kind: RouteKind, ports: number, open: number) {
  ports &= 15;
  open &= ports;
  const width =
    kind === "belt"
      ? 20
      : kind === "pipe"
        ? 10
        : kind === "shaft"
          ? 12
          : kind === "hydraulic"
            ? 8
            : 6;
  const lo = (30 - width) / 2,
    hi = lo + width - 1;
  const core = new Uint8Array(900);
  rect(core, lo, lo, hi, hi);
  if (ports & PORT_N) rect(core, lo, open & PORT_N ? 0 : 3, hi, 14);
  if (ports & PORT_E) rect(core, 15, lo, open & PORT_E ? 29 : 26, hi);
  if (ports & PORT_S) rect(core, lo, 15, hi, open & PORT_S ? 29 : 26);
  if (ports & PORT_W) rect(core, open & PORT_W ? 0 : 3, lo, 14, hi);
  const image = new Uint8Array(900);
  const paint = (color: number, mask: Uint8Array) => {
    for (let i = 0; i < 900; i++) if (mask[i]) image[i] = color;
  };
  paint(1, rank(core, 2, true));
  paint(2, rank(core, 1, true));
  paint(3, core);
  paint(4, rank(core, 1, false));
  const inner = rank(core, 2, false);
  if (kind === "belt") {
    paint(5, inner);
    const bed = rank(core, 3, false);
    paint(6, bed);
    const ribs = new Uint8Array(900);
    if (ports & PORT_E) rect(ribs, 24, 9, 25, 20);
    if (ports & PORT_W) rect(ribs, 4, 9, 5, 20);
    if (ports & PORT_N) rect(ribs, 9, 4, 20, 5);
    if (ports & PORT_S) rect(ribs, 9, 24, 20, 25);
    for (let i = 0; i < 900; i++) if (ribs[i] && bed[i]) image[i] = 7;
  } else {
    paint(6, inner);
    paint(
      8,
      rank(
        core,
        kind === "pipe"
          ? 4
          : kind === "hydraulic"
            ? 3
            : kind === "cable"
              ? 2
              : 3,
        false,
      ),
    );
    const collars = new Uint8Array(900);
    if (ports & PORT_E) rect(collars, 25, 0, 26, 29);
    if (ports & PORT_W) rect(collars, 3, 0, 4, 29);
    if (ports & PORT_N) rect(collars, 0, 3, 29, 4);
    if (ports & PORT_S) rect(collars, 0, 25, 29, 26);
    for (let i = 0; i < 900; i++)
      if (collars[i] && core[i] && !inner[i]) image[i] = 9;
    if (kind === "shaft") {
      const hub = new Uint8Array(900);
      rect(hub, 11, 11, 18, 18);
      paint(3, hub);
      const bore = new Uint8Array(900);
      rect(bore, 13, 13, 16, 16);
      paint(4, bore);
    }
  }
  return image;
}
/** Fresh buffer for static asset validation; renderers consume cached SVG paths. */
export const routePixels = (kind: RouteKind, ports: number, open = ports) =>
  pixels(kind, ports, open);
export function routeGeometry(
  kind: RouteKind,
  ports: number,
  open = ports,
): readonly RoutePath[] {
  ports &= 15;
  open &= ports;
  const key = `${kind}:${ports}:${open}`;
  const previous = cache.get(key);
  if (previous) return previous;
  const image = pixels(kind, ports, open),
    paths = Array.from({ length: fills.length }, () => "");
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30;) {
      const start = x,
        color = image[y * 30 + x++];
      while (x < 30 && image[y * 30 + x] === color) x++;
      if (color) paths[color] += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  const result = Object.freeze(
    paths.flatMap((d, i) =>
      d
        ? [
            Object.freeze({
              d,
              fill: fills[i],
              layer: i === 1 ? "stage" : i === 8 ? "channel" : "material",
            }),
          ]
        : [],
    ),
  );
  cache.set(key, result);
  return result;
}
