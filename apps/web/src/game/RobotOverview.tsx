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
            ? "发条搬运车可以在本厂的机器、料箱和仓库之间运送固体物品，每趟最多 4 件。先试一条短路线，再逐步代替重复手动搬料。"
            : "先选机器人，再安排运输或现场作业。不同机型使用不同的补能站，任务需要留出可走的通道。"}
        </p>
        <small>
          所有 WH
          已共用总仓库；机器和箱子里的物料仍要靠物流搬运。机器人用于现场作业，不需要为仓库之间同步库存。
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
            领取 P1 终局奖励进入 P2
            后，可制作发条搬运车和初级搬运站。当前先完成基础分拣与零件生产。
          </p>
        ) : (
          <ol className="operations-steps">
            <li>
              先制造机器人本体。部署会从总仓库取出 1 台；选中的机型是「
              {model?.name}」。
            </li>
            <li>
              在本厂放置
              {model?.energy === "shaft"
                ? "初级搬运站，用传动轴接到固燃传动机"
                : model?.energy === "hydraulic"
                  ? "液压机器人补给站，接通液压动力管"
                  : "机器人换电站，接通能量线缆"}
              。
            </li>
            <li>
              在站旁留出空格与通道。部署后即可安排任务，机器人会先补满能量再出发。
            </li>
          </ol>
        )}
      </section>
    </>
  );
}
