import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuildingOrderButton from "./BuildingOrderButton";
import { buildingDefinitions, catalog } from "./local/catalog";
import { createWorld, projectFactory } from "./local/world";

const user = {
  id: "building-orders",
  username: "building-orders",
  display_name: "检视下单",
  created_at: "now",
  last_login_at: "now",
};
function setup() {
  const root = createWorld(user, "检视下单"),
    p = root.simulation.industry!;
  p.stage = 2;
  p.milestones = ["i0060"];
  p.quests!.completed = ["p1_free_hands"];
  p.quests!.claimed = ["p1_free_hands"];
  p.crafted[buildingDefinitions.get("m08")!.item!] = 1;
  root.active_district_id = root.districts![0].id;
  return root;
}
describe("inspector mechanical hand order entry", () => {
  it("opens the existing item plan for a differently named installation item from a remote district", () => {
    const root = setup(),
      definition = buildingDefinitions.get("waste_port")!,
      onOrder = vi.fn().mockResolvedValue(undefined);
    render(
      <BuildingOrderButton
        definition={definition}
        factory={projectFactory(root)}
        catalog={catalog}
        disabled={false}
        onOrder={onOrder}
      />,
    );
    const trigger = screen.getByRole("button", { name: "机械手下单" });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    const item = catalog.items.find((i) => i.id === definition.item)!;
    expect(item.name).not.toBe(definition.name);
    expect(
      screen.getByRole("dialog", { name: `机械手下单 · ${item.name}` }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭下单" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOrder).not.toHaveBeenCalled();
  });
  it("respects claimed access, developer access, actual workshop recipes and global queue occupancy", () => {
    const root = setup(),
      definition = buildingDefinitions.get("waste_port")!,
      props = {
        definition,
        factory: projectFactory(root),
        catalog,
        disabled: false,
        onOrder: vi.fn(),
      };
    root.simulation.industry!.quests!.claimed = [];
    const { rerender } = render(
      <BuildingOrderButton {...props} factory={projectFactory(root)} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    root.simulation.industry!.developer = {
      warehouse_orders_always_available: true,
    };
    rerender(<BuildingOrderButton {...props} factory={projectFactory(root)} />);
    expect(screen.getByRole("button", { name: "机械手下单" })).toBeEnabled();
    root.simulation.industry!.workshop = { recipe_id: "r1001", progress: 0 };
    rerender(<BuildingOrderButton {...props} factory={projectFactory(root)} />);
    expect(screen.getByRole("button", { name: "机械手下单" })).toBeDisabled();
    delete root.simulation.industry!.workshop;
    rerender(
      <BuildingOrderButton
        {...props}
        factory={projectFactory(root)}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "机械手下单" })).toBeDisabled();
    rerender(
      <BuildingOrderButton
        {...props}
        definition={buildingDefinitions.get("bus")!}
        factory={projectFactory(root)}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <BuildingOrderButton
        {...props}
        definition={buildingDefinitions.get("m28")!}
        factory={projectFactory(root)}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
