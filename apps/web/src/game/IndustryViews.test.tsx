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
  it("groups recipes by machine, locks optional workbenches until first manufacture and preserves the unlock after spending the device", () => {
    const f = createLocalFactory(user, "子分类"),
      act = vi.fn(),
      dismantler = catalog.buildings.find((b) => b.id === "m03")!.item!;
    f.simulation.warehouse[dismantler] = 1;
    const props = {
      factory: f,
      catalog,
      disabled: false,
      act,
      view: "workshop" as const,
      onViewChange: vi.fn(),
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />),
      tabs = within(screen.getByRole("group", { name: "工作室设备" }));
    expect(tabs.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "手动分拣台",
      "铁砧锻台",
      "手工工作台",
      "简易拆解台",
      "手摇破碎机",
      "手工装配台",
    ]);
    const sorter = recipeDefinitions.get("r1001")!,
      makeDevice = recipeDefinitions.get("r1006")!,
      extract = recipeDefinitions.get("r1007")!;
    expect(screen.getByLabelText(`${sorter.name}加工批数`)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(`${makeDevice.name}加工批数`),
    ).not.toBeInTheDocument();
    expect(tabs.getByRole("button", { name: "简易拆解台" })).toBeDisabled();
    expect(tabs.getByRole("button", { name: "手摇破碎机" })).toBeDisabled();
    expect(tabs.getByRole("button", { name: "手工装配台" })).toBeDisabled();
    expect(
      screen.getAllByTitle("至少需要生产 1 次该设备后才能解锁"),
    ).toHaveLength(3);
    fireEvent.click(tabs.getByRole("button", { name: "手工工作台" }));
    expect(
      screen.getByLabelText(`${makeDevice.name}加工批数`),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(`${sorter.name}加工批数`),
    ).not.toBeInTheDocument();
    f.simulation.industry!.crafted[dismantler] = 1;
    f.simulation.warehouse[dismantler] = 0;
    rerender(<IndustryViews {...props} />);
    expect(tabs.getByRole("button", { name: "简易拆解台" })).toBeEnabled();
    fireEvent.click(tabs.getByRole("button", { name: "简易拆解台" }));
    expect(
      screen.getByLabelText(`${extract.name}加工批数`),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(`${makeDevice.name}加工批数`),
    ).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
    const assemblyItem = catalog.buildings.find((b) => b.id === "m08")!.item!,
      assemblyRecipe = recipeDefinitions.get("r1033")!;
    f.simulation.industry!.crafted[assemblyItem] = 1;
    f.simulation.warehouse[assemblyItem] = 0;
    Object.assign(f.simulation.warehouse, assemblyRecipe.inputs);
    rerender(<IndustryViews {...props} />);
    expect(tabs.getByRole("button", { name: "手工装配台" })).toBeEnabled();
    fireEvent.click(tabs.getByRole("button", { name: "手工装配台" }));
    const assemblyInput = screen.getByLabelText(
      `${assemblyRecipe.name}加工批数`,
    );
    fireEvent.click(
      within(assemblyInput.closest("article")!).getByRole("button", {
        name: "批量加工",
      }),
    );
    expect(act).toHaveBeenCalledWith({
      type: "workshop",
      recipe: assemblyRecipe.id,
      batches: 1,
    });
  });
  it("shows material icons, names and separate stock / required or produced quantities", () => {
    const f = createLocalFactory(user, "物料卡"),
      r = recipeDefinitions.get("r1001")!;
    f.simulation.warehouse[itemID("垃圾包")] = 60;
    render(
      <IndustryViews
        factory={f}
        catalog={catalog}
        disabled={false}
        act={vi.fn()}
        view="workshop"
        onViewChange={vi.fn()}
      >
        {null}
      </IndustryViews>,
    );
    const recipe = within(
        screen.getByLabelText(`${r.name}加工批数`).closest("article")!,
      ),
      inputs = within(recipe.getByRole("region", { name: "每批原料" })),
      outputs = within(recipe.getByRole("region", { name: "每批产物" }));
    expect(inputs.getByText("垃圾包")).toBeInTheDocument();
    expect(inputs.getByText("存 60 / 需 12")).toBeInTheDocument();
    expect(outputs.getByText("铁质碎片")).toBeInTheDocument();
    expect(outputs.getByText("存 0 / 产 3")).toBeInTheDocument();
    expect(outputs.getAllByRole("listitem")).toHaveLength(9);
    expect(
      outputs.getAllByRole("listitem").every((row) => row.querySelector("svg")),
    ).toBe(true);
  });
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
    expect(
      screen.queryByRole("button", { name: "取消队列并返还未完成原料" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/当前进度见顶部横栏/)).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
  });
});
