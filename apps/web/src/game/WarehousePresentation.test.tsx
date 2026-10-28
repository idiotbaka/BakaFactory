import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import IndustryViews from "./IndustryViews";
import FactoryIOCard from "./FactoryIOCard";
import { warehouseItemTypes } from "./WarehouseInventory";
import { catalog, itemID } from "./local/catalog";
import { createWorld, projectFactory } from "./local/world";
import { openGameSelect } from "../test/gameSelect";

const user = {
  id: "warehouse-ui",
  username: "warehouse-ui",
  display_name: "仓库",
  created_at: "now",
  last_login_at: "now",
};
const iron = itemID("基础铁板"),
  copper = itemID("铜条");
function factory() {
  const f = createWorld(user, "本厂");
  f.simulation.tick = 120;
  f.districts!.forEach((d) => (d.simulation.tick = 120));
  f.simulation.warehouse = { [iron]: 25, [copper]: 0 };
  f.warehouse_activity = {
    started_tick: 0,
    buckets: [
      {
        tick: 120,
        delta: { [iron]: 25, [copper]: -12 },
        factories: {
          [f.id]: {
            received: { [iron]: 25 },
            withdrawn: { [iron]: 3, [copper]: 12 },
          },
        },
      },
    ],
  };
  return f;
}

describe("warehouse filters and minute IO presentation", () => {
  it("shows signed colors including depleted items, intersects phase/type/search and waits for a full window", () => {
    const f = factory();
    const logistics = catalog.buildings.find(
      (b) => b.item && b.role === "belt",
    )!;
    const machine = catalog.buildings.find((b) => b.id === "m02")!;
    f.simulation.warehouse[logistics.item!] = 1;
    f.simulation.warehouse[machine.item!] = 1;
    const props = {
      factory: f,
      catalog,
      disabled: false,
      act: vi.fn(),
      view: "warehouse" as const,
      onViewChange: vi.fn(),
      children: null,
    };
    const { rerender } = render(<IndustryViews {...props} />);
    expect(screen.getByText("+25u/m")).toHaveClass("is-positive");
    expect(screen.getByText("-12u/m")).toHaveClass("is-negative");
    expect(screen.getByText("0 u")).toBeInTheDocument();
    openGameSelect(screen.getByRole("combobox", { name: "仓库物品类型" }));
    fireEvent.click(screen.getByRole("option", { name: "物流" }));
    const region = screen.getByRole("region", { name: "工厂总仓库" });
    expect(within(region).getAllByRole("article")).toHaveLength(1);
    expect(
      region.querySelector(`[data-item-id="${logistics.item}"]`),
    ).not.toBeNull();
    openGameSelect(screen.getByRole("combobox", { name: "仓库游戏阶段" }));
    fireEvent.click(screen.getByRole("option", { name: "P6" }));
    expect(within(region).queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByText(/没有匹配的物品/)).toBeInTheDocument();
    rerender(<IndustryViews {...props} view="factory" />);
    expect(
      screen.queryByRole("combobox", { name: "仓库物品类型" }),
    ).not.toBeInTheDocument();
    rerender(<IndustryViews {...props} view="workshop" />);
    rerender(<IndustryViews {...props} />);
    expect(
      screen.getByRole("combobox", { name: "仓库游戏阶段" }),
    ).toHaveTextContent("P6");
    expect(
      screen.getByRole("combobox", { name: "仓库物品类型" }),
    ).toHaveTextContent("物流");
    expect(screen.getByText(/没有匹配的物品/)).toBeInTheDocument();
    rerender(
      <IndustryViews
        {...props}
        factory={{
          ...f,
          warehouse_activity: {
            started_tick: 1,
            buckets: f.warehouse_activity!.buckets,
          },
        }}
      />,
    );
    expect(screen.queryByText("+25u/m")).not.toBeInTheDocument();
    expect(screen.getByText("运行满 1 分钟后显示净变化")).toBeInTheDocument();
  });
  it("classifies machine and logistics installation items before the general solid fallback", () => {
    const types = warehouseItemTypes(catalog);
    expect(types.get(iron)).toBe("solid");
    expect(types.get(itemID("净化水"))).toBe("fluid");
    expect(
      types.get(catalog.buildings.find((b) => b.id === "m02")!.item!),
    ).toBe("machine");
    expect(types.get("d0001")).toBe("logistics");
    expect(types.get(catalog.items.find((i) => i.kind === "robot")!.id)).toBe(
      "machine",
    );
  });
  it("shows only the selected factory's gross input/output and closes on Escape", () => {
    const f = factory(),
      onClose = vi.fn();
    const anchor = { current: document.createElement("button") };
    anchor.current.getBoundingClientRect = () => new DOMRect(700, 500, 60, 30);
    document.body.append(anchor.current);
    const { rerender, unmount } = render(
      <FactoryIOCard
        id="factory-io"
        anchor={anchor}
        factory={f}
        catalog={catalog}
        onClose={onClose}
      />,
    );
    const card = screen.getByRole("region", { name: "本厂 · io数据" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("最近 1 分钟 · 本工厂内的产物io数据");
    expect(card).not.toHaveTextContent("包含 WH");
    expect(
      within(card).getByRole("region", { name: "从总仓库取出" }),
    ).toHaveTextContent("3 u");
    expect(
      within(card).getByRole("region", { name: "存入总仓库" }),
    ).toHaveTextContent("25 u");
    f.active_district_id = f.districts![0].id;
    rerender(
      <FactoryIOCard
        id="factory-io"
        anchor={anchor}
        factory={projectFactory(f)}
        catalog={catalog}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("最近 1 分钟没有取出物品。")).toBeInTheDocument();
    expect(screen.queryByText("25 u")).not.toBeInTheDocument();
    fireEvent.scroll(screen.getByLabelText("从总仓库取出明细"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(anchor.current).toHaveFocus();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    anchor.current.remove();
  });
});
