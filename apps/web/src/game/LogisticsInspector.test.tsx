import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LogisticsInspector from "./LogisticsInspector";
import { catalog, itemID } from "./local/catalog";
import { createLocalFactory, newMachine } from "./local/state";
import { openGameSelect } from "../test/gameSelect";

const user = {
  id: "output-inspector",
  username: "output-inspector",
  display_name: "检视",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板");
describe("warehouse output count controls", () => {
  it("shows one control per output face and sends edits without changing its mode or item", () => {
    const f = createLocalFactory(user, "四面");
    const b = f.buildings[0],
      act = vi.fn();
    b.configuration.face_0 = { mode: "output", filter: iron, output_count: 20 };
    b.configuration.face_180 = {
      mode: "closed",
      filter: iron,
      output_count: 9,
    };
    render(
      <LogisticsInspector
        factory={f}
        catalog={catalog}
        definition={catalog.buildings.find((d) => d.id === "bus")!}
        instance={b}
        act={act}
        disabled={false}
      />,
    );
    const field = screen.getByRole("combobox", { name: "东 →面输出件数" });
    expect(field).toHaveTextContent("20 件");
    expect(
      screen.queryByRole("combobox", { name: "西 ←面输出件数" }),
    ).not.toBeInTheDocument();
    openGameSelect(field);
    fireEvent.click(screen.getByRole("option", { name: "3 件" }));
    expect(act).toHaveBeenCalledWith({
      type: "bus_face",
      id: b.id,
      rotation: 0,
      mode: "output",
      filter: iron,
      output_count: 3,
    });
  });
  it("defaults the terminal control to one, offers twenty and respects paused editing", () => {
    const f = createLocalFactory(user, "终端"),
      act = vi.fn();
    const b = {
      ...f.buildings[0],
      id: "pickup",
      building_type: "warehouse_pickup",
      configuration: { output_items: [iron] },
    };
    f.buildings.push(b);
    f.simulation.buildings.pickup = newMachine();
    const props = {
      factory: f,
      catalog,
      definition: catalog.buildings.find((d) => d.id === "warehouse_pickup")!,
      instance: b,
      act,
      disabled: false,
    };
    const { rerender } = render(<LogisticsInspector {...props} />);
    const field = screen.getByRole("combobox", { name: "取货终端输出件数" });
    expect(field).toHaveTextContent("1 件");
    openGameSelect(field);
    fireEvent.click(screen.getByRole("option", { name: "20 件" }));
    expect(act).toHaveBeenCalledWith({
      type: "transport",
      id: "pickup",
      output_count: 20,
    });
    rerender(<LogisticsInspector {...props} disabled />);
    expect(
      screen.getByRole("combobox", { name: "取货终端输出件数" }),
    ).toBeDisabled();
  });
});
