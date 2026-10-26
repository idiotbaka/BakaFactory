import { containsCell } from "./footprint";
import type {
  BuildingInstance,
  FactoryDetail,
  ItemTransfer,
  MachineState,
  TransferEndpoint,
} from "../api/client";
import type { Point } from "./animationMath";
import { TILE_SIZE } from "./editorGeometry";
import { isBelt, beltTicks } from "./local/catalog";
import { undergroundType } from "./local/underground";

export type VisualItem = {
  id: string;
  item: string;
  epoch: string;
  tick: number;
  transfer?: ItemTransfer;
  belt?: {
    moving: boolean;
    building: BuildingInstance;
    payload: NonNullable<MachineState["belt"]>;
  };
};

export function tileCenter(
  tile: Pick<TransferEndpoint, "x" | "y">,
  width: number,
  height: number,
): Point {
  return {
    x: (tile.x + Math.floor(width / 2) + 0.5) * TILE_SIZE,
    y: (Math.floor(height / 2) - tile.y + 0.5) * TILE_SIZE,
  };
}
export function beltEnds(
  tile: TransferEndpoint,
  width: number,
  height: number,
) {
  const center = tileCenter(tile, width, height);
  const rotation =
    tile.building_type === undergroundType
      ? (360 - tile.rotation) % 360
      : tile.rotation;
  const [dx, dy] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ][rotation / 90];
  return {
    center,
    entry: { x: center.x - dx * 12, y: center.y - dy * 12 },
    goal: { x: center.x + dx * 12, y: center.y + dy * 12 },
  };
}

// The route is a visual receipt for a committed transfer, never a prediction
// that an unconfirmed receiver will accept an item.
export function transferPath(
  event: ItemTransfer,
  width: number,
  height: number,
  start?: Point,
): Point[] {
  const source = tileCenter(event.source, width, height);
  const target = tileCenter(event.target, width, height);
  const via = event.via && tileCenter(event.via, width, height);
  const next = via ?? target;
  const distance = Math.hypot(next.x - source.x, next.y - source.y) || 1;
  const exit = isBelt(event.source.building_type)
    ? beltEnds(event.source, width, height).goal
    : {
        x: source.x + ((next.x - source.x) / distance) * 12,
        y: source.y + ((next.y - source.y) / distance) * 12,
      };
  const points = [start ?? exit];
  if (via) points.push(via);
  if (isBelt(event.target.building_type)) {
    const ends = beltEnds(event.target, width, height),
      fraction = 1 / beltTicks(event.target.building_type);
    const goal = {
      x: ends.entry.x + (ends.goal.x - ends.entry.x) * fraction,
      y: ends.entry.y + (ends.goal.y - ends.entry.y) * fraction,
    };
    if (fraction >= 0.5) points.push(target);
    points.push(goal);
  } else {
    const previous = via ?? source;
    const length =
      Math.hypot(target.x - previous.x, target.y - previous.y) || 1;
    points.push({
      x: target.x - ((target.x - previous.x) / length) * 12,
      y: target.y - ((target.y - previous.y) / length) * 12,
    });
    points.push(target);
  }
  return points;
}

function matches(a: BuildingInstance | undefined, b: TransferEndpoint) {
  return (
    a?.id === b.id &&
    a.building_type === b.building_type &&
    containsCell(a, b) &&
    a.rotation === b.rotation
  );
}
function validRoute(
  event: ItemTransfer,
  buildings: Map<string, BuildingInstance>,
) {
  return (
    matches(buildings.get(event.source.id), event.source) &&
    matches(buildings.get(event.target.id), event.target) &&
    (!event.via || matches(buildings.get(event.via.id), event.via))
  );
}

// Retain outgoing icons after their belt inventory disappears. This tiny
// external store publishes only on snapshots / completion, never every frame.
export class LogisticsVisualStore {
  private factory: FactoryDetail;
  private lastAt: number | null = null;
  private epoch = 0;
  private versions = new Map<string, number>();
  private incoming = new Map<string, ItemTransfer>();
  private outgoing = new Map<string, ItemTransfer>();
  private listeners = new Set<() => void>();
  private snapshot: VisualItem[];

