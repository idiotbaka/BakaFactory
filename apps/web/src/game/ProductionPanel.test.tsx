import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionInspector } from "./ProductionPanel";
import { catalog, itemID } from "./local/catalog";
import { createLocalFactory, editFactory } from "./local/state";

function fixture(id = "sorter") {
  let factory = createLocalFactory(
    {
      id: "feed-ui",
      username: "feed-ui",
      display_name: "补料",
      created_at: "now",
      last_login_at: "now",
    },
    "补料",
  );
  const definition = catalog.buildings.find((b) => b.id === "m02")!;
  factory.simulation.warehouse[definition.item!] = 1;
  factory = editFactory(factory, {
    kind: "place",
    id,
    building_type: "m02",
    placement: { x: 1, y: 0, rotation: 0 },
  });
  factory = editFactory(factory, {
    kind: "industry",
    action: { type: "recipe", id, recipe: "r1001" },
  });
  factory.simulation.warehouse[itemID("垃圾包")] = 500;
  return {
    factory,
    definition,
    catalog,
    instance: factory.buildings.find((b) => b.id === id)!,
    act: vi.fn(),
  };
}

describe("machine batch refill controls", () => {
  it("defaults to one batch and clamps an oversized entry instead of rejecting the form", () => {
    const props = fixture();
    render(<ProductionInspector {...props} />);
    const input = screen.getByRole("spinbutton", { name: "补料批数" });
    const button = screen.getByRole("button", { name: "从仓库补足原料" });
    expect(input).toHaveValue(1);
    expect(input).not.toHaveAttribute("max");
    fireEvent.click(button);
    expect(props.act).toHaveBeenLastCalledWith({
      type: "feed_batch",
      id: "sorter",
      batches: 1,
    });
    fireEvent.change(input, { target: { value: "999" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(props.act).toHaveBeenLastCalledWith({
      type: "feed_batch",
      id: "sorter",
      batches: 8,
    });
    expect(input).toHaveValue(8);
    expect(screen.getByText(/最多可补足 8 批/)).toBeInTheDocument();
    expect(props.factory.simulation.buildings.sorter.input).toEqual([]);
  });

  it("refreshes the stock limit without resetting typed batches and resets only on a machine or recipe change", () => {
    const props = fixture();
    const { rerender } = render(<ProductionInspector {...props} />);
    const input = screen.getByRole("spinbutton", { name: "补料批数" });
    fireEvent.change(input, { target: { value: "99" } });
    props.factory.simulation.buildings.sorter.input = [
      { item: itemID("垃圾包"), count: 5 },
    ];
    props.factory.simulation.warehouse[itemID("垃圾包")] = 20;
    rerender(<ProductionInspector {...props} />);
    expect(input).toHaveValue(99);
    expect(screen.getByText(/最多可补足 2 批/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "从仓库补足原料" }));
    expect(props.act).toHaveBeenLastCalledWith({
      type: "feed_batch",
      id: "sorter",
      batches: 2,
    });
    expect(input).toHaveValue(2);
    props.instance.configuration.recipe_id = "r1002";
    rerender(<ProductionInspector {...props} />);
    expect(screen.getByRole("spinbutton", { name: "补料批数" })).toHaveValue(1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "补料批数" }), {
      target: { value: "7" },
    });
    rerender(<ProductionInspector {...fixture("other-sorter")} />);
    expect(screen.getByRole("spinbutton", { name: "补料批数" })).toHaveValue(1);
  });

  it("blocks empty, fractional, nonpositive, paused and unavailable batches without dispatching an action", () => {
    const props = fixture();
    const { rerender } = render(<ProductionInspector {...props} />);
    const input = screen.getByRole("spinbutton", { name: "补料批数" });
    const button = screen.getByRole("button", { name: "从仓库补足原料" });
    for (const value of ["", "0", "-1", "1.5"]) {
      fireEvent.change(input, { target: { value } });
      expect(button).toBeDisabled();
      fireEvent.submit(input.closest("form")!);
    }
    fireEvent.change(input, { target: { value: "1" } });
    rerender(<ProductionInspector {...props} disabled />);
    expect(input).toBeDisabled();
    expect(button).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    props.factory.simulation.warehouse[itemID("垃圾包")] = 11;
    rerender(<ProductionInspector {...props} />);
    expect(button).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/无法补足一批/)).toBeInTheDocument();
    delete props.instance.configuration.recipe_id;
    rerender(<ProductionInspector {...props} />);
    expect(screen.getByRole("spinbutton", { name: "补料批数" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "从仓库补足原料" }),
    ).toBeDisabled();
    expect(props.act).not.toHaveBeenCalled();
  });
});
