import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { Catalog, FactoryDetail, TransferEndpoint } from "../api/client";
import { sampleMotion, type Motion } from "./animationMath";
import {
  beltEnds,
  LogisticsVisualStore,
  transferPath,
  type VisualItem,
} from "./logisticsVisuals";
import { useSimulationFrame } from "./SimulationAnimation";
import { entityColor } from "./entityTheme";
import { beltTicks } from "./local/catalog";

type Track = Motion & {
  building: TransferEndpoint;
  epoch: string;
  segment: string;
  completed: boolean;
};
function ItemVisual({
  visual,
  width,
  height,
  catalog,
  finish,
}: {
  visual: VisualItem;
  width: number;
  height: number;
  catalog: Catalog;
  finish: (payloadID: string, eventID: string) => void;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const track = useRef<Track | null>(null);
  const item = catalog.items.find((d) => d.id === visual.item);
  const { belt, transfer } = visual;
  const building = belt?.building ?? transfer!.source;
  const ends = beltEnds(building, width, height);
  const durationTicks = beltTicks(building.building_type);
  const position = (progress: number) => {
    const fraction = Math.min(1, progress / durationTicks);
    return {
      x: ends.entry.x + (ends.goal.x - ends.entry.x) * fraction,
      y: ends.entry.y + (ends.goal.y - ends.entry.y) * fraction,
    };
  };
  const initial = transfer
    ? transferPath(transfer, width, height)[0]
    : position(belt!.payload.progress);
  const goal = belt
    ? position(belt.payload.progress + (belt.moving ? 1 : 0))
    : ends.goal;
  const segment = `${visual.epoch}:${visual.tick}:${building.id}:${building.x}:${building.y}:${building.rotation}:${belt?.payload.progress}:${belt?.moving}:${transfer?.id}`;
  useLayoutEffect(() => {
    const now = performance.now();
    const previous = track.current;
    if (previous?.segment === segment) return;
    const relocated =
      previous?.building.id === building.id &&
      (previous.building.x !== building.x ||
        previous.building.y !== building.y ||
        previous.building.rotation !== building.rotation);
    const missed =
      previous &&
      Math.abs(previous.building.x - building.x) +
        Math.abs(previous.building.y - building.y) >
        2;
    const continuous =
      previous && previous.epoch === visual.epoch && !relocated && !missed;
    // An event starts at the last drawn source belt position, or at the
    // machine's output edge. The target belt and the flight share one key.
    const start =
      continuous && (!transfer || previous.building.id === transfer.source.id)
        ? sampleMotion(previous, now)
        : initial;
    const destination =
      belt &&
      !belt.moving &&
      belt.payload.progress < durationTicks &&
      continuous
        ? start
        : goal;
    const points = transfer
      ? transferPath(transfer, width, height, start)
      : [start, destination];
    if (
      !transfer &&
      continuous &&
      previous.building.id !== building.id &&
      previous.building.rotation !== building.rotation
    )
      points.splice(1, 0, ends.center);
    track.current = {
      points,
      startedAt: now,
      duration: transfer
        ? 1000
        : Math.hypot(destination.x - start.x, destination.y - start.y) < 0.01
          ? 0
          : belt!.payload.progress >= durationTicks
            ? 120
            : 1000,
      building,
      epoch: visual.epoch,
      segment,
      completed: false,
    };
    if (element.current) {
      element.current.style.transform = `translate3d(${start.x}px,${start.y}px,0)`;
      element.current.style.opacity = "1";
    }
  });
  useSimulationFrame((frame) => {
    const motion = track.current;
    if (!motion || !element.current) return;
    const point = sampleMotion(motion, frame.now);
    const fraction = Math.min(
      1,
      Math.max(
        0,
        (frame.now - motion.startedAt) / Math.max(1, motion.duration),
      ),
    );
    const terminal = !belt && transfer;
    const absorption = terminal ? Math.max(0, (fraction - 0.75) / 0.25) : 0;
    element.current.style.transform = `translate3d(${point.x}px,${point.y}px,0) scale(${1 - absorption * 0.7})`;
    element.current.style.opacity = `${1 - absorption}`;
    const moving = frame.now < motion.startedAt + motion.duration;
    if (terminal && !moving && !motion.completed) {
      motion.completed = true;
      finish(visual.id, transfer.id);
    }
    return moving;
  });
  return (
    <span
      ref={element}
      className="conveyor-payload"
      aria-hidden="true"
      style={
        {
          "--item-color": item ? entityColor(item) : "#46eff2",
          transform: `translate3d(${initial.x}px,${initial.y}px,0)`,
        } as CSSProperties
      }
    >
      <svg viewBox="0 0 12 10" aria-hidden="true">
        <path
          d={
            visual.item === "iron_plate"
              ? "M2 3 7 1l3 2-5 2zM2 5l3 2 5-2M2 7l3 2 5-2"
              : visual.item === "gear"
                ? "m4 1 4 0 3 4-3 4H4L1 5zM6 3v4M4 5h4"
                : "m2 7 1-5 4-1 3 5-4 3zM3 2l3 3 4 1M6 5v4"
          }
        />
      </svg>
    </span>
  );
}
function ConveyorItemsLayer({
  factory,
  catalog,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
}) {
  const [store] = useState(() => new LogisticsVisualStore(factory));
  const visuals = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    store.accept(factory, performance.now(), !document.hidden);
  }, [store, factory]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) store.suspend();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [store]);
  return (
    <div className="conveyor-items-layer" aria-hidden="true">
      {visuals.map((visual) => (
        <ItemVisual
          key={visual.id}
          visual={visual}
          width={factory.width}
          height={factory.height}
          catalog={catalog}
          finish={store.finish}
        />
      ))}
    </div>
  );
}
export default memo(ConveyorItemsLayer);
