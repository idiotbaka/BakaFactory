import { useState } from "react";
import type { FactoryDetail } from "../api/client";
import { buildingDefinitions } from "./local/catalog";
import { fuelAvailable } from "./local/fuel";

const systems = [
  {
    kind: "shaft",
    tier: 2,
    name: "机械动力",
    line: "传动轴",
    source: "固燃传动机",
    intro: "把燃料变成转动，让机械产线和发条车补能站运转。",
    steps: [
      "建造固燃传动机，向燃料槽加入干燥生物质、生物炭或固体燃料块。",
      "从动力机旁铺传动轴，接到需要机械动力的机器或初级搬运站旁。",
      "机器还需要原料和可用的产物空间；缺料或堵塞时不会申请生产动力。",
    ],
  },
  {
    kind: "hydraulic",
    tier: 3,
    name: "液压动力",
    line: "液压动力管",
    source: "液压动力站",
    intro: "用液压驱动更重的设备，也为液压机器人补能。",
    steps: [
      "建造液压动力站，注入至少 1 u 液压工作液，再加入液体燃料。",
      "用液压动力管连接用能设备和液压机器人补给站。",
      "液压动力管传递动力；运输水、油和蒸汽，请另铺流体管道。",
    ],
  },
  {
    kind: "electric",
    tier: 4,
    name: "电力",
    line: "能量线缆",
    source: "液体燃料发电机",
    intro: "为电动产线、换电站和精密设备供电，储能箱可缓冲供需波动。",
    steps: [
      "给液体燃料发电机补充液体燃料。",
      "用能量线缆连接用电设备、机器人换电站和储能箱。",
      "优先保证关键供料设备；电量不足时，可在设备检视中调整优先级。",
    ],
  },
] as const;

