import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld } from "./world";
import { newMachine, toSave, validateSave } from "./state";

const user = {
  id: "diagnostic-owner",
  username: "private-username",
  display_name: "诊断",
  created_at: "now",
  last_login_at: "now",
};
afterEach(() => vi.restoreAllMocks());

describe("save validation diagnostics", () => {
  const withLoad = () => {
    const world = createWorld(user, "诊断");
    world.buildings.push({
      id: "belt",
      factory_id: world.id,
      building_type: "hand_belt",
      x: 1,
      y: 0,
      rotation: 0,
      configuration: {},
    });
    world.simulation.buildings.belt = {
      ...newMachine(),
      belt: { id: "payload:1:0", item: "i0028", count: 1, progress: 3 },
    };
    return toSave(world);
  };
  it.each([
    { item: undefined },
    { item: null },
    { item: "unknown-item" },
    { count: 2 },
    { progress: 4 },
    { id: "" },
  ])("rejects invalid loads without repairing the input: %j", (fields) => {
    const save = withLoad();
    Object.assign(save.factory.simulation!.buildings.belt.belt!, fields);
    const before = structuredClone(save);
    expect(() => validateSave(save, user.id)).toThrow("原存档已保留");
    expect(save).toEqual(before);
  });
  it("reports a missing load item instead of clearing it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = withLoad();
    Object.assign(save.factory.simulation!.buildings.belt.belt!, {
      item: undefined,
    });
    const before = structuredClone(save);
    expect(() =>
      validateSave(save, user.id, { source: "本机 IndexedDB" }),
    ).toThrow("原存档已保留");
    expect(log.mock.calls[0][1]).toMatchObject({
      source: "本机 IndexedDB",
      path: "factory.simulation.buildings[belt].belt.item",
      reason: "载荷必须为已知固体物品",
      details: { item_type: "undefined", count: 1, capacity: 1 },
    });
    expect(save).toEqual(before);
  });
  it("reports an unidentified district container stack without discarding stock", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = withLoad();
    const child = save.factory.districts![0];
    child.buildings.push({
      id: "box",
      factory_id: child.id,
      building_type: "chest",
      x: 2,
      y: 0,
      rotation: 0,
      configuration: {},
    });
    child.simulation!.buildings.box = {
      ...newMachine(),
      output: [
        { item: "i0028", count: 20 },
        { item: "i0030", count: 1 },
      ],
    };
    Object.assign(child.simulation!.buildings.box.output[1], {
      item: undefined,
    });
    const before = structuredClone(save);
    expect(() =>
      validateSave(save, user.id, { source: "本机 IndexedDB" }),
    ).toThrow("原存档已保留");
    expect(log.mock.calls[0][1]).toMatchObject({
      path: "factory.districts[0].simulation.buildings[box].output[1]",
      details: { item_type: "undefined", count: 1 },
    });
    expect(save).toEqual(before);
  });
  it.each(["warehouse", "quests"] as const)(
    "rejects an undefined item key in %s without changing inventory or task statistics",
    (field) => {
      const save = withLoad();
      if (field === "warehouse")
        save.factory.simulation!.warehouse.undefined = 4;
      else
        Object.assign(save.factory.simulation!.industry!.quests!, {
          warehouse_received: { undefined: 5 },
          automated_received: 5,
        });
      const before = structuredClone(save);
      expect(() => validateSave(save, user.id)).toThrow("原存档已保留");
      expect(save).toEqual(before);
    },
  );
  it("reports an exact belt field and its limits for validly identified loads", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = withLoad();
    save.factory.simulation!.buildings.belt.belt!.count = 2;
    expect(() =>
      validateSave(save, user.id, { source: "本机 IndexedDB" }),
    ).toThrow();
    expect(log.mock.calls[0][1]).toMatchObject({
      source: "本机 IndexedDB",
      path: "factory.simulation.buildings[belt].belt.count",
      reason: "载荷数量超出带容量",
      details: { count: 2, capacity: 1, progress: 3, max_progress: 3 },
    });
  });
  it("logs the source and exact nested machine field once without modifying the save", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = createWorld(user, "private-factory-name");
    const child = world.districts![1];
    const bus = child.buildings[0].id;
    child.simulation.buildings[bus].cooldown = 61;
    const save = toSave(world),
      before = structuredClone(save);
    expect(() =>
      validateSave(save, user.id, { source: "本机 IndexedDB" }),
    ).toThrow("原存档已保留");
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("[BakaFactory] 存档校验失败"),
      {
        source: "本机 IndexedDB",
        path: `factory.districts[1].simulation.buildings[${bus}].cooldown`,
        reason: "必须为 0～60 的安全整数",
      },
    );
    expect(save).toEqual(before);
    expect(JSON.stringify(log.mock.calls)).not.toContain(user.username);
    expect(JSON.stringify(log.mock.calls)).not.toContain(world.name);
  });

  it("identifies unsupported queue fields without printing their values or weakening validation", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const world = createWorld(user, "诊断");
    Object.assign(world.simulation.industry!, {
      workshop: {
        recipe_id: "r1001",
        progress: 0,
        legacy_field: "private-value",
      },
    });
    expect(() =>
      validateSave(toSave(world), user.id, { source: "云备份（登录校验）" }),
    ).toThrow();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[BakaFactory] 存档校验失败"),
      {
        source: "云备份（登录校验）",
        path: "factory.simulation.industry.workshop.legacy_field",
        reason: "手工队列包含不支持的字段",
      },
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-value");
  });

  it("keeps valid saves and callers without an explicit diagnostic source silent", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = withLoad();
    expect(() =>
      validateSave(save, user.id, { source: "本机 IndexedDB" }),
    ).not.toThrow();
    Object.assign(save.factory.simulation!, { tick_rate: 2 });
    expect(() => validateSave(save, user.id)).toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
