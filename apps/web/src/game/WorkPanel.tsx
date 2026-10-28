import type { FactoryDetail } from "../api/client";
import type { components } from "../api/schema";
import type { WorldAction } from "./local/world";
import { buildingDefinitions, catalog } from "./local/catalog";
import { matureIncident } from "./local/incidents";
import { ticksToSeconds } from "./local/simulationTime";
type Robot = components["schemas"]["RobotState"];
const names: Record<string, string> = {
  no_input: "原料不足",
  no_energy: "供能不足",
  output_full: "产物积压",
  fluid_full: "流体容器已满",
};
export default function WorkPanel({
  factory,
  robot,
  disabled,
  act,
}: {
  factory: FactoryDetail;
  robot?: Robot;
  disabled: boolean;
  act: (a: WorldAction) => void;
}) {
  const s = factory.simulation,
    rows = s?.industry?.work_receipts ?? [],
    spec = catalog.robots?.find((d) => d.item === robot?.item),
    busy = !!(
      robot?.task ||
      robot?.service ||
      robot?.construction ||
      robot?.cargo ||
      robot?.transit ||
      robot?.returning
    ),
    authorized = robot?.allowed_zones.includes(factory.id);
  const stage = s?.industry?.stage ?? 1,
    inspect = ["inspector", "smart"].includes(spec?.role ?? ""),
    repair = ["repair", "smart"].includes(spec?.role ?? ""),
    incidents = factory.buildings.filter(
      (b) =>
        s?.buildings[b.id]?.incident &&
        (inspect ||
          (repair && s.buildings[b.id].incident?.kind === "output_full")),
    );
  return (
    <fieldset className="robot-service-form">
      <legend>
        {inspect || repair ? "现场作业 · 选择要处理的设备" : "全厂作业记录"}
      </legend>
      <p>
        {(
          [
            ["freight", "搬运"],
            ["inspection", "巡检／维护"],
            ["visual", "视觉"],
          ] as const
        )
          .filter(([kind]) => kind !== "visual" || stage >= 5)
          .map(
            ([kind, name]) =>
              `${name} ${rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0)}`,
          )
          .join(" · ")}
      </p>
      {stage >= 4 && (
        <details className="operations-details">
          <summary>训练配方如何使用作业记录？</summary>
          <p>
            机器人每实打实地跑完一趟搬运、完成一次现场巡检或积压排障，都会攒下对应的实战记录（日常停靠和补能不算）。后续训练配方每批会消耗
            40 条搬运、20 条巡检/维护或 30 条视觉记录。
          </p>
          <p>
            想收集视觉记录，需要先在 P5
            造出摄像头组件，再等机器人停靠归属站时给它装上。
          </p>
        </details>
      )}
      {robot && stage >= 5 && (
        <button
          disabled={disabled || busy || (s?.industry?.stage ?? 1) < 5}
          onClick={() =>
            act({ type: "robot_camera", id: robot.id, equipped: !robot.camera })
          }
        >
          {robot.camera ? "在归属站卸下摄像头" : "在归属站安装 1 摄像头组件"}
        </button>
      )}
      {repair && (
        <p>
          每次疏通产物积压需消耗 1
          个维修备件箱。机器人会把堵在设备里的固体产物搬回仓库；如果中途取消任务，没用掉的备件箱也会一并带回。
        </p>
      )}
      {inspect && (
        <p>
          当设备连续停摆或报错满 5
          秒后，就能派机器人前去巡检并记下排障日志；不过缺料、缺电或管线堵塞本身还是需要你去接通解决。
        </p>
      )}
      {incidents.map((b) => {
        const incident = s!.buildings[b.id].incident!,
          mature = matureIncident(s!.buildings[b.id], s!.tick);
        return (
          <div key={b.id}>
            <strong>
              {buildingDefinitions.get(b.building_type)?.name} ({b.x},{b.y})
            </strong>
            <p>
              {names[incident.kind]} · 持续{" "}
              {ticksToSeconds(s!.tick - incident.since_tick)} 秒
              {incident.inspected ? " · 已巡检" : ""}
              {incident.maintained ? " · 已完成一次维护" : ""}
            </p>
            {inspect && (
              <button
                disabled={
                  disabled ||
                  busy ||
                  !robot ||
                  !authorized ||
                  !mature ||
                  incident.inspected ||
                  !["inspector", "smart"].includes(spec?.role ?? "")
                }
                onClick={() =>
                  act({
                    type: "robot_service",
                    id: robot!.id,
                    kind: "inspect",
                    target: { factory_id: factory.id, building_id: b.id },
                  })
                }
              >
                现场巡检
              </button>
            )}
            {repair && (
              <button
                disabled={
                  disabled ||
                  busy ||
                  !robot ||
                  !authorized ||
                  !mature ||
                  incident.kind !== "output_full" ||
                  !["repair", "smart"].includes(spec?.role ?? "")
                }
                onClick={() =>
                  act({
                    type: "robot_service",
                    id: robot!.id,
                    kind: "maintain",
                    target: { factory_id: factory.id, building_id: b.id },
                  })
                }
              >
                使用 1 备件箱清理积压
              </button>
            )}
          </div>
        );
      })}
      {(inspect || repair) && !incidents.length && (
        <p>
          本厂目前没有这台机器人可处理的异常。已运行设备出现的持续故障会列在这里。
        </p>
      )}
    </fieldset>
  );
}
