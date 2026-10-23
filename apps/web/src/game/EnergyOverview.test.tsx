import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnergyOverview from "./EnergyOverview";
import { createWorld } from "./local/world";
import { newMachine } from "./local/state";
import { itemID } from "./local/catalog";

const user = {
  id: "energy-ui",
  username: "energy-ui",
  display_name: "能源",
  created_at: "now",
  last_login_at: "now",
};
const network = (
  kind: "shaft" | "hydraulic" | "electric",
  id: string,
  capacity = 50,
  demand = 20,
) => ({
  id,
  kind,
  producers: capacity ? 1 : 0,
  consumers: 1,
  capacity_kw: capacity,
  demand_kw: demand,
  supplied_kw: Math.min(capacity, demand),
  loss_kw: 0,
  charge_kw: 0,
  discharge_kw: 0,
  stored_kj: kind === "electric" ? 1000 : 0,
});

describe("stage-aware energy overview", () => {
  it("shows manual power in P1 and keeps future systems locked even if a network exists", () => {
    const f = createWorld(user, "手工动力");
    f.simulation.networks = [network("electric", "future")];
    const before = structuredClone(f);
    render(<EnergyOverview factory={f} />);
    const tabs = within(screen.getByRole("navigation", { name: "能源类型" }));
    expect(tabs.getAllByRole("button")).toHaveLength(4);
    expect(tabs.getByRole("button", { name: /手工动力/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of [/机械动力/, /液压动力/, /电力/]) {
      const button = tabs.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(
      screen.getByRole("region", { name: "手工动力自评" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("电力网络合计")).not.toBeInTheDocument();
    expect(f).toEqual(before);
  });
  it("unlocks systems by stage, allows revisiting manual power and falls back after a lower-stage load", () => {
    const f = createWorld(user, "能源页签");
    f.simulation.industry!.stage = 2;
    const { rerender } = render(<EnergyOverview factory={f} />);
    expect(screen.getByRole("button", { name: /液压动力/ })).toBeDisabled();
    f.simulation.industry!.stage = 3;
    rerender(<EnergyOverview factory={f} />);
    expect(screen.getByRole("button", { name: /液压动力/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /手工动力/ }));
    expect(
      screen.getByRole("region", { name: "手工动力自评" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("液压动力网络合计")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /液压动力/ }));
    expect(screen.getByLabelText("液压动力网络合计")).toBeInTheDocument();
    f.simulation.industry!.stage = 1;
    rerender(<EnergyOverview factory={f} />);
    expect(screen.getByRole("button", { name: /液压动力/ })).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "手工动力自评" }),
    ).toBeInTheDocument();
  });
  it("guides P2 through fuel and shafts without future battery controls, and reads heat separately", () => {
    const f = createWorld(user, "P2 能源");
    f.simulation.industry!.stage = 2;
    f.simulation.networks = [
      network("shaft", "shaft-a"),
      network("shaft", "shaft-b", 0, 20),
    ];
    f.buildings.push({
      id: "furnace",
      factory_id: f.id,
      building_type: "m05",
      x: 2,
      y: 0,
      rotation: 0,
      configuration: { recipe_id: "r1017" },
    });
    f.simulation.buildings.furnace = {
      ...newMachine(),
      fuel: [{ item: itemID("干燥生物质"), count: 2 }],
    };
    const before = structuredClone(f);
    render(<EnergyOverview factory={f} />);
    expect(
      screen.getByRole("region", { name: "机械动力搭建指南" }),
    ).toHaveTextContent("固燃传动机");
    expect(
      screen.getByRole("region", { name: "机械动力搭建指南" }),
    ).toHaveTextContent("传动轴");
    expect(screen.getByRole("button", { name: /电力/ })).toBeDisabled();
    expect(
      screen.queryByText("储能箱：容量、损耗与备用电量"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("可用热量 560 kJ")).toBeInTheDocument();
    expect(screen.getByText("等待供能")).toBeInTheDocument();
    expect(f).toEqual(before);
  });
  it("separates network types and keeps electrical details behind the matching system", () => {
    const f = createWorld(user, "P4 能源");
    f.simulation.industry!.stage = 4;
    f.simulation.networks = [
      network("shaft", "shaft", 50),
      network("electric", "electric", 160),
    ];
    render(<EnergyOverview factory={f} />);
    expect(
      within(screen.getByLabelText("电力网络合计")).getByText("160 kW"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("储能箱：容量、损耗与备用电量").closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: /机械动力/ }));
    expect(
      within(screen.getByLabelText("机械动力网络合计")).getByText("50 kW"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("储能箱：容量、损耗与备用电量"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("210 kW")).not.toBeInTheDocument();
  });
});
