import type { LocalFactory } from "./state";
import {
  catalog,
  buildingDefinitions,
  itemDefinitions,
  selectedRecipe,
  itemID,
} from "./catalog";
import { count, canAddAll } from "./inventory";
import { productionReady, canProcess } from "./production";
import { enabled } from "./transportConfig";
import { fuelAvailable } from "./fuel";
import { fuelValues } from "./fuel";
import { claimWork } from "./workLedger";
export type DiagnosticIssue = {
  building_id: string;
  name: string;
  x: number;
  y: number;
  kind: string;
  detail: string;
};
export function diagnoseFactory(f: LocalFactory) {
  const issues: DiagnosticIssue[] = [],
    rates = new Map<string, { input: number; output: number }>();
  for (const b of f.buildings) {
    const d = buildingDefinitions.get(b.building_type)!,
      m = f.simulation.buildings[b.id],
      r = selectedRecipe(b);
    const add = (kind: string, detail: string) =>
      issues.push({
        building_id: b.id,
        name: d.name,
        x: b.x,
        y: b.y,
        kind,
        detail,
      });
    const name = (id: string) => itemDefinitions.get(id)?.name ?? id;
    if (!enabled(b)) continue;
    if (r) {
      for (const [kind, values] of [
        ["input", r.inputs],
        ["output", r.outputs],
      ] as const)
        for (const [id, n] of Object.entries(values)) {
          const row = rates.get(id) ?? { input: 0, output: 0 };
          row[kind] += (n * 60000) / r.duration_ms;
          rates.set(id, row);
        }
      const missing = Object.entries(r.inputs).filter(
        ([id, n]) => count(m.input, id) < n,
      );
      if (missing.length)
        add(
          "缺料",
          missing
            .map(
              ([id, n]) =>
                `${name(id)} 缺 ${n - count(m.input, id)}（总仓库 ${f.simulation.warehouse[id] ?? 0}）`,
            )
            .join("；"),
        );
      const full = Object.entries(r.outputs).filter(
        ([id, n]) => count(m.output, id) + n > 100,
      );
      if (
        full.length ||
        !canAddAll(m.output, r.outputs, d.output_slots) ||
        productionReady(f, b) === "output_full"
      )
        add(
          "副产物 / 产物堵塞",
          full
            .map(
              ([id, n]) =>
                `${name(id)} ${count(m.output, id)} + 本批 ${n} > 100`,
            )
            .join("；") || "产物种类或累计制造数达上限；请疏通全部副产物",
        );
      if (!claimWork(f, r))
        add(
          "缺机器人作业记录",
          (r.conditions ?? [])
            .map(
              (c) =>
                `${c.type === "camera_task_history" ? "安装摄像头的视觉作业" : "匹配在岗机型"}每批需消耗 ${c.tasks_since_last_claim ?? c.min_verified_task_events ?? 0} 条实战记录`,
            )
            .join("；"),
        );
      if (canProcess(f, b, true) === "no_energy")
        add(
          "缺能",
          `额定功率 ${r.power_kw ?? 0} kW，当前已攒工作能量 ${m.work_energy_kj ?? 0} kJ；请检查所在组网动力源与燃料${d.energy === "heat" || d.id === "m20" ? `（可用燃料 ${fuelAvailable(m, d)} kJ）` : ""}`,
        );
      if (productionReady(f, b) === "locked")
        add("配方未解锁", "请检查当前阶段与前置首次制造里程碑");
    } else if (d.role === "production")
      add("未选配方", "请为设备选择已解锁的加工配方");
    if (
      [
        "blocked",
        "rejected",
        "no_source",
        "fluid_full",
        "mixed_fluid",
        "mixed",
        "no_network",
        "no_fuel",
        "no_medium",
        "no_connection",
        "output_full",
        "no_energy",
      ].includes(m.status) &&
      !(r && m.status === "no_energy")
    )
      add(
        "物流 / 能源等待",
        `${m.status}；请检查朝向、输入白名单、下游空位、流体介质与动力连接`,
      );
  }
  return {
    issues,
    rates: [...rates].map(([item, row]) => ({
      item,
      ...row,
      net: row.output - row.input,
    })),
    networks: f.simulation.networks ?? [],
    robots: (f.robots ?? []).filter(
      (r) => r.factory_id === f.id || r.transit?.to_factory_id === f.id,
    ),
  };
}
export function industryOutcome(f: LocalFactory) {
  const p = f.simulation.industry;
  return {
    stages: (catalog.stages ?? []).map((s) => ({
      ...s,
      manufactured: (p?.milestones ?? []).includes(s.milestone_item),
      complete:
        s.tier === 6
          ? (p?.milestones ?? []).includes(s.milestone_item)
          : !!catalog.quests?.some(
              (q) =>
                q.stage_final &&
                q.tier === s.tier &&
                p?.quests?.claimed.includes(q.id),
            ),
    })),
    complete: (p?.milestones ?? []).includes(catalog.stages![5].milestone_item),
    sandbox: (p?.crafted[itemID("可扩展智能工厂许可证")] ?? 0) > 0,
  };
}
export const sourceRecipes = new Map(
  catalog.items.map((i) => [
    i.id,
    catalog.recipes.filter((r) => !!r.outputs[i.id]),
  ]),
);
export const useRecipes = new Map(
  catalog.items.map((i) => [
    i.id,
    catalog.recipes.filter((r) => !!r.inputs[i.id]),
  ]),
);
export const specialUses = new Map(
  catalog.items.map((i) => [
    i.id,
    [
      ...catalog.buildings
        .filter((b) => b.item === i.id)
        .map((b) => `安装 ${b.name}`),
      ...catalog.buildings
        .filter((b) => fuelValues(b)[i.id])
        .map((b) => `${b.name} 燃料：${fuelValues(b)[i.id]} kJ / u`),
      ...(catalog.robots?.some((r) => r.item === i.id)
        ? ["可部署到兼容补能站上岗作业（在岗期间会从总仓库调用 1 台本体）"]
        : []),
      ...(i.id === itemID("摄像头组件")
        ? ["可在归属站给机器人加装视觉摄像头"]
        : []),
      ...(i.id === itemID("维修备件箱")
        ? ["机器人清理设备产物积压时的耗材"]
        : []),
      ...(i.id === itemID("液压工作液")
        ? ["注入液压动力站闭环回路的启动工作液"]
        : []),
    ],
  ]),
);
