import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BuildingRecipeGuide from "./BuildingRecipeGuide";
import { catalog } from "./local/catalog";

function show(id: string) {
  render(
    <BuildingRecipeGuide
      definition={catalog.buildings.find((b) => b.id === id)!}
      catalog={catalog}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "获取来源和关联配方" }));
  return within(screen.getByRole("dialog"));
}

describe("building acquisition guide", () => {
  it("resolves an aliased logistics building through the actual installation item", () => {
    const dialog = show("waste_port");
    const source = within(dialog.getByRole("region", { name: "获取方式" }));
    expect(
      source.getByText("安装「垃圾提取口」实际消耗：初阶自动投料机 × 1"),
    ).toBeInTheDocument();
    expect(
      source.getByText(/建筑名称「垃圾提取口」对应道具「初阶自动投料机」/),
    ).toBeInTheDocument();
    expect(source.getByText("机械抓取爪 × 1")).toBeInTheDocument();
    expect(source.getByText("低速传动轴 × 1")).toBeInTheDocument();
    expect(source.getByText("分拣料箱 × 1")).toBeInTheDocument();
    expect(source.getByText("初阶自动投料机 × 1")).toBeInTheDocument();
    expect(source.getByText("15 秒 / 批")).toBeInTheDocument();
    expect(source.getByText(/工作室手工耗时：7 秒 \/ 批/)).toBeInTheDocument();
    expect(source.getByText(/首次制造该加工设备后/)).toBeInTheDocument();
    expect(
      dialog.getByText("该设施不执行加工配方；获取方式见上方。"),
    ).toBeInTheDocument();
  });
  it("separates recipes making the machine from recipes executed by the machine", () => {
    const dialog = show("m08");
    const source = within(dialog.getByRole("region", { name: "获取方式" }));
    const related = within(
      dialog.getByRole("region", { name: "关联加工配方" }),
    );
    expect(
      source.getByRole("heading", { name: /设备·手工装配台/ }),
    ).toBeInTheDocument();
    expect(source.getByText(/工作室 → 手工工作台/)).toBeInTheDocument();
    expect(
      related.getByRole("heading", { name: /初阶自动投料机/ }),
    ).toBeInTheDocument();
    expect(
      related.queryByRole("heading", { name: /设备·手工装配台/ }),
    ).not.toBeInTheDocument();
    expect(related.getAllByText(/阶段条件未满足/).length).toBeGreaterThan(0);
    expect(related.getAllByText(/前置里程碑：首次制造/).length).toBeGreaterThan(
      0,
    );
  });
  it("explains fixed facilities without presenting a missing recipe as obtainable", () => {
    const dialog = show("bus");
    expect(
      dialog.getByText(
        "创建厂区时自动提供的固定设施，无需合成或消耗安装道具。",
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByText(/生产安装道具的配方/)).not.toBeInTheDocument();
  });
});
