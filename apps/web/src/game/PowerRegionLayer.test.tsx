import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PowerRegionLayer from "./PowerRegionLayer";
import {
  createLocalFactory,
  editFactory,
  type LocalFactory,
} from "./local/state";
import { buildingDefinitions, catalog, itemID } from "./local/catalog";
import { allocatePower } from "./local/power";

afterEach(cleanup);

const user = {
  id: "region-ui",
  username: "region-ui",
  display_name: "组网",
  created_at: "now",
  last_login_at: "now",
};

function place(
  f: LocalFactory,
  id: string,
  type: string,
  x: number,
  y: number,
  size?: 1 | 2,
) {
  const item = buildingDefinitions.get(type)!.item;
  if (item)
    f.simulation.warehouse[item] = (f.simulation.warehouse[item] ?? 0) + 1;
  return editFactory(f, {
    kind: "place",
    id,
    building_type: type,
    placement: { x, y, rotation: 0, ...(size ? { size } : {}) },
  });
}

describe("PowerRegionLayer", () => {
  it("renders colored SVG regions and fixed 12px energy labels only for regions with energy sources or consumers", () => {
    let f = createLocalFactory(user, "组网视图");
    f.simulation.industry!.stage = 6;
    f = place(f, "gen", "m09", 1, 0);
    f = place(f, "belt", "mechanical_belt", 2, 0);
    f = place(f, "hydLoad", "hydraulic_belt", -4, 4);
    f.simulation.buildings.gen.fuel = [
      { item: itemID("固体燃料块"), count: 1 },
    ];
    const m10Recipe = catalog.recipes.find((r) => r.building_type === "m10")!;
    f = place(f, "sieve", "m10", 3, 0);
    f.buildings.find((b) => b.id === "sieve")!.configuration.recipe_id =
      m10Recipe.id;
    allocatePower(f, f.buildings);

    const { container } = render(
      <PowerRegionLayer factory={f} camera={{ x: 20, y: 30, zoom: 1.25 }} />,
    );

    expect(screen.getByLabelText("工厂组网覆盖层")).toBeInTheDocument();
    expect(container.querySelectorAll("g[data-region-id]")).toHaveLength(2);
    expect(screen.getByText("组网 1 · 4 个方块")).toBeInTheDocument();
    expect(screen.getByText("轴功 需 1 / 供 50 kW")).toBeInTheDocument();
    expect(screen.getByText("组网 2 · 1 个方块")).toBeInTheDocument();
    expect(screen.getByText("液压 未接入 · 1 台")).toBeInTheDocument();
  });

  it("omits text labels for regions that have neither energy sources nor energy consumers", () => {
    let f = createLocalFactory(user, "纯手动组网");
    f = place(f, "chest", "chest", 1, 0);
    allocatePower(f, f.buildings);

    const { container } = render(
      <PowerRegionLayer factory={f} camera={{ x: 0, y: 0, zoom: 1 }} />,
    );

    expect(container.querySelectorAll("g[data-region-id]")).toHaveLength(1);
    expect(container.querySelectorAll(".power-region-label")).toHaveLength(0);
  });
});