export default function EnergyOverview({
  factory,
}: {
  factory: FactoryDetail;
}) {
  const stage = factory.simulation?.industry?.stage ?? 1,
    networks = factory.simulation?.networks ?? [],
    available = systems.filter((s) => s.tier <= stage);
  const [chosen, setChosen] = useState<string>();
  const selected =
    chosen === "manual"
      ? "manual"
      : (available.find((s) => s.kind === chosen)?.kind ??
        available[available.length - 1]?.kind ??
        "manual");
  const system = available.find((s) => s.kind === selected),
    rows = networks.filter((n) => n.kind === system?.kind),
    sum = (key: "capacity_kw" | "demand_kw" | "supplied_kw" | "stored_kj") =>
      rows.reduce((total, n) => total + n[key], 0),
    heat = factory.buildings.filter(
      (b) => buildingDefinitions.get(b.building_type)?.energy === "heat",
    );
  return (
    <section className="power-overview" aria-label="能源总览">
      <header className="operations-hero">
        <span className="operations-kicker">POWER CONTROL · P{stage}</span>
        <h3>
          {system
            ? `${system.name} · 从这里接通产线`
            : "BAKA-01 · 本厂最初的动力源"}
        </h3>
        <p>
          {system?.intro ??
            "接线？不用。启动？伸出夹爪。今天的零件，也拜托你啦~"}
        </p>
        <small>
          这里显示「{factory.name}
          」的能源。各厂区的动力线路独立，仓库共用不会自动接通供能。
        </small>
      </header>
      <nav className="operations-tabs" aria-label="能源类型">
        <button
          aria-pressed={selected === "manual"}
          onClick={() => setChosen("manual")}
        >
          手工动力<span>P1</span>
        </button>
        {systems.map((s) => (
          <button
            key={s.kind}
            disabled={s.tier > stage}
            title={s.tier > stage ? `解锁 P${s.tier} 后可用` : undefined}
            aria-pressed={s.kind === selected}
            onClick={() => setChosen(s.kind)}
          >
            {s.name}
            <span>P{s.tier}</span>
          </button>
        ))}
      </nav>
      {selected === "manual" && (
        <section className="operations-card" aria-label="手工动力自评">
          <h4>BAKA-01 自评报告</h4>
          <div className="power-summary">
            <span>
              可用功率<strong>两只夹爪，全力以赴</strong>
            </span>
            <span>
              剩余能量<strong>还能再拧一颗螺丝！</strong>
            </span>
            <span>
              散热方式<strong>盯着垃圾堆发呆</strong>
            </span>
            <span>
              供能范围<strong>工作室，谢绝外借</strong>
            </span>
          </div>
          <p>
            以上为夹爪自评，不接入动力网。炉子仍需另加燃料，不能靠热情烧起来哦~
          </p>
        </section>
      )}
      {system && (
        <>
          <section
            className="operations-card"
            aria-label={`${system.name}搭建指南`}
          >
            <h4>连接顺序</h4>
            <div className="operations-flow">
              <span>{system.source}</span>
              <b aria-hidden="true">→</b>
              <span>{system.line}</span>
              <b aria-hidden="true">→</b>
              <span>机器 / 补能站</span>
            </div>
            <ol className="operations-steps">
              {system.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <div className="power-summary" aria-label={`${system.name}网络合计`}>
            <span>
              合计可用功率<strong>{sum("capacity_kw")} kW</strong>
            </span>
            <span>
              机器申请功率<strong>{sum("demand_kw")} kW</strong>
            </span>
            <span>
              上一秒已供能<strong>{sum("supplied_kw")} kJ</strong>
            </span>
            <span>
              {system.kind === "electric" ? "电池存量" : "独立网络"}
              <strong>
                {system.kind === "electric"
                  ? `${sum("stored_kj").toLocaleString()} kJ`
                  : `${rows.length} 个`}
              </strong>
            </span>
          </div>
          <section
            className="operations-section"
            aria-label={`${system.name}网络列表`}
          >
            <header className="operations-section-heading">
              <h4>本厂网络</h4>
              <span>{rows.length} 个</span>
            </header>
            <p className="operations-note">
              不同网络之间不能借用动力。请逐个检查供需；kW 是每秒的供能能力，kJ
              是已经交付或储存的能量。
            </p>
            {!rows.length && (
              <div className="operations-empty">
                <strong>还没有接好的{system.name}网</strong>
                <p>
                  在{system.source}旁放一段{system.line}
                  ，再沿线接到设备旁；下一秒会显示网络数据。
                </p>
              </div>
            )}
            {rows.map((n, index) => (
              <article className="power-network-card" key={n.id}>
                <h4>
                  {system.name}网 {index + 1}
                  <span
                    className={`operations-badge${n.capacity_kw < n.demand_kw ? " is-warning" : ""}`}
                  >
                    {n.demand_kw === 0
                      ? "暂无用能申请"
                      : n.capacity_kw === 0
                        ? "等待供能"
                        : n.capacity_kw < n.demand_kw
                          ? "供给不足"
                          : "已接入"}
                  </span>
                </h4>
                <p>
                  {n.producers} 个动力源 · {n.consumers} 个正在申请动力的设备
                </p>
                <dl>
                  <div>
                    <dt>可用 / 申请功率</dt>
                    <dd>
                      {n.capacity_kw} / {n.demand_kw} kW
                    </dd>
                  </div>
                  <div>
                    <dt>上一秒已供能</dt>
                    <dd>{n.supplied_kw} kJ</dd>
                  </div>
                </dl>
                <details className="operations-details">
                  <summary>网络参数</summary>
                  <dl>
                    <div>
                      <dt>上一秒传动损耗</dt>
                      <dd>{n.loss_kw} kJ</dd>
                    </div>
                    {system.kind === "electric" && (
                      <>
                        <div>
                          <dt>上一秒充电 / 放电</dt>
                          <dd>
                            {n.charge_kw} / {n.discharge_kw} kJ
                          </dd>
                        </div>
                        <div>
                          <dt>电池储能</dt>
                          <dd>{n.stored_kj.toLocaleString()} kJ</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </details>
              </article>
            ))}
          </section>
        </>
      )}
      <section className="operations-card" aria-label="炉体燃料">
        <h4>炉子单独烧燃料</h4>
        <p>
          炭化炉、熔炼炉和蒸汽锅炉使用自己的燃料槽。配方原料与燃料分开添加；自动补燃料时，把投料机的目标缓存设为“炉体或动力机燃料”。
        </p>
        <div className="energy-heat-list">
          {heat.map((b) => {
            const d = buildingDefinitions.get(b.building_type)!,
              m = factory.simulation?.buildings[b.id];
            return (
              <article key={b.id}>
                <strong>
                  {d.name}{" "}
                  <small>
                    ({b.x},{b.y})
                  </small>
                </strong>
                <span>可用热量 {m ? fuelAvailable(m, d) : 0} kJ</span>
                <small>
                  {b.configuration.enabled === false
                    ? "设备已暂停"
                    : m?.status === "no_energy" || m?.status === "no_fuel"
                      ? "请补充燃料"
                      : m?.status === "output_full"
                        ? "请运走产物"
                        : m?.status === "no_input"
                          ? "请补充配方原料"
                          : m?.status === "working"
                            ? "加工中"
                            : "选择设备可查看配方与燃料"}
                </small>
              </article>
            );
          })}
        </div>
        {!heat.length && <small>本厂尚未放置烧燃料的炉子。</small>}
      </section>
      {system && (
        <details className="operations-details">
          <summary>供能不足时怎么处理？</summary>
          <ul className="operations-steps">
            <li>
              先检查动力源是否有燃料、线路是否连续，设备旁是否接上了正确的线路。
            </li>
            <li>
              检查同一网络的用能申请；加动力源、缩短传动轴，或暂停暂时不用的动力物流。
            </li>
            <li>
              设备优先级 1
              最高。动力不足时，设备会先积攒能量再加工，因此可能变慢。
            </li>
            <li>
              设备不会替你连接两条分开的网络；需要指定接入方向时，在设备检视中选择供能连接侧。
            </li>
          </ul>
        </details>
      )}
      {system?.kind === "electric" && (
        <details className="operations-details">
          <summary>储能箱：容量、损耗与备用电量</summary>
          <ul className="operations-steps">
            <li>
              有剩余发电时自动充电，供电不够时放电；也可在设备检视中设为只充、只放或保留。
            </li>
            <li>
              充电效率为 88%：输入 100 kJ，约存下 88
              kJ。充电和放电的功率上限各为 100 kW。
            </li>
            <li>
              电池只接收发电机的剩余电能，不会互相充电，也不会在同一秒一边充一边放。
            </li>
            <li>设定备用电量后，只有优先级 1 的设备能动用这部分储备。</li>
          </ul>
        </details>
      )}
    </section>
  );
}
