import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import IndustryViews from "./IndustryViews";
import { createLocalFactory } from "./local/state";
import { catalog, recipeDefinitions, itemID } from "./local/catalog";
import { workshopBatchLimit } from "./local/workshop";
const user = {
  id: "batch-ui",
  username: "batch-ui",
  display_name: "批量",
  created_at: "now",
  last_login_at: "now",
};
describe("manual workshop batch controls", () => {
  it("validates current material limits and integer counts before submitting a real quantity", () => {
    const f = createLocalFactory(user, "批量"),
      r = recipeDefinitions.get("r1001")!,
      act = vi.fn();
    f.simulation.warehouse[itemID("垃圾包")] = 30;
    const props = {
      factory: f,
      catalog,
      disabled: false,
      act,
      view: "workshop" as const,
      onViewChange: vi.fn(),
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const input = screen.getByLabelText(`${r.name}加工批数`),
      card = within(input.closest("article")!);
    expect(input).toHaveAttribute("max", "2");
    for (const value of ["3", "1.5", "", "0"]) {
      fireEvent.change(input, { target: { value } });
      expect(card.getByRole("button", { name: "批量加工" })).toBeDisabled();
      fireEvent.submit(input.closest("form")!);
      expect(act).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(card.getByRole("button", { name: "批量加工" }));
    expect(act).toHaveBeenCalledWith({
      type: "workshop",
      recipe: r.id,
      batches: 2,
    });
    act.mockClear();
    f.simulation.warehouse[itemID("垃圾包")] = 12000;
    rerender(<IndustryViews {...props} />);
    expect(input).toHaveAttribute("max", "100");
    fireEvent.change(input, { target: { value: "101" } });
    expect(card.getByRole("button", { name: "批量加工" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "100" } });
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    rerender(<IndustryViews {...props} />);
    expect(card.getByRole("button", { name: "批量加工" })).toBeDisabled();
  });
  it("uses the scarcest required material and the shared queue prevents another submission", () => {
    expect(
      workshopBatchLimit(
        { inputs: { iron: 3, copper: 2 } },
        { iron: 31, copper: 3 },
      ),
    ).toBe(1);
    const f = createLocalFactory(user, "队列"),
      r = recipeDefinitions.get("r1001")!,
      act = vi.fn();
    f.simulation.warehouse[itemID("垃圾包")] = 120;
    f.simulation.industry!.workshop = {
      recipe_id: r.id,
      progress: 2,
      total: 2,
      remaining: 2,
    };
    render(
      <IndustryViews
        factory={f}
        catalog={catalog}
        disabled={false}
        act={act}
        view="workshop"
        onViewChange={vi.fn()}
      >
        {null}
      </IndustryViews>,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "批量加工" })
        .every((b) => b.hasAttribute("disabled")),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "取消队列并返还未完成原料" }),
    );
    expect(act).toHaveBeenCalledWith({ type: "cancel_workshop" });
  });
});
