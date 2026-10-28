import type { LocalFactory } from "./state";
import type { BuildingInstance, Simulation } from "../../api/client";
import { allDistricts } from "./world";
import { WAREHOUSE_WINDOW } from "./warehouseActivity";
export type WorldFrame = {
  base_revision: number;
  revision: number;
  tick: number;
  robots: LocalFactory["robots"];
  industry: Simulation["industry"];
  warehouse_activity?: {
    started_tick: number;
    bucket?: NonNullable<LocalFactory["warehouse_activity"]>["buckets"][number];
  };
  factories: {
    id: string;
    revision: number;
    simulation?: Simulation;
    buildings?: BuildingInstance[];
  }[];
};
export function worldFrame(
  before: LocalFactory,
  after: LocalFactory,
): WorldFrame {
  const old = new Map(allDistricts(before).map((f) => [f.id, f]));
  return {
    base_revision: before.revision,
    revision: after.revision,
    tick: after.simulation.tick,
    robots: after.robots,
    industry: after.simulation.industry,
    ...(after.warehouse_activity
      ? {
          warehouse_activity: {
            started_tick: after.warehouse_activity.started_tick,
            bucket:
              after.warehouse_activity.buckets.at(-1)?.tick ===
              after.simulation.tick
                ? after.warehouse_activity.buckets.at(-1)
                : undefined,
          },
        }
      : {}),
    factories: allDistricts(after).map((f) => {
      const p = old.get(f.id)!;
      const quiet =
        f !== after &&
        p.simulation.buildings === f.simulation.buildings &&
        Object.keys(p.simulation.warehouse).length ===
          Object.keys(f.simulation.warehouse).length &&
        Object.entries(p.simulation.warehouse).every(
          ([id, n]) => f.simulation.warehouse[id] === n,
        ) &&
        p.simulation.transfers === f.simulation.transfers;
      const { industry: _industry, ...simulation } = f.simulation;
      void _industry;
      return {
        id: f.id,
        revision: f.revision,
        ...(!quiet ? { simulation } : {}),
        ...(p.buildings !== f.buildings ? { buildings: f.buildings } : {}),
      };
    }),
  };
}
export function applyWorldFrame(
  previous: LocalFactory,
  frame: WorldFrame,
): LocalFactory {
  if (
    previous.revision !== frame.base_revision ||
    frame.revision !== frame.base_revision + 1 ||
    frame.tick !== previous.simulation.tick + 1
  )
    throw new Error("本地快照序列不一致，请刷新恢复最近存档");
  const updates = new Map(frame.factories.map((f) => [f.id, f]));
  if (
    updates.size !== frame.factories.length ||
    updates.size !== allDistricts(previous).length ||
    allDistricts(previous).some((f) => !updates.has(f.id))
  )
    throw new Error("厂区快照不完整");
  const merge = (f: LocalFactory): LocalFactory => {
    const u = updates.get(f.id)!;
    if (
      u.revision !== f.revision + 1 ||
      (u.simulation && u.simulation.tick !== frame.tick)
    )
      throw new Error("厂区快照时序不一致");
    return {
      ...f,
      revision: u.revision,
      buildings: u.buildings ?? f.buildings,
      simulation: u.simulation ?? { ...f.simulation, tick: frame.tick },
    };
  };
  const root = merge(previous);
  if (frame.warehouse_activity) {
    const buckets = (previous.warehouse_activity?.buckets ?? []).filter(
      (b) => b.tick > frame.tick - WAREHOUSE_WINDOW,
    );
    if (frame.warehouse_activity.bucket)
      buckets.push(frame.warehouse_activity.bucket);
    root.warehouse_activity = {
      started_tick: frame.warehouse_activity.started_tick,
      buckets,
    };
  }
  root.revision = frame.revision;
  root.robots = frame.robots;
  root.simulation = { ...root.simulation, industry: frame.industry };
  root.districts = previous.districts?.map(merge);
  return root;
}
