import { describe, it, expect } from "vitest";
import { catalog, buildingDefinitions, itemID } from "./catalog";
import {
  actWorld,
  createWorld,
  editWorld,
  stepWorld,
  projectFactory,
} from "./world";
import { previewRobotRoute } from "./robotNavigation";
import {
  robotBusy,
  robotAtHome,
  requiredRobotZones,
  robotStateHint,
} from "./robotLifecycle";
import { toSave, validateSave, type LocalFactory } from "./state";

const user = {
  id: "navigation-owner",
  username: "navigation-owner",
  display_name: "调度员",
  created_at: "now",
  last_login_at: "now",
};
const smart = itemID("智能机器人"),
  iron = itemID("基础铁板");
function setup(peers = 1) {
  let root = createWorld(user, "路线现场");
  root.simulation.industry!.stage = 6;
  root.simulation.industry!.quests!.completed.push("p1_free_hands");
  root.simulation.industry!.quests!.claimed.push("p1_free_hands");
  root.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  for (const [id, type, x, y] of [
    ["station", "charge_station", 4, 0],
    ["box", "chest", 8, 3],
  ] as const) {
    root.simulation.warehouse[buildingDefinitions.get(type)!.item!] = 1;
    root = editWorld(root, {
      kind: "place",
      id,
      building_type: type,
      placement: { x, y, rotation: 0 },
    });
  }
  root.simulation.warehouse[smart] = peers;
  root.simulation.warehouse[iron] = 8;
  root.buildings[0].configuration.face_0 = { mode: "output", filter: iron };
  for (let i = 0; i < peers; i++) {
    root = actWorld(root, {
      type: "robot_deploy",
      id: `r${i}`,
      item: smart,
      station: "station",
      factory_id: root.id,
    });
    // Paid-energy fixture; station conversion is tested separately.
    root.robots![i].energy_kj = 30000;
  }
  return root;
}
function assign(root: LocalFactory, target = root.id) {
  return actWorld(root, {
    type: "robot_task",
    id: "r0",
    task_id: "route",
    source: { factory_id: root.id, building_id: root.buildings[0].id },
    target: {
      factory_id: target,
      building_id:
        target === root.id
          ? "box"
          : root.districts!.find((f) => f.id === target)!.buildings[0].id,
    },
    item: iron,
    count: 1,
    channel: "auto",
    repeat: false,
  });
}
function until(root: LocalFactory, condition: (f: LocalFactory) => boolean) {
  for (let i = 0; i < 120 && !condition(root); i++) root = stepWorld(root);
  expect(condition(root)).toBe(true);
  return root;
}
describe("robot navigation and lifecycle integration", () => {
  it("explains retained energy returns without promising a cancelled single freight will restart", () => {
    const root = assign(setup()),
      r = root.robots![0];
    r.returning = "energy";
    r.cargo = { item: iron, count: 1 };
    r.task!.phase = "deliver";
    expect(robotStateHint(r)).toContain("本次任务不会重新派发");
    r.task!.repeat = true;
    expect(robotStateHint(r)).toContain("保留的任务补满后可继续");
    r.enabled = false;
    expect(robotStateHint(r)).toContain("启用后");
    expect(robotStateHint(r, true)).toContain("世界已暂停");
  });
  it("previews the actual next action without changing stock, revision, receipts or saved state", () => {
    let root = assign(setup());
    const before = structuredClone(root),
      route = previewRobotRoute(root, "r0")!;
    expect(route.status).toBe("ready");
    expect(route.points.length).toBeGreaterThan(1);
    expect(root).toEqual(before);
    root = stepWorld(root);
    expect(root.robots![0]).toMatchObject(route.points[1]);
    expect(root.robots![0].energy_kj).toBe(before.robots![0].energy_kj - 1);
    expect(previewRobotRoute(root, "missing")).toBeUndefined();
  });
  it("distinguishes an occupied dock from a structural blockage without spending waiting energy", () => {
    let root = assign(setup(2));
    root.robots![1].x = 1;
    root.robots![1].y = 0;
    root.robots![1].enabled = false;
    expect(previewRobotRoute(root, "r0")?.status).toBe("congested");
    root = stepWorld(root);
    expect(root.robots![0].status).toBe("congested");
    expect(root.robots![0].energy_kj).toBe(30000);
    root.robots![1].x = 2;
    root.simulation.warehouse[buildingDefinitions.get("chest")!.item!] = 1;
    root = editWorld(root, {
      kind: "place",
      id: "dock-wall",
      building_type: "chest",
      placement: { x: 1, y: 0, rotation: 0 },
    });
    expect(previewRobotRoute(root, "r0")?.status).toBe("no_path");
    expect(stepWorld(root).robots![0].status).toBe("no_path");
  });
  it("locks active zones atomically and releases unused authorization after physical return", () => {
    let root = setup();
    const away = root.districts![0].id;
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id, away],
    });
    root = assign(root, away);
    expect(requiredRobotZones(root.robots![0])).toEqual(
      new Set([root.id, away]),
    );
    const before = structuredClone(root);
    expect(() =>
      actWorld(root, {
        type: "robot_config",
        id: "r0",
        allowed_zones: [root.id],
      }),
    ).toThrow();
    expect(root).toEqual(before);
    root = until(root, (f) => !!f.robots![0].transit);
    root = actWorld(root, { type: "robot_return", id: "r0" });
    expect(requiredRobotZones(root.robots![0]).has(away)).toBe(true);
    root = until(root, (f) => !robotBusy(f.robots![0]));
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id],
    });
    expect(robotAtHome(root.robots![0], projectFactory(root))).toBe(true);
    expect(root.simulation.warehouse[iron]).toBe(8);
  });
  it("retains a paused in-transit cancellation and resumes it without a second withdrawal or reward", () => {
    let root = setup();
    const away = root.districts![0].id;
    root = actWorld(root, {
      type: "robot_config",
      id: "r0",
      allowed_zones: [root.id, away],
    });
    root = assign(root, away);
    root = until(root, (f) => !!f.robots![0].transit);
    root = actWorld(root, { type: "robot_config", id: "r0", enabled: false });
    root = actWorld(root, { type: "robot_return", id: "r0" });
    const held = structuredClone(root.robots![0]);
    for (let i = 0; i < 8; i++) root = stepWorld(root);
    expect(root.robots![0]).toMatchObject({
      transit: held.transit,
      cargo: held.cargo,
      energy_kj: held.energy_kj,
    });
    expect(robotStateHint(root.robots![0])).toContain("启用后");
    expect(previewRobotRoute(root, "r0")?.status).toBe("transit");
    root = validateSave(toSave(root), user.id);
    root = actWorld(root, { type: "robot_config", id: "r0", enabled: true });
    root = until(root, (f) => !robotBusy(f.robots![0]));
    expect(root.simulation.warehouse[iron]).toBe(8);
    expect(root.simulation.industry!.work_receipts ?? []).toEqual([]);
  });
  it("shows actual next destinations for construction, cargo recovery and deleted endpoints", () => {
    let root = setup();
    const item = buildingDefinitions.get("m03")!.item!;
    root.simulation.warehouse[item] = 1;
    root = actWorld(root, {
      type: "robot_construct",
      id: "r0",
      blueprint: {
        id: "site",
        factory_id: root.id,
        building_type: "m03",
        x: 7,
        y: 2,
        rotation: 0,
      },
    });
    expect(previewRobotRoute(root, "r0")?.target).toMatchObject({
      building_id: "site",
      x: 7,
      y: 2,
    });
    root = actWorld(root, { type: "robot_return", id: "r0" });
    expect(previewRobotRoute(root, "r0")?.target?.building_id).toBe(
      root.buildings[0].id,
    );
    expect(robotStateHint(root.robots![0], true)).toContain("世界已暂停");
    root = assign(setup());
    root = until(root, (f) => f.robots![0].task?.phase === "deliver");
    root = editWorld(root, { kind: "delete", id: "box" });
    expect(previewRobotRoute(root, "r0")?.status).toBe("missing");
    expect(stepWorld(root).robots![0].returning).toBe("invalid_target");
  });
});
