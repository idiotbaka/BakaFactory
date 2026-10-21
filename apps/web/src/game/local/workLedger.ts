import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import { catalog } from "./catalog";
type Receipt = components["schemas"]["WorkReceipt"];
type Recipe = components["schemas"]["RecipeDefinition"];
type Robot = components["schemas"]["RobotState"];

export function recordWork(
  root: LocalFactory,
  r: Robot,
  kind: "freight" | "inspection",
) {
  const p = root.simulation.industry!;
  const rows = (p.work_receipts ??= []);
  for (const k of [kind, ...(r.camera ? ["visual" as const] : [])]) {
    const old = rows.find((e) => e.robot_id === r.id && e.kind === k);
    if (old) {
      old.count = Math.min(10000, old.count + 1);
      old.last_tick = root.simulation.tick;
    } else if (rows.length < 1500)
      rows.push({
        kind: k,
        robot_id: r.id,
        robot_item: r.item,
        count: 1,
        last_tick: root.simulation.tick,
      });
  }
}
function requirement(r: Recipe, c: NonNullable<Recipe["conditions"]>[number]) {
  if (c.type === "camera_task_history")
    return { kind: "visual", count: c.min_verified_task_events ?? 30 };
  if (c.type === "deployed_robot_active" && ["r5048", "r5049"].includes(r.id))
    return {
      kind: r.id === "r5048" ? "freight" : "inspection",
      count: c.tasks_since_last_claim ?? (r.id === "r5048" ? 40 : 20),
    };
}
// Probe and commit share the same allocation. Only successful batch completion
// consumes credit; sequential factory ticks cannot spend the same row twice.
export function claimWork(f: LocalFactory, r: Recipe, commit = false): boolean {
  if (!r.conditions?.length) return true;
  const rows = f.simulation.industry?.work_receipts ?? [],
    used = new Map<Receipt, number>();
  for (const c of r.conditions ?? []) {
    const need = requirement(r, c);
    if (!need) return false;
    let missing = need.count;
    for (const row of rows) {
      const robot = f.robots?.find(
        (bot) =>
          bot.id === row.robot_id && bot.item === row.robot_item && bot.enabled,
      );
      if (
        !robot ||
        row.kind !== need.kind ||
        (c.roles?.length && !c.roles.includes(robot.item)) ||
        (need.kind === "visual" && !robot.camera)
      )
        continue;
      const n = Math.min(missing, row.count - (used.get(row) ?? 0));
      used.set(row, (used.get(row) ?? 0) + n);
      missing -= n;
      if (!missing) break;
    }
    if (missing) return false;
  }
  if (commit && f.simulation.industry?.work_receipts) {
    for (const [row, n] of used) row.count -= n;
    f.simulation.industry.work_receipts = rows.filter((row) => row.count > 0);
  }
  return true;
}
export function validWorkReceipts(rows: unknown, tick: number): boolean {
  if (rows === undefined) return true;
  if (!Array.isArray(rows) || rows.length > 1500) return false;
  const seen = new Set<string>();
  for (const r of rows) {
    if (
      !r ||
      typeof r !== "object" ||
      Array.isArray(r) ||
      Object.keys(r).some(
        (k) =>
          !["kind", "robot_id", "robot_item", "count", "last_tick"].includes(k),
      ) ||
      !["freight", "inspection", "visual"].includes(r.kind) ||
      typeof r.robot_id !== "string" ||
      !r.robot_id.length ||
      r.robot_id.length > 128 ||
      !catalog.robots?.some((d) => d.item === r.robot_item) ||
      !Number.isSafeInteger(r.count) ||
      r.count < 1 ||
      r.count > 10000 ||
      !Number.isSafeInteger(r.last_tick) ||
      r.last_tick < 0 ||
      r.last_tick > tick
    )
      return false;
    const key = `${r.robot_id}:${r.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
