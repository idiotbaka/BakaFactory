import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import FactoryWorkspace from "./FactoryWorkspace";
import { useLocalGame } from "./local/useLocalGame";
import { catalog, buildingDefinitions, itemID } from "./local/catalog";
import {
  actWorld,
  createWorld,
  editWorld,
  projectFactory,
  districtSummary,
  type WorldAction,
} from "./local/world";
import { previewRobotRoute } from "./local/robotNavigation";
import type { GameRuntime } from "./local/runtime";

vi.mock("./local/useLocalGame", () => ({ useLocalGame: vi.fn() }));
const user = {
  id: "ui-owner",
  username: "ui-owner",
  display_name: "调度员",
  created_at: "now",
  last_login_at: "now",
};
const world = vi.fn(),
  edit = vi.fn();
function fixture(transit = false) {
  let root = createWorld(user, "导航工厂");
  root.simulation.industry!.stage = 6;
  root.simulation.industry!.quests!.completed.push("p1_free_hands");
  root.simulation.industry!.quests!.claimed.push("p1_free_hands");
  root.simulation.industry!.milestones = catalog
    .stages!.slice(0, 5)
    .map((s) => s.milestone_item);
  root.simulation.warehouse[buildingDefinitions.get("charge_station")!.item!] =
    1;
  root = editWorld(root, {
    kind: "place",
    id: "station",
    building_type: "charge_station",
    placement: { x: 4, y: 0, rotation: 0 },
  });
  root.simulation.warehouse[itemID("智能机器人")] = 1;
  root = actWorld(root, {
    type: "robot_deploy",
    id: "ui-robot",
    item: itemID("智能机器人"),
    station: "station",
    factory_id: root.id,
  });
  root.robots![0].energy_kj = 30000;
  if (transit) {
    root.robots![0].allowed_zones.push(root.districts![0].id);
    root.robots![0].x = 1;
    root.robots![0].y = 0;
    root.robots![0].transit = {
      to_factory_id: root.districts![0].id,
      x: 1,
      y: 0,
      remaining_ticks: 4,
    };
    root.robots![0].returning = "cancelled";
  }
  return root;
}
function prepare(transit = false, paused = false) {
  const initial = fixture(transit);
  vi.mocked(useLocalGame).mockImplementation(function useMockGame() {
    const [root, setRoot] = useState(initial);
    world.mockImplementation(async (action: WorldAction) => {
      const next = actWorld(root, action);
      setRoot(next);
      return projectFactory(next);
    });
    const runtime = {
      world,
      robotRoute: (id: string) => previewRobotRoute(root, id),
      commands: {
        placeBuilding: edit,
        updateBuilding: edit,
        deleteBuilding: edit,
        getFactory: async () => projectFactory(root),
      },
      backup: vi.fn(),
      restoreCloud: vi.fn(),
      chooseLocal: vi.fn(),
      retryStorage: vi.fn(),
    } as unknown as GameRuntime;
    return {
      runtime,
      resources: { phase: "ready" as const, completed: 0, total: 0, failed: 0 },
      ready: true,
      factory: projectFactory(root),
      districts: districtSummary(root),
      error: "",
      message: "",
      online: !paused,
      conflict: false,
      uploading: false,
      localSavedAt: "now",
      cloudSavedAt: null,
      dirty: false,
      paused,
      retry: vi.fn(),
    };
  });
  return initial;
}
afterEach(() => vi.clearAllMocks());
describe("robot map and management integration", () => {
  it("selects a robot on the map without placing or dragging a building and keeps selection in management", () => {
    prepare();
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    const marker = screen.getByRole("button", {
      name: "选择机器人 ui-robot (5,0)",
    });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 1 });
    fireEvent.click(marker);
    const inspector = screen.getByRole("region", { name: "机器人检视" });
    expect(within(inspector).getByText("ui-robot")).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
    expect(world).not.toHaveBeenCalled();
    fireEvent.click(
      within(inspector).getByRole("button", { name: "打开机器人管理" }),
    );
    expect(
      screen.getByRole("button", { name: /智能机器人 · ui-robot/ }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("查找机器人"), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByText("显示 0 / 1 台")).toBeInTheDocument();
    expect(within(inspector).getByText("ui-robot")).toBeInTheDocument();
  });
  it("keeps read-only selection available while paused and prevents gameplay controls", () => {
    prepare(false, true);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "选择机器人 ui-robot (5,0)" }),
    );
    const inspector = screen.getByRole("region", { name: "机器人检视" });
    expect(
      within(inspector).getByRole("button", { name: "暂停机器人" }),
    ).toBeDisabled();
    expect(within(inspector).getByRole("status")).toHaveTextContent(
      "世界已暂停",
    );
    fireEvent.click(
      within(inspector).getByRole("button", { name: "定位机器人 / 落点" }),
    );
    expect(world).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });
  it("locates the confirmed transit landing and locks authorization until physical return", async () => {
    const initial = prepare(true);
    render(<FactoryWorkspace user={user} onSessionExpired={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "机器人" }));
    fireEvent.click(
      screen.getByText("补能优先级与厂区授权", { selector: "summary" }),
    );
    const zones = screen.getByLabelText("可作业厂区");
    expect(
      within(zones).getByRole("checkbox", { name: /冶炼场/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "在地图查看机器人 / 过境落点" }),
    );
    await waitFor(() =>
      expect(world).toHaveBeenCalledWith({
        type: "select_district",
        id: initial.districts![0].id,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "冶炼场" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "机器人检视" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /选择机器人 ui-robot/ }),
    ).not.toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
});
