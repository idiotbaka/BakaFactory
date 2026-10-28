import type { Robot } from "./local/robotRoutes";
import type { RobotDirection } from "./robotSprites";

type Position = { x: number; y: number };
export type RobotVisualPosition = Position & {
  direction: RobotDirection;
  moving: boolean;
};
type Track = {
  tick: number;
  revision: number;
  factoryID: string;
  stepMs: number;
  confirmed: Position;
  from: Position;
  to: Position;
  startedAt: number;
  duration: number;
  direction: RobotDirection;
};
export class RobotVisuals {
  private readonly tracks = new Map<string, Track>();
  private readonly dirty = new Set<string>();
  private suspended = false;
  sync(
    robots: readonly Robot[],
    factoryID: string,
    tick: number,
    revision: number,
    stepMs: number,
    now: number,
    paused: boolean,
    hidden: boolean,
  ) {
    const reset = paused || hidden || this.suspended;
    const ids = new Set(robots.map((r) => r.id));
    for (const id of this.tracks.keys())
      if (!ids.has(id)) {
        this.tracks.delete(id);
        this.dirty.delete(id);
      }
    for (const robot of robots) {
      const previous = this.tracks.get(robot.id);
      const snap = reset || !robot.enabled;
      if (
        previous &&
        previous.tick === tick &&
        previous.revision === revision &&
        previous.stepMs === stepMs &&
        previous.factoryID === factoryID &&
        previous.confirmed.x === robot.x &&
        previous.confirmed.y === robot.y &&
        !snap
      )
        continue;
      const confirmed = { x: robot.x, y: robot.y };
      const distance = previous
        ? Math.abs(previous.confirmed.x - robot.x) +
          Math.abs(previous.confirmed.y - robot.y)
        : 0;
      const continuous =
        !snap &&
        previous &&
        previous.factoryID === factoryID &&
        previous.tick + 1 === tick &&
        previous.stepMs === stepMs &&
        now - previous.startedAt <= stepMs * 2.5 &&
        distance === 1;
      let direction = previous?.direction ?? "down";
      if (previous && distance === 1)
        direction =
          robot.x > previous.confirmed.x
            ? "right"
            : robot.x < previous.confirmed.x
              ? "left"
              : robot.y > previous.confirmed.y
                ? "up"
                : "down";
      if (
        previous &&
        previous.tick === tick &&
        previous.factoryID === factoryID &&
        previous.stepMs === stepMs &&
        previous.confirmed.x === robot.x &&
        previous.confirmed.y === robot.y &&
        !snap
      ) {
        previous.revision = revision;
        continue;
      }
      this.tracks.set(robot.id, {
        tick,
        revision,
        factoryID,
        stepMs,
        confirmed,
        direction,
        from: continuous ? this.sample(robot.id, now)! : confirmed,
        to: confirmed,
        startedAt: now,
        duration: continuous ? stepMs : 0,
      });
      this.dirty.add(robot.id);
    }
    this.suspended = paused || hidden;
  }
  sample(id: string, now: number): RobotVisualPosition | undefined {
    const track = this.tracks.get(id);
    if (!track) return undefined;
    const phase = track.duration
      ? Math.min(1, Math.max(0, (now - track.startedAt) / track.duration))
      : 1;
    return {
      x: track.from.x + (track.to.x - track.from.x) * phase,
      y: track.from.y + (track.to.y - track.from.y) * phase,
      direction: track.direction,
      moving: phase < 1,
    };
  }
  paint(
    now: number,
    draw: (id: string, position: RobotVisualPosition) => void,
  ) {
    let moving = false;
    for (const id of this.dirty) {
      const position = this.sample(id, now);
      if (!position) {
        this.dirty.delete(id);
        continue;
      }
      draw(id, position);
      if (position.moving) moving = true;
      else this.dirty.delete(id);
    }
    return moving;
  }
  settle() {
    if (this.suspended) return;
    for (const [id, track] of this.tracks) {
      track.from = track.to;
      track.duration = 0;
      this.dirty.add(id);
    }
    this.suspended = true;
  }
}
