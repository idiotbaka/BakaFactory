import type { FactoryDetail } from "../api/client";
import type { components } from "../api/schema";
import type { WorldAction } from "./local/world";
import { buildingDefinitions, catalog } from "./local/catalog";
type Robot = components["schemas"]["RobotState"];
const names: Record<string, string> = {
  no_input: "运行后缺料",
  no_energy: "真实供能不足",
  output_full: "产物积压",
  fluid_full: "流体满容",
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
  return (
    <fieldset>
      <legend>真实作业与训练凭据</legend>
      <p>
        {(
          [
            ["freight", "搬运"],
            ["inspection", "巡检／维护"],
            ["visual", "视觉"],
          ] as const
        )
          .map(
            ([kind, name]) =>
              `${name} ${rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0)}`,
          )
          .join(" · ")}
      </p>
      <small>
        训练每批消费匹配机型的在岗凭据 40／20／30 次；摄像头需 P5
        实物。停靠、补能、取消与重复读取不记作业。
      </small>
      {robot && (
        <button
          disabled={disabled || busy || (s?.industry?.stage ?? 1) < 5}
          onClick={() =>
            act({ type: "robot_camera", id: robot.id, equipped: !robot.camera })
          }
        >
          {robot.camera ? "在归属站卸下摄像头" : "在归属站安装 1 摄像头组件"}
        </button>
      )}
      <p>
        维护装载 1
        维修备件箱；成功清走一载重真实积压后消耗。现场已恢复则不计奖，未用备件随机器人实际返站后退回。
      </p>
      {factory.buildings
        .filter((b) => s?.buildings[b.id]?.incident)
        .map((b) => {
          const incident = s!.buildings[b.id].incident!,
            mature = s!.tick - incident.since_tick >= 5;
          return (
            <div key={b.id}>
              <strong>
                {buildingDefinitions.get(b.building_type)?.name} ({b.x},{b.y})
              </strong>
              <p>
                {names[incident.kind]} · 持续 {s!.tick - incident.since_tick} 秒
                {incident.inspected ? " · 已巡检" : ""}
                {incident.maintained ? " · 本次维护已记账" : ""}
              </p>
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
                携备件清理积压
              </button>
            </div>
          );
        })}
      {!factory.buildings.some((b) => s?.buildings[b.id]?.incident) && (
        <p>当前厂没有已记录的异常；新装空机不生成缺料巡检凭据。</p>
      )}
    </fieldset>
  );
}
