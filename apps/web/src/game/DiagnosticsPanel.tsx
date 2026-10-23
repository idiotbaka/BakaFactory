import { useMemo, useState } from "react";
import type { LocalFactory } from "./local/state";
import { catalog, itemDefinitions, buildingDefinitions } from "./local/catalog";
import {
  diagnoseFactory,
  industryOutcome,
  sourceRecipes,
  useRecipes,
  specialUses,
} from "./local/diagnostics";
import type { Observation } from "./local/observations";
import { robotStateHint } from "./local/robotLifecycle";
export default function DiagnosticsPanel({
  factory,
  observation,
  onLocate,
}: {
  factory: LocalFactory;
  observation?: Observation;
  onLocate?: (id: string) => void;
}) {
  const report = useMemo(() => diagnoseFactory(factory), [factory]),
    outcome = industryOutcome(factory);
  const [query, setQuery] = useState(""),
    [item, setItem] = useState(catalog.root_item ?? "");
  const items = catalog.items.filter(
    (i) =>
      !i.legacy &&
      `${i.name}${i.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = items.find((i) => i.id === item) ?? items[0];
  const number = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <section className="diagnostics-panel" aria-label="闭环诊断">
      <h3>六阶段成果与终局</h3>
      <ol>
        {outcome.stages.map((s) => (
          <li key={s.tier}>
            P{s.tier} {s.name}：
            {s.complete
              ? s.tier === 6
                ? "首次制造已达成"
                : "终局任务已领奖"
              : s.manufactured
                ? "已制造，待完成终局任务并领奖"
                : "尚未达成"}{" "}
            · {itemDefinitions.get(s.milestone_item)?.name}
          </li>
        ))}
      </ol>
      <p role="status">
        {outcome.complete
          ? "智能机器人已制造，六阶段主目标达成。继续部署、维护和优化工厂。"
          : "主目标：从垃圾回收到首次制造智能机器人。进入 P6 尚不等于完成主目标。"}
        {outcome.sandbox
          ? "可扩展智能工厂许可证已制造，沙盒优化目标达成。"
          : "可继续制造可扩展智能工厂许可证，完成后续沙盒目标。"}
      </p>
      <h3>当前厂区待处理 · {report.issues.length}</h3>
      <p>
        依据当前确认库存与配置诊断。缺料显示本区仓库，不自动借用远厂；新建空机的缺料提示不授予巡检凭据。
      </p>
      <ul>
        {report.issues.slice(0, 80).map((issue, i) => (
          <li key={`${issue.building_id}:${i}`}>
            <button
              onClick={() => onLocate?.(issue.building_id)}
              disabled={!onLocate}
            >
              {issue.name} ({issue.x},{issue.y})
            </button>{" "}
            · {issue.kind}
            <p>{issue.detail}</p>
          </li>
        ))}
      </ul>
      {report.issues.length > 80 && (
        <p>仅显示前 80 条，先处理当前问题后其余项目会继续显示。</p>
      )}
      <h3>实际制造与物流 · 最近 {observation?.ticks ?? 0} 个运行 tick</h3>
      <p>
        世界范围制造统计，最多 60 个有效 tick；刷新 /
        恢复云存档重置观察窗口，暂停不计秒。固体 /
        流体是逐格转移量，不能当作净产量；搬运按成功交空载荷计趟。
      </p>
      <p>
        固体转移 {observation?.solid ?? 0} u · 管线流出{" "}
        {observation?.fluid ?? 0} u · 完成搬运 {observation?.freight ?? 0} 趟
      </p>
      <ul>
        {Object.entries(observation?.produced ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40)
          .map(([id, n]) => (
            <li key={id}>
              {itemDefinitions.get(id)?.name}：制造 {n} ·{" "}
              {number((n * 60) / Math.max(1, observation?.ticks ?? 0))} u / 分钟
            </li>
          ))}
      </ul>
      <h3>当前厂区能源网络</h3>
      <ul>
        {report.networks.map((n) => (
          <li key={n.id}>
            {n.kind} · 需求 {n.demand_kw} / 实供 {n.supplied_kw} kW · 线路损耗{" "}
            {n.loss_kw} kW · 储能 {n.stored_kj} kJ · 充 / 放 {n.charge_kw} /{" "}
            {n.discharge_kw} kW
          </li>
        ))}
      </ul>
      {!report.networks.length && (
        <p>暂无导线网络；热能设备与蒸汽启动单独使用真实燃料。</p>
      )}
      <h3>当前厂区机器人等待</h3>
      <ul>
        {report.robots
          .filter(
            (r) =>
              !r.enabled ||
              [
                "no_path",
                "no_energy",
                "blocked",
                "rejected",
                "congested",
                "range_exceeded",
                "source_empty",
              ].includes(r.status),
          )
          .slice(0, 40)
          .map((r) => (
            <li key={r.id}>
              {r.id.slice(0, 8)}：{robotStateHint(r)}
            </li>
          ))}
      </ul>
      <h3>物品来源、去向与名义产能</h3>
      <label>
        查找物品
        <input
          aria-label="诊断物品搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="物品名或编号"
        />
      </label>
      <label>
        物品
        <select
          aria-label="诊断物品"
          value={selected?.id ?? ""}
          onChange={(e) => setItem(e.target.value)}
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <p>
            设施用途：
            {specialUses.get(selected.id)?.join("；") || "见下方配方用途"}
          </p>
          <p>
            本区仓 {factory.simulation.warehouse[selected.id] ?? 0}
            ；启用设备所选配方名义产出{" "}
            {number(
              report.rates.find((r) => r.item === selected.id)?.output ?? 0,
            )}{" "}
            / 消耗{" "}
            {number(
              report.rates.find((r) => r.item === selected.id)?.input ?? 0,
            )}{" "}
            u / 分钟。缺料 / 缺能 / 堵塞 / 训练条件会降低实际产出。
          </p>
          {(
            [
              ["来源", sourceRecipes],
              ["去向", useRecipes],
            ] as const
          ).map(([label, index]) => (
            <div key={label}>
              <h4>{label}</h4>
              <ul>
                {(index.get(selected.id) ?? []).map((r) => (
                  <li key={r.id}>
                    {r.id} · {buildingDefinitions.get(r.building_type)?.name} ·
                    P{r.tier} · {r.duration_ms / 1000} 秒：
                    {Object.entries(r.inputs)
                      .map(([id, n]) => `${itemDefinitions.get(id)?.name}×${n}`)
                      .join("、")}{" "}
                    →{" "}
                    {Object.entries(r.outputs)
                      .map(([id, n]) => `${itemDefinitions.get(id)?.name}×${n}`)
                      .join("、")}
                    {r.conditions?.length ? " · 需消费真实作业凭据" : ""}
                  </li>
                ))}
              </ul>
              {!index.get(selected.id)?.length && (
                <p>
                  {label === "来源" && selected.id === catalog.root_item
                    ? "拾荒 / 垃圾提取口是无限源头。"
                    : "没有对应配方；检查设备安装 / 燃料 / 附件用途。"}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
