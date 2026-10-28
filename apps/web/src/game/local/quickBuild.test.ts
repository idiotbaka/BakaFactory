import { describe, expect, it } from "vitest";
import { directionEditTarget } from "../editorGeometry";
import { isPlaceableBuilding } from "../catalogPresentation";
import { catalog, itemID } from "./catalog";
import { createLocalFactory, editFactory } from "./state";

const user = {
  id: "quick-build-owner",
  username: "builder",
  display_name: "建造",
  created_at: "now",
  last_login_at: "now",
};
const routes = catalog.buildings.filter(
  (d) => ["belt", "pipe"].includes(d.role ?? "") && d.id !== "underground_belt",
);

describe("quick-build eligibility and direction edits", () => {
  it("shares palette stage and protected-facility eligibility", () => {
    for (const definition of catalog.buildings) {
      expect(isPlaceableBuilding(definition, 6)).toBe(
        !definition.fixed &&
          !["bus", "warehouse_pickup", "warehouse_intake"].includes(
            definition.id,
          ),
      );
      if ((definition.tier ?? 1) > 1)
        expect(isPlaceableBuilding(definition, 1)).toBe(false);
    }
  });

  it.each(routes)(
    "rotates $id at zero equipment stock, preserving all real contents and the original snapshot",
    (definition) => {
      let f = createLocalFactory(user, "原地改向");
      f.simulation.industry!.stage = 6;
      f.simulation.warehouse[definition.item!] = 1;
      f = editFactory(f, {
        kind: "place",
        id: "route",
        building_type: definition.id,
        placement: { x: 3, y: 3, rotation: 180 },
      });
      const instance = f.buildings.find((b) => b.id === "route")!;
      instance.configuration = { enabled: false, priority: 2 };
      const machine = f.simulation.buildings.route;
      if (definition.role === "belt") {
        machine.belt = {
          item: itemID("基础铁板"),
          count: 2,
          progress: 0,
          id: "preserved-load",
        };
      } else {
        machine.fluid = { item: itemID("净化水"), count: 4 };
      }
      const before = structuredClone(f);
      expect(f.simulation.warehouse[definition.item!] ?? 0).toBe(0);
      expect(directionEditTarget(f, { x: 3, y: 3 }, definition)?.id).toBe(
        "route",
      );
      for (const other of routes.filter((d) => d.id !== definition.id)) {
        expect(directionEditTarget(f, { x: 3, y: 3 }, other)).toBeUndefined();
      }
      const next = editFactory(f, {
        kind: "move",
        id: instance.id,
        placement: { x: instance.x, y: instance.y, rotation: 0 },
      });
      expect(next.revision).toBe(f.revision + 1);
      expect(next.buildings).toHaveLength(f.buildings.length);
      expect(next.buildings.find((b) => b.id === "route")).toEqual({
        ...instance,
        rotation: 0,
      });
      expect(next.simulation.buildings).toEqual(f.simulation.buildings);
      expect(next.simulation.warehouse).toEqual(f.simulation.warehouse);
      expect(next.simulation.industry).toEqual(f.simulation.industry);
      expect(f).toEqual(before);
    },
  );
});
