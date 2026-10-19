import type { MachineState } from "../api/client";
export type Point = { x: number; y: number };
export type Motion = { points: Point[]; startedAt: number; duration: number };
export function productionProgress(
  machine: MachineState,
  phase: number,
): number {
  const extra =
    machine.status === "working" ? Math.min(1, Math.max(0, phase)) : 0;
  return Math.min(machine.duration, Math.max(0, machine.progress + extra));
}
export function sampleMotion(motion: Motion, now: number): Point {
  const points = motion.points;
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total === 0) return points[points.length - 1];
  let remaining =
    total *
    Math.min(
      1,
      Math.max(0, (now - motion.startedAt) / Math.max(1, motion.duration)),
    );
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const fraction = remaining / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * fraction,
        y: points[i].y + (points[i + 1].y - points[i].y) * fraction,
      };
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}
