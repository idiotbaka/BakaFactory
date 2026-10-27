import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import IndustryViews from "./IndustryViews";
import { createLocalFactory } from "./local/state";
import { catalog, recipeDefinitions, itemID } from "./local/catalog";
import { workshopBatchLimit } from "./local/workshop";
import { createWorld, projectFactory, districtSummary } from "./local/world";
const user = {
  id: "batch-ui",
  username: "batch-ui",
  display_name: "批量",
  created_at: "now",
  last_login_at: "now",
};
describe("manual workshop batch controls", () => {
  it("uses the same partial pinyin search for workshop outputs and stocked warehouse items", () => {
    const f = createLocalFactory(user, "拼音搜索");
    f.simulation.warehouse[itemID("废铜线")] = 42;
    f.simulation.warehouse[itemID("基础铁板")] = 12;
    const props = {
      factory: f,
      catalog,
      disabled: false,
      act: vi.fn(),
      view: "workshop" as const,
      onViewChange: vi.fn(),
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    const sorter = recipeDefinitions.get("r1001")!;
    for (const query of ["feitongxian", "ftx", "tongx"]) {
      fireEvent.change(screen.getByLabelText("搜索工作室或仓库"), {
        target: { value: query },
      });
      expect(
        screen.getByLabelText(`${sorter.name}加工批数`),
      ).toBeInTheDocument();
    }
    rerender(<IndustryViews {...props} view="warehouse" />);
    const warehouse = within(
      screen.getByRole("region", { name: "工厂总仓库" }),
    );
    expect(warehouse.getAllByRole("article")).toHaveLength(1);
    expect(warehouse.getByText("42 u")).toBeInTheDocument();
    expect(warehouse.queryByText("基础铁板")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索工作室或仓库"), {
      target: { value: "I0045" },
    });
    expect(warehouse.getByText("12 u")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索工作室或仓库"), {
      target: { value: "" },
    });
    expect(warehouse.getAllByRole("article")).toHaveLength(2);
  });
  it("shows shared workshop actions in a child and disables every recipe when the global queue is occupied", () => {
    const root = createWorld(user, "全局工作室"),
      act = vi.fn(),
      recipe = recipeDefinitions.get("r1001")!;
    root.simulation.warehouse[itemID("垃圾包")] = 120;
    root.active_district_id = root.districts![0].id;
    const props = {
      factory: projectFactory(root),
      catalog,
      districts: districtSummary(root),
      disabled: false,
      act,
      view: "workshop" as const,
      onViewChange: vi.fn(),
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /拾取 1 包垃圾/ }));
    expect(act).toHaveBeenCalledWith({ type: "scavenge" });
    const card = within(
      screen.getByLabelText(`${recipe.name}加工批数`).closest("article")!,
    );
    fireEvent.click(card.getByRole("button", { name: "批量加工" }));
    expect(act).toHaveBeenCalledWith({
      type: "workshop",
      recipe: recipe.id,
      batches: 1,
    });
    root.simulation.industry!.workshop = {
      recipe_id: recipe.id,
      progress: 0,
      total: 1,
      remaining: 1,
    };
    root.active_district_id = root.districts![1].id;
    rerender(<IndustryViews {...props} factory={projectFactory(root)} />);
    expect(
      screen
        .getAllByRole("button", { name: "批量加工" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(screen.queryByText(/请在“厂区”切回/)).not.toBeInTheDocument();
  });
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
      outputs
        .getAllByRole("listitem")
        .every((row) => row.querySelector(".item-sprite[data-item-id]")),
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
    for (const value of ["1.5", "", "0", "-1"]) {
      fireEvent.change(input, { target: { value } });
      expect(card.getByRole("button", { name: "批量加工" })).toBeDisabled();
      fireEvent.submit(input.closest("form")!);
      expect(act).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: "3" } });
    expect(input).toHaveValue(2);
    expect(card.getByRole("button", { name: "批量加工" })).toBeEnabled();
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
    expect(input).toHaveValue(100);
    expect(card.getByRole("button", { name: "批量加工" })).toBeEnabled();
    f.simulation.warehouse[itemID("垃圾包")] = 12;
    rerender(<IndustryViews {...props} />);
    expect(input).toHaveValue(1);
    expect(card.getByRole("button", { name: "批量加工" })).toBeEnabled();
    fireEvent.click(card.getByRole("button", { name: "批量加工" }));
    expect(act).toHaveBeenCalledWith({
      type: "workshop",
      recipe: r.id,
      batches: 1,
    });
  });
  it("keeps only machine tabs in sticky controls while scavenging stays outside and shows manual duration", () => {
    const f = createLocalFactory(user, "固定操作"),
      act = vi.fn();
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
    const controls = within(
      screen.getByRole("region", { name: "工作室快捷操作" }),
    );
    expect(screen.getByRole("region", { name: "工作室快捷操作" })).toHaveClass(
      "workshop-controls",
    );
    expect(
      controls.getByRole("group", { name: "工作室设备" }),
    ).toBeInTheDocument();
    expect(
      controls.queryByRole("button", { name: /拾取 1 包垃圾/ }),
    ).not.toBeInTheDocument();
    expect(controls.queryByText("无尽垃圾堆")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /拾取 1 包垃圾/ }));
    expect(act).toHaveBeenCalledWith({ type: "scavenge" });
    expect(screen.getAllByText("手工 3s").length).toBeGreaterThan(0);
    expect(screen.getByText(/R1002/)).toBeInTheDocument();
    expect(screen.queryByText(/原配方.*s/)).not.toBeInTheDocument();
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
