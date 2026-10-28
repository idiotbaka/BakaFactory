import { describe, expect, it } from "vitest";
import { catalog, itemID } from "./catalog";
import { toSave, validateSave } from "./state";
import { actWorld, createWorld, projectFactory } from "./world";

const user = {
  id: "developer-items",
  username: "developer-items",
  display_name: "开发",
  created_at: "now",
  last_login_at: "now",
};

describe("developer item grants", () => {
  it("keeps retired definitions out of the catalog and refuses their saved stock, buildings and recipes without mutation", () => {
    const retiredItems = ["iron_ore", "iron_plate", "gear"];
    const retiredBuildings = [
      "miner",
      "furnace",
      "assembler",
      "conveyor",
      "item_input",
      "item_output",
    ];
    const retiredRecipes = ["iron_mining", "iron_plate", "gear"];
    expect(catalog.items.some((i) => retiredItems.includes(i.id))).toBe(false);
    expect(catalog.buildings.some((b) => retiredBuildings.includes(b.id))).toBe(
      false,
    );
    expect(catalog.recipes.some((r) => retiredRecipes.includes(r.id))).toBe(
      false,
    );
    for (const item of retiredItems) {
      const root = createWorld(user, "已移除物品");
      root.simulation.warehouse[item] = 1;
      const save = toSave(root),
        before = structuredClone(save);
      expect(() => validateSave(save, user.id)).toThrow("存档");
      expect(save).toEqual(before);
      expect(() =>
        actWorld(root, { type: "developer_grant_item", item, count: 1 }),
      ).toThrow("请选择");
    }
    for (const type of retiredBuildings) {
      const root = createWorld(user, "已移除设备");
      root.buildings[0].building_type = type;
      const save = toSave(root),
        before = structuredClone(save);
      expect(() => validateSave(save, user.id)).toThrow("存档");
      expect(save).toEqual(before);
    }
    for (const recipe_id of retiredRecipes) {
      const root = createWorld(user, "已移除配方");
      root.simulation.industry!.workshop = { recipe_id, progress: 0 };
      const save = toSave(root),
        before = structuredClone(save);
      expect(() => validateSave(save, user.id)).toThrow("存档");
      expect(save).toEqual(before);
    }
  });
  it("adds locked items to the single ledger from another district without fabricating production or stage progress", () => {
    const root = createWorld(user, "物品测试");
    root.active_district_id = root.districts![0].id;
    const item = catalog.items.find((i) => i.tier === 6)!.id;
    root.simulation.warehouse[item] = 7;
    const before = structuredClone(root);
    const next = actWorld(root, {
      type: "developer_grant_item",
      item,
      count: 100,
    });
    expect(root).toEqual(before);
    expect(next.revision).toBe(root.revision + 1);
    expect(next.simulation.tick).toBe(root.simulation.tick);
    expect(next.simulation.warehouse[item]).toBe(107);
    expect(projectFactory(next).simulation.warehouse[item]).toBe(107);
    expect(
      next.districts!.every(
        (f) => Object.keys(f.simulation.warehouse).length === 0,
      ),
    ).toBe(true);
    const p = next.simulation.industry!;
    expect(p.discovered_items).toContain(item);
    expect(p.crafted).toEqual(root.simulation.industry!.crafted);
    expect(p.milestones).toEqual(root.simulation.industry!.milestones);
    expect(p.stage).toBe(1);
    expect(p.quests!.claimed).toEqual([]);
    expect(p.quests!.factory_produced).toEqual(
      root.simulation.industry!.quests!.factory_produced,
    );
    expect(p.quests!.warehouse_received).toEqual(
      root.simulation.industry!.quests!.warehouse_received,
    );
    expect(p.quests!.automated_received).toBe(
      root.simulation.industry!.quests!.automated_received,
    );
    const restored = validateSave(toSave(next), user.id);
    expect(restored.simulation.warehouse[item]).toBe(107);
    expect(restored.simulation.industry!.discovered_items).toContain(item);
  });

  it("supports every current catalog item, including fluid and DLC items, without a save format change", () => {
    let root = createWorld(user, "完整物品目录");
    for (const item of catalog.items) {
      root = actWorld(root, {
        type: "developer_grant_item",
        item: item.id,
        count: 1,
      });
    }
    const restored = validateSave(toSave(root), user.id);
    for (const item of catalog.items)
      expect(restored.simulation.warehouse[item.id]).toBe(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid quantity %s without changing the original world",
    (count) => {
      const root = createWorld(user, "非法数量");
      const before = structuredClone(root);
      expect(() =>
        actWorld(root, {
          type: "developer_grant_item",
          item: itemID("垃圾包"),
          count,
        }),
      ).toThrow("正安全整数");
      expect(root).toEqual(before);
    },
  );

  it("rejects unknown items and overflowing totals atomically", () => {
    const root = createWorld(user, "原子校验");
    const item = itemID("垃圾包");
    root.simulation.warehouse[item] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(root);
    for (const id of ["", "__proto__", "missing"])
      expect(() =>
        actWorld(root, { type: "developer_grant_item", item: id, count: 1 }),
      ).toThrow("请选择");
    expect(() =>
      actWorld(root, { type: "developer_grant_item", item, count: 1 }),
    ).toThrow("超出上限");
    expect(root).toEqual(before);
    root.simulation.warehouse[item] = Number.MAX_SAFE_INTEGER - 1;
    expect(
      actWorld(root, { type: "developer_grant_item", item, count: 1 })
        .simulation.warehouse[item],
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
