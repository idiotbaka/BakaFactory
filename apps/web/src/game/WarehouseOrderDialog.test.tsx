import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WarehouseOrderDialog from "./WarehouseOrderDialog";
import IndustryViews from "./IndustryViews";
import { catalog, itemID } from "./local/catalog";
import { createWorld, projectFactory, districtSummary } from "./local/world";
import { planWorkshopOrder } from "./local/orders";

const user = {
  id: "order-ui",
  username: "order-ui",
  display_name: "下单",
  created_at: "now",
  last_login_at: "now",
};
const ring = itemID("粗密封圈");
function factory() {
  const f = createWorld(user, "订单");
  const p = f.simulation.industry!;
  p.stage = 2;
  p.milestones = ["i0060"];
  p.crafted.i0060 = 1;
  p.quests!.completed = ["p1_free_hands"];
  p.quests!.claimed = ["p1_free_hands"];
  Object.assign(f.simulation.warehouse, { i0009: 4, i0029: 2 });
  return f;
}
describe("warehouse order interface", () => {
  it("reveals craftable zero-stock items only after claiming, and disables orders outside headquarters or during a queue", () => {
    const f = factory(),
      onOrder = vi.fn().mockResolvedValue(undefined);
    const props = {
      factory: f,
      districts: districtSummary(f),
      catalog,
      disabled: false,
      act: vi.fn(),
      children: null,
      view: "warehouse" as const,
      onViewChange: vi.fn(),
      onOrder,
    };
    f.simulation.industry!.quests!.claimed = [];
    const { rerender } = render(<IndustryViews {...props} />);
    expect(
      screen.queryByRole("button", { name: "下单粗密封圈" }),
    ).not.toBeInTheDocument();
    f.simulation.industry!.quests!.claimed = ["p1_free_hands"];
    rerender(<IndustryViews {...props} />);
    const order = screen.getByRole("button", { name: "下单粗密封圈" });
    expect(order).toBeEnabled();
    expect(
      within(order.closest("article")!).getByText("0 u"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下单垃圾包" }),
    ).not.toBeInTheDocument();
    f.simulation.industry!.workshop = { recipe_id: "r1001", progress: 0 };
    rerender(<IndustryViews {...props} />);
    expect(order).toBeDisabled();
    delete f.simulation.industry!.workshop;
    f.active_district_id = f.districts![0].id;
    rerender(<IndustryViews {...props} factory={projectFactory(f)} />);
    expect(screen.getByRole("button", { name: "下单粗密封圈" })).toBeDisabled();
  });
  it("previews rounded outputs with icons, sends the confirmed signature and keeps errors reviewable", async () => {
    const f = factory(),
      onClose = vi.fn(),
      onConfirm = vi
        .fn()
        .mockRejectedValueOnce(new Error("仓库已变化，请再确认"))
        .mockResolvedValue(undefined);
    render(
      <WarehouseOrderDialog
        item={ring}
        factory={f}
        catalog={catalog}
        disabled={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "下单数量" }), {
      target: { value: "5" },
    });
    expect(
      screen.getByRole("region", { name: "预留仓库材料" }),
    ).toHaveTextContent("× 4");
    const outputs = screen.getByRole("region", { name: "最终交付物品" });
    expect(outputs).toHaveTextContent("粗密封圈× 6");
    expect(outputs.querySelector("svg")).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "顺序加工队列" }),
    ).toHaveTextContent("2 批 × 3 秒");
    fireEvent.click(screen.getByRole("button", { name: "确认下单" }));
    const plan = planWorkshopOrder(
      f.simulation.industry,
      f.simulation.warehouse,
      ring,
      5,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("仓库已变化"),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      type: "order_workshop",
      item: ring,
      count: 5,
      signature: plan.signature,
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认下单" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("blocks missing materials and invalid quantities and isolates keyboard input and modal dismissal", () => {
    const f = factory(),
      onClose = vi.fn(),
      onConfirm = vi.fn();
    f.simulation.warehouse = {};
    render(
      <WarehouseOrderDialog
        item={ring}
        factory={f}
        catalog={catalog}
        disabled={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("region", { name: "缺少材料" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认下单" })).toBeDisabled();
    const input = screen.getByRole("spinbutton", { name: "下单数量" });
    for (const value of ["", "0", "1.5", "1001"]) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole("alert")).toHaveTextContent("1～1000");
      expect(screen.getByRole("button", { name: "确认下单" })).toBeDisabled();
    }
    input.focus();
    expect(fireEvent.keyDown(input, { key: "1" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "f" })).toBe(true);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("dialog")).toContainElement(
      document.activeElement as HTMLElement,
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
