import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RobotPanel from "./RobotPanel";
import {
  createWorld,
  editWorld,
  actWorld,
  projectFactory,
  districtSummary,
} from "./local/world";
import { buildingDefinitions, catalog, itemID } from "./local/catalog";
import { openGameSelect } from "../test/gameSelect";

const user = {
  id: "robot-guide",
  username: "robot-guide",
  display_name: "搬运",
  created_at: "now",
  last_login_at: "now",
};
function fixture() {
  let root = createWorld(user, "P2 搬运场");
  root.simulation.industry!.stage = 2;
  root.simulation.industry!.milestones = ["i0060"];
  root.simulation.warehouse[buildingDefinitions.get("m18")!.item!] = 1;
  root = editWorld(root, {
    kind: "place",
    id: "station",
    building_type: "m18",
    placement: { x: 3, y: 0, rotation: 0 },
  });
  root.simulation.warehouse[itemID("发条搬运车")] = 1;
  root = actWorld(root, {
    type: "robot_deploy",
    id: "cart",
    item: itemID("发条搬运车"),
    factory_id: root.id,
    station: "station",
  });
  root.simulation.warehouse[buildingDefinitions.get("chest")!.item!] = 1;
  root = editWorld(root, {
    kind: "place",
    id: "box",
    building_type: "chest",
    placement: { x: 5, y: 0, rotation: 0 },
  });
  return root;
}
describe("robot onboarding and task controls", () => {
  it("filters the fleet by model pinyin, initials or the existing robot ID without issuing commands", () => {
    const root = fixture(),
      act = vi.fn();
    render(
      <RobotPanel
        factory={projectFactory(root)}
        catalog={catalog}
        districts={districtSummary(root)}
        disabled={false}
        act={act}
      />,
    );
    const search = screen.getByLabelText("查找机器人");
    for (const query of ["fatiaobanyunche", "ftbyc", "banyun", "cart"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByRole("button", { name: /cart/ })).toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: "nonexistent" } });
    expect(
      screen.queryByRole("button", { name: /cart/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /cart/ })).toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
  });
  it("keeps P2 focused on local hauling and preserves the actual task payload", () => {
    const root = fixture(),
      act = vi.fn(),
      before = structuredClone(root);
    render(
      <RobotPanel
        factory={projectFactory(root)}
        catalog={catalog}
        districts={districtSummary(root)}
        disabled={false}
        act={act}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "第一台发条车，从短途搬运开始" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "机器人上手指南" }),
    ).toHaveTextContent("初级搬运站");
    const deployment = openGameSelect(screen.getByLabelText("部署机器人类型"));
    expect(deployment.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText("搜索物品"), { key: "Escape" });
    expect(screen.queryByLabelText("取货厂区")).not.toBeInTheDocument();
    expect(screen.queryByText("作业记录与训练")).not.toBeInTheDocument();
    expect(screen.queryByText("蓝图施工 · 安装设备")).not.toBeInTheDocument();
    fireEvent.click(
      openGameSelect(screen.getByLabelText("取货位置")).getByRole("option", {
        name: `${buildingDefinitions.get("chest")!.name} (5,0)`,
      }),
    );
    fireEvent.click(
      openGameSelect(screen.getByLabelText("交货位置")).getByRole("option", {
        name: "工厂仓库 (0,0)",
      }),
    );
    fireEvent.change(screen.getByLabelText("机器人运输数量"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "安排运输任务" }));
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "robot_task",
        id: "cart",
        count: 4,
        source: { factory_id: root.id, building_id: "box" },
        target: { factory_id: root.id, building_id: root.buildings[0].id },
      }),
    );
    expect(root).toEqual(before);
  });
  it("retains read-only fleet controls while paused and prevents deployment or task edits", () => {
    const root = fixture(),
      act = vi.fn();
    render(
      <RobotPanel
        factory={projectFactory(root)}
        catalog={catalog}
        districts={districtSummary(root)}
        disabled
        act={act}
      />,
    );
    expect(
      screen.getByRole("button", { name: "部署 1 台机器人" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "安排运输任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停机器人" })).toBeDisabled();
    expect(screen.getByLabelText("查找机器人")).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("世界已暂停");
    expect(act).not.toHaveBeenCalled();
  });
});
