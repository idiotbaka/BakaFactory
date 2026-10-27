import type { Catalog, FactoryDetail } from "../api/client";
import { robotBusy } from "./local/robotLifecycle";

export const robotAttention = [
  "no_energy",
  "no_path",
  "congested",
  "blocked",
  "rejected",
  "source_empty",
  "range_exceeded",
];

export default function RobotOverview({
  factory,
  catalog,
  item,
}: {
  factory: FactoryDetail;
  catalog: Catalog;
  item?: string;
}) {
  const stage = factory.simulation?.industry?.stage ?? 1,
    robots = factory.robots ?? [],
    model = catalog.robots?.find((d) => d.item === item);
  return (
    <>
      <header className="operations-hero">
        <span className="operations-kicker">ROBOT OPERATIONS · P{stage}</span>
        <h3>
          {stage < 2
            ? "从 P2 开始，让机器人帮忙搬料"
            : stage === 2
              ? "第一台发条车，从短途搬运开始"
              : "为工厂安排一支作业机队"}
        </h3>
        <p>
          {stage <= 2
            ? "发条搬运车可以在厂内的机器、料箱和仓库之间来回跑腿，每趟最多搬 4 件固体物品。建议先试跑一条短途供料线，把双手从重复搬运里解放出来。"
            : "选中机器人即可指派搬运路线或现场巡检、排障任务。不同机型需要配套对应的补能站，记得在站口和目标设备旁留出落脚通道。"}
        </p>
        <small>
          各厂区的 WH
          仓库库存互通，不用派车在仓库之间倒货；机器人专门负责给现场机器补料、收货、巡检和排障。
        </small>
      </header>
      <div className="operations-metrics" aria-label="机队概况">
        <span>
          已部署<strong>{robots.length} / 500 台</strong>
        </span>
        <span>
          已派任务<strong>{robots.filter(robotBusy).length} 台</strong>
        </span>
        <span>
          需要查看
          <strong>
            {
              robots.filter(
                (r) => !r.enabled || robotAttention.includes(r.status),
              ).length
            }{" "}
            台
          </strong>
        </span>
      </div>
      <section className="operations-card" aria-label="机器人上手指南">
        <h4>{stage < 2 ? "先完成 P1 终局任务" : "第一次部署，按这三步准备"}</h4>
        {stage < 2 ? (
          <p>
            完成并领取 P1 终局奖励进入 P2
            后，就能制造发条搬运车和初级搬运站了。眼下先专心做好基础分拣与零件加工。
          </p>
        ) : (
          <ol className="operations-steps">
            <li>
              先造好机器人本体。每次部署会从总仓库调用 1 台（当前选中：「
              {model?.name}」）。
            </li>
            <li>
              在本厂放下
              {model?.energy === "shaft"
                ? "初级搬运站，并用传动轴连上固燃传动机"
                : model?.energy === "hydraulic"
                  ? "液压机器人补给站，并用闭环液压动力管接通液压站"
                  : "机器人换电站，并用能量线缆接入电网"}
              。
            </li>
            <li>
              在补能站紧邻的四向留出空地和过道。部署后就能派活，机器人会先在站旁充满能量再出发。
            </li>
          </ol>
        )}
      </section>
    </>
  );
}
