import { describe, expect, it } from "vitest";
import type { BuildingInstance } from "../../api/client";
import { itemID } from "./catalog";
import { step } from "./simulation";
import { createLocalFactory, newMachine, toSave, validateSave } from "./state";

const user = {
  id: "feeder-pickup",
  username: "pickup",
  display_name: "取货",
  created_at: "now",
  last_login_at: "now",
};
const item = itemID("垃圾包");
function line(target = "chest", sideways = false) {
  const f = createLocalFactory(user, "取货回归");
  const nodes: [
    string,
    string,
    number,
    number,
    BuildingInstance["rotation"],
  ][] = [
    ["belt", "hand_belt", 2, 2, 0],
    [
      "feeder",
      "feeder",
      sideways ? 2 : 3,
      sideways ? 3 : 2,
      sideways ? 270 : 0,
    ],
    ["target", target, sideways ? 2 : 4, sideways ? 4 : 2, 0],
  ];
  if (sideways) nodes.push(["pass", "chest", 3, 2, 0]);
  for (const [id, type, x, y, rotation] of nodes) {
    f.buildings.push({
      id,
      factory_id: f.id,
      building_type: type,
      x,
      y,
      rotation,
      configuration:
        type === "feeder"
          ? { interval: 0.5 }
          : type === "m02"
            ? { recipe_id: "r1001" }
            : {},
    });
    f.simulation.buildings[id] = newMachine();
  }
  return f;
}

