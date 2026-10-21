import {
  catalog,
  buildingDefinitions,
  itemID,
  recipeDefinitions,
  selectedRecipe,
} from "./catalog";
import { newMachine, type LocalFactory } from "./state";
import { stepWorld, allDistricts } from "./world";
import { worldFrame } from "./worldFrame";
import { adjacentCells } from "./robotRoutes";
export type BenchmarkOptions = {
  districts: number;
  machines: number;
  robots: number;
  ticks: number;
  warmup: number;
  seed: number;
  profile: "idle" | "production" | "mixed";
};
export function benchmarkFixture(o: BenchmarkOptions): LocalFactory {
  if (
    !Number.isInteger(o.districts) ||
    o.districts < 1 ||
    o.districts > 100 ||
    !Number.isInteger(o.machines) ||
    o.machines < 0 ||
    o.machines > 80 ||
    !Number.isInteger(o.robots) ||
    o.robots < 0 ||
    o.robots > 500 ||
    Math.ceil(o.robots / o.districts) > 40 ||
    !Number.isInteger(o.seed) ||
    o.seed < 1 ||
    o.seed > 2147483647 ||
    !["idle", "production", "mixed"].includes(o.profile)
  )
    throw new Error(
      "规模需 1～100 厂、每厂 0～80 机器、0～500 机器人且每厂至多 40；seed 为 1～2147483647",
    );
  const factories: LocalFactory[] = [],
    robots: NonNullable<LocalFactory["robots"]> = [];
  for (let i = 0; i < o.districts; i++) {
    const id = `benchmark-${o.seed}-${i}`,
      f: LocalFactory = {
        id,
        owner_id: "benchmark",
        name: `测量厂 ${i + 1}`,
        width: 21,
        height: 21,
        created_at: "2026-01-01T00:00:00Z",
        revision: 0,
        buildings: [],
        simulation: {
          tick: 0,
          tick_rate: 1,
          buildings: {},
          warehouse: { [itemID("基础铁板")]: 1000000 },
          transfers: [],
        },
      };
    const add = (type: string, x: number, y: number) => {
      const b = {
        id: `${id}:${f.buildings.length}`,
        factory_id: id,
        building_type: type,
        x,
        y,
        rotation: 0 as const,
        configuration: {},
      };
      f.buildings.push(b);
      f.simulation.buildings[b.id] = newMachine();
      return b;
    };
    const wh = add("bus", 0, 0);
    f.simulation.buildings[wh.id].status = "warehouse";
    for (const side of [0, 90, 180, 270])
      wh.configuration = {
        ...wh.configuration,
        [`face_${side}`]: { mode: "output", filter: itemID("基础铁板") },
      };
    const sites = Array.from({ length: 121 }, (_, n) => ({
      x: -10 + (n % 11) * 2,
      y: -10 + Math.floor(n / 11) * 2,
    })).filter((p) => p.x || p.y);
    const take = () => sites.shift()!;
    let seed = (o.seed + i) >>> 0;
    for (let n = sites.length - 1; n > 0; n--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (n + 1);
      [sites[n], sites[j]] = [sites[j], sites[n]];
    }
    if (o.profile !== "idle")
      for (let n = 0; n < o.machines; n++) {
        const p = take(),
          b = add(
            o.profile === "mixed" && n % 4 === 0 ? "m05" : "m03",
            p.x,
            p.y,
          );
        const r =
          b.building_type === "m03"
            ? recipeDefinitions.get("r1007")!
            : catalog.recipes.find(
                (r) => r.building_type === "m05" && !r.legacy,
              )!;
        b.configuration = { recipe_id: r.id };
      }
    const botCount =
      o.profile === "mixed"
        ? Math.floor(o.robots / o.districts) +
          (i < o.robots % o.districts ? 1 : 0)
        : 0;
    if (botCount) {
      const p = take(),
        box = add("chest", p.x, p.y),
        stations: typeof f.buildings = [];
      for (let n = 0; n < botCount; n++) {
        const occupied = (p: { x: number; y: number }) =>
          f.buildings.some((b) => b.x === p.x && b.y === p.y) ||
          robots.some(
            (r) => r.factory_id === id && r.x === p.x && r.y === p.y,
          ) ||
          Math.abs(p.x) > 10 ||
          Math.abs(p.y) > 10;
        let station = stations.find((s) =>
          adjacentCells(s).some((p) => !occupied(p)),
        );
        if (!station) {
          const p = take();
          station = add("charge_station", p.x, p.y);
          stations.push(station);
          f.simulation.buildings[station.id].station_energy_kj = 30000;
        }
        const point = adjacentCells(station).find((p) => !occupied(p));
        if (!point)
          throw new Error("此测量规模无法部署全部机器人，请减少每厂数量");
        robots.push({
          id: `robot:${i}:${n}`,
          item: itemID("智能机器人"),
          home_factory_id: id,
          home_station: station.id,
          factory_id: id,
          ...point,
          energy_kj: 30000,
          enabled: true,
          allowed_zones: [id],
          priority: 3,
          cooldown: 0,
          status: "charged",
          task: {
            id: `task:${i}:${n}`,
            source: { factory_id: id, building_id: wh.id },
            target: { factory_id: id, building_id: box.id },
            item: itemID("基础铁板"),
            count: 1,
            channel: "auto",
            repeat: true,
            phase: "pickup",
            delivered: 0,
          },
        });
      }
    }
    factories.push(f);
  }
  const root = factories[0];
  root.districts = factories.slice(1);
  root.active_district_id = root.id;
  root.robots = robots;
  root.simulation.industry = {
    stage: 6,
    milestones: catalog.stages!.slice(0, 5).map((s) => s.milestone_item),
    crafted: {},
  };
  return root;
}
function replenish(root: LocalFactory) {
  for (const f of allDistricts(root))
    for (const b of f.buildings) {
      const r = selectedRecipe(b);
      if (!r) continue;
      const m = f.simulation.buildings[b.id];
      m.input = Object.entries(r.inputs).map(([item]) => ({
        item,
        count: 100,
      }));
      m.output = [];
      if (buildingDefinitions.get(b.building_type)?.energy === "heat")
        m.fuel = [{ item: itemID("固体燃料块"), count: 100 }];
    }
}
export function runBenchmark(o: BenchmarkOptions) {
  if (
    !Number.isInteger(o.ticks) ||
    o.ticks < 1 ||
    o.ticks > 600 ||
    !Number.isInteger(o.warmup) ||
    o.warmup < 0 ||
    o.warmup > 60
  )
    throw new Error("ticks 需 1～600，warmup 需 0～60");
  let root = benchmarkFixture(o);
  const durations: number[] = [],
    frames: number[] = [],
    full: number[] = [],
    frameTimes: number[] = [],
    cloneTimes: number[] = [];
  for (let i = -o.warmup; i < o.ticks; i++) {
    // Synthetic stock maintenance is outside the measured transition; this is
    // a steady workload fixture, not an actual-play economic claim.
    replenish(root);
    const before = root,
      t = performance.now();
    root = stepWorld(root);
    const end = performance.now();
    if (i >= 0) {
      durations.push(end - t);
      let start = performance.now();
      const frame = worldFrame(before, root);
      structuredClone(frame);
      frameTimes.push(performance.now() - start);
      start = performance.now();
      structuredClone(root);
      cloneTimes.push(performance.now() - start);
      frames.push(new TextEncoder().encode(JSON.stringify(frame)).length);
      full.push(new TextEncoder().encode(JSON.stringify(root)).length);
    }
  }
  const stats = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return {
      mean: xs.reduce((a, b) => a + b, 0) / xs.length,
      p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
      p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
      max: sorted.at(-1),
    };
  };
  return {
    options: o,
    scope:
      "纯模拟 / 增量生成和 structuredClone；不含 Worker 调度、DOM、浏览器 FPS、IndexedDB 或网络",
    fixture:
      "固定种子生成标识与布局；合成已付能量 / 实物，机器缓存于计时外补足 / 腾空，不读真实存档",
    actual: {
      districts: allDistricts(root).length,
      buildings: allDistricts(root).reduce((n, f) => n + f.buildings.length, 0),
      robots: root.robots?.length ?? 0,
      statuses: Object.fromEntries(
        [...new Set((root.robots ?? []).map((r) => r.status))].map((s) => [
          s,
          root.robots!.filter((r) => r.status === s).length,
        ]),
      ),
    },
    tick_ms: stats(durations),
    frame_and_clone_ms: stats(frameTimes),
    full_clone_ms: stats(cloneTimes),
    frame_json_bytes: stats(frames),
    full_json_bytes: stats(full),
    sampling:
      "每个有效 tick 一个样本；样本有限，不能用平均值保证任意设备的 1 TPS",
  };
}