  constructor(factory: FactoryDetail) {
    this.factory = factory;
    this.snapshot = this.buildSnapshot();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  accept(factory: FactoryDetail, now: number, visible: boolean) {
    const tick = factory.simulation?.tick ?? 0;
    const oldTick = this.factory.simulation?.tick ?? 0;
    const buildings = new Map(factory.buildings.map((b) => [b.id, b]));
    const oldBuildings = new Map(this.factory.buildings.map((b) => [b.id, b]));
    const changed = new Set(
      factory.buildings
        .filter(
          (b) =>
            b.x !== oldBuildings.get(b.id)?.x ||
            b.y !== oldBuildings.get(b.id)?.y ||
            b.size !== oldBuildings.get(b.id)?.size ||
            b.rotation !== oldBuildings.get(b.id)?.rotation ||
            JSON.stringify(b.configuration) !==
              JSON.stringify(oldBuildings.get(b.id)?.configuration),
        )
        .map((b) => b.id),
    );
    for (const collection of [this.incoming, this.outgoing]) {
      for (const [id, event] of collection) {
        if (
          changed.has(event.source.id) ||
          changed.has(event.target.id) ||
          (event.via && changed.has(event.via.id))
        ) {
          collection.delete(id);
          this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
        }
      }
    }
    // Cancel a flight onto a belt without removing that belt's real payload.
    // Only this item's track resets; unrelated animations keep moving.
    for (const [id, event] of this.incoming) {
      if (!validRoute(event, buildings))
        this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    }
    const reset =
      !visible ||
      this.lastAt === null ||
      now - this.lastAt > 2500 ||
      factory.id !== this.factory.id ||
      tick < oldTick ||
      tick - oldTick > 2;
    if (reset) {
      this.epoch++;
      this.versions.clear();
      this.incoming.clear();
      this.outgoing.clear();
    } else if (tick > oldTick) {
      this.incoming.clear();
      // A slightly delayed poll can skip one tick. Consume only unseen
      // receipts in that small window, never initial / background history.
      for (const event of factory.simulation?.transfers ?? []) {
        if (event.tick <= oldTick || event.tick > tick) continue;
        const collection = isBelt(event.target.building_type)
          ? this.incoming
          : this.outgoing;
        collection.set(event.payload_id, event);
      }
    }
    this.factory = factory;
    this.lastAt = visible ? now : null;
    for (const collection of [this.incoming, this.outgoing]) {
      for (const [id, event] of collection) {
        if (event.tick < tick - 1 || !validRoute(event, buildings))
          collection.delete(id);
      }
    }
    this.publish();
  }
  suspend = () => {
    this.lastAt = null;
    this.epoch++;
    this.versions.clear();
    this.incoming.clear();
    this.outgoing.clear();
    this.publish();
  };
  finish = (payloadID: string, eventID: string) => {
    if (this.outgoing.get(payloadID)?.id !== eventID) return;
    this.outgoing.delete(payloadID);
    this.publish();
  };
  private buildSnapshot(): VisualItem[] {
    const items = new Map<string, VisualItem>();
    for (const building of this.factory.buildings) {
      const payload = this.factory.simulation?.buildings[building.id]?.belt;
      if (!isBelt(building.building_type) || !payload) continue;
      const transfer = this.incoming.get(payload.id);
      items.set(payload.id, {
        id: payload.id,
        item: payload.item,
        epoch: `${this.epoch}:${this.versions.get(payload.id) ?? 0}`,
        tick: this.factory.simulation!.tick,
        belt: {
          building,
          payload,
          moving:
            this.factory.simulation!.buildings[building.id].status ===
            "transporting",
        },
        transfer: transfer?.target.id === building.id ? transfer : undefined,
      });
    }
    for (const [id, transfer] of this.outgoing) {
      if (items.has(id)) continue;
      items.set(id, {
        id,
        item: transfer.item,
        epoch: `${this.epoch}:${this.versions.get(id) ?? 0}`,
        tick: transfer.tick,
        transfer,
      });
    }
    return [...items.values()];
  }
  private publish() {
    this.snapshot = this.buildSnapshot();
    const present = new Set(this.snapshot.map((item) => item.id));
    for (const id of this.versions.keys()) {
      if (!present.has(id)) this.versions.delete(id);
    }
    for (const listener of this.listeners) listener();
  }
}