describe("feeder polling and belt pickup", () => {
  it.each(["chest", "m02"])(
    "completes one pickup every half second into %s without waiting for belt travel",
    (target) => {
      let f = line(target);
      for (let tick = 1; tick <= 8; tick++) {
        f.simulation.buildings.belt.belt = {
          id: `load:${tick}`,
          item,
          count: 2,
          progress: 0,
        };
        const previous = structuredClone(f);
        f = step(f);
        expect(f.simulation.buildings.belt.belt).toBeUndefined();
        expect(f.simulation.buildings.feeder.status).toBe("transferring");
        expect(
          f.simulation.transfers!.filter((t) => t.tick === tick),
        ).toMatchObject([
          { count: 2, via: { id: "feeder" }, target: { id: "target" } },
        ]);
        expect(previous.simulation.buildings.belt.belt?.count).toBe(2);
        expect(() => validateSave(toSave(f), user.id)).not.toThrow();
      }
    },
  );

  it("picks every available batch before passive belt output regardless of tick rotation", () => {
    let f = line("chest", true);
    for (let tick = 1; tick <= 12; tick++) {
      f.simulation.buildings.belt.belt = {
        id: `ready:${tick}`,
        item,
        count: 2,
        progress: 2,
      };
      f = step(f);
      expect(f.simulation.buildings.feeder.status).toBe("transferring");
      expect(f.simulation.buildings.target.output).toEqual([
        { item, count: tick * 2 },
      ]);
      expect(f.simulation.buildings.pass.output).toEqual([]);
    }
  });

  it("reports source contention as waiting for source instead of downstream blockage", () => {
    let f = line();
    f.buildings.push(
      {
        id: "other-feeder",
        factory_id: f.id,
        building_type: "feeder",
        x: 2,
        y: 3,
        rotation: 270,
        configuration: { interval: 0.5 },
      },
      {
        id: "other-target",
        factory_id: f.id,
        building_type: "chest",
        x: 2,
        y: 4,
        rotation: 0,
        configuration: {},
      },
    );
    f.simulation.buildings["other-feeder"] = newMachine();
    f.simulation.buildings["other-target"] = newMachine();
    f.simulation.buildings.belt.belt = {
      id: "shared",
      item,
      count: 2,
      progress: 2,
    };
    f = step(f);
    expect(
      [
        f.simulation.buildings.feeder.status,
        f.simulation.buildings["other-feeder"].status,
      ].sort(),
    ).toEqual(["no_source", "transferring"]);
    expect(
      f.simulation.transfers!.filter((t) => t.tick === f.simulation.tick),
    ).toHaveLength(1);
    expect(
      f.simulation.buildings.target.output.concat(
        f.simulation.buildings["other-target"].output,
      ),
    ).toEqual([{ item, count: 2 }]);
  });

  it("keeps longer configured intervals between complete pickups", () => {
    let f = line();
    f.buildings.find((b) => b.id === "feeder")!.configuration.interval = 1.5;
    const delivered: number[] = [];
    for (let tick = 1; tick <= 8; tick++) {
      f.simulation.buildings.belt.belt ??= {
        id: `interval:${tick}`,
        item,
        count: 2,
        progress: 0,
      };
      f = step(f);
      if (f.simulation.transfers!.some((t) => t.tick === tick))
        delivered.push(tick);
    }
    expect(delivered).toEqual([1, 4, 7]);
    expect(f.simulation.buildings.target.output).toEqual([{ item, count: 6 }]);
  });

  it.each(["chest", "m02"])(
    "fills only real remaining space in %s and retries on the next poll after unblocking",
    (target) => {
      let f = line(target);
      const cache = target === "chest" ? "output" : "input";
      f.simulation.buildings.target[cache] = [{ item, count: 99 }];
      f.simulation.buildings.belt.belt = {
        id: "partial",
        item,
        count: 2,
        progress: 0,
      };
      f = step(f);
      expect(f.simulation.buildings.target[cache]).toEqual([
        { item, count: 100 },
      ]);
      expect(f.simulation.buildings.belt.belt).toMatchObject({
        id: "partial",
        count: 1,
      });
      const delivered = f.simulation.transfers!.at(-1)!;
      expect(delivered.count).toBe(1);
      expect(delivered.payload_id).not.toBe("partial");
      f = step(f);
      expect(f.simulation.buildings.feeder.status).toBe("blocked");
      expect(f.simulation.buildings.belt.belt?.count).toBe(1);
      expect(
        f.simulation.transfers!.some((t) => t.tick === f.simulation.tick),
      ).toBe(false);
      f.simulation.buildings.target[cache][0].count = 99;
      f = step(f);
      expect(f.simulation.buildings.belt.belt).toBeUndefined();
      expect(f.simulation.buildings.target[cache][0].count).toBe(100);
      expect(f.simulation.buildings.feeder.status).toBe("transferring");
      expect(() => validateSave(toSave(f), user.id)).not.toThrow();
    },
  );

  it("preserves rejected stock, disabled facilities and unpowered source belts", () => {
    let f = line();
    const target = f.buildings.find((b) => b.id === "target")!;
    target.configuration.filter = itemID("基础铁板");
    f.simulation.buildings.belt.belt = {
      id: "filtered",
      item,
      count: 2,
      progress: 0,
    };
    f = step(f);
    expect(f.simulation.buildings.feeder.status).toBe("rejected");
    expect(f.simulation.buildings.belt.belt?.count).toBe(2);
    expect(f.simulation.transfers).toEqual([]);
    target.configuration.filter = "";
    const feeder = f.buildings.find((b) => b.id === "feeder")!;
    feeder.configuration.enabled = false;
    f = step(f);
    expect(f.simulation.buildings.feeder.status).toBe("disabled");
    expect(f.simulation.buildings.belt.belt?.count).toBe(2);
    feeder.configuration.enabled = true;
    const belt = f.buildings.find((b) => b.id === "belt")!;
    belt.configuration.enabled = false;
    f = step(f);
    expect(f.simulation.buildings.feeder.status).toBe("no_source");
    expect(f.simulation.transfers).toEqual([]);
    belt.configuration.enabled = true;
    belt.building_type = "mechanical_belt";
    f = step(f);
    expect(f.simulation.buildings.belt.status).toBe("no_energy");
    expect(f.simulation.buildings.feeder.status).toBe("no_source");
    expect(f.simulation.buildings.belt.belt?.count).toBe(2);
  });

  it("never forwards a new belt arrival in the same tick but picks it on the very next half second", () => {
    let f = line();
    f.buildings.push({
      id: "upstream",
      factory_id: f.id,
      building_type: "hand_belt",
      x: 1,
      y: 2,
      rotation: 0,
      configuration: {},
    });
    f.simulation.buildings.upstream = newMachine();
    f.simulation.buildings.upstream.belt = {
      id: "arriving",
      item,
      count: 2,
      progress: 2,
    };
    f = step(f);
    expect(f.simulation.buildings.belt.belt).toMatchObject({
      id: "arriving",
      progress: 0,
    });
    expect(f.simulation.buildings.target.output).toEqual([]);
    expect(f.simulation.buildings.feeder.status).toBe("no_source");
    f = step(f);
    expect(f.simulation.buildings.belt.belt).toBeUndefined();
    expect(f.simulation.buildings.target.output).toEqual([{ item, count: 2 }]);
    expect(f.simulation.transfers!.at(-1)).toMatchObject({
      payload_id: "arriving",
      tick: 2,
      count: 2,
    });
  });

  it("releases an impossible pickup so passive belt output can still run", () => {
    let f = line("hand_belt", true);
    f.simulation.buildings.belt.belt = {
      id: "passing",
      item,
      count: 2,
      progress: 2,
    };
    f.simulation.buildings.target.belt = {
      id: "held",
      item,
      count: 2,
      progress: 2,
    };
    f = step(f);
    expect(f.simulation.buildings.pass.output).toEqual([{ item, count: 2 }]);
    expect(f.simulation.buildings.belt.belt).toBeUndefined();
    expect(f.simulation.buildings.target.belt).toMatchObject({
      id: "held",
      count: 2,
    });
    expect(f.simulation.buildings.feeder.status).toBe("no_source");
    expect(f.simulation.transfers).toEqual([]);
    expect(() => validateSave(toSave(f), user.id)).not.toThrow();
  });
});
