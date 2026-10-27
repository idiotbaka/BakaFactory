import { STEP_SECONDS, onInterval } from "./simulationTime";
import { occupancy, edgeCells } from "../footprint";
import type { BuildingInstance } from "../../api/client";
import type { components } from "../../api/schema";
import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  direction,
  isBelt,
  isPort,
  itemID,
  selectedRecipe,
} from "./catalog";
import { enabled, rotations } from "./transportConfig";
import { fuelAvailable, spendFuel } from "./fuel";
import { productionReady, workDemand, workKind } from "./production";

export type PowerKind = "shaft" | "hydraulic" | "electric";
type Network = components["schemas"]["PowerNetwork"];
type Group = {
  id: string;
  kind: PowerKind;
  wires: BuildingInstance[];
  members: BuildingInstance[];
};
const kinds: PowerKind[] = ["shaft", "hydraulic", "electric"];
const strategicItems = ["液体燃料", "固体燃料块", "净化水"].map(itemID);
export const producerKind = (type: string): PowerKind | undefined =>
  type === "m09"
    ? "shaft"
    : type === "m21"
      ? "hydraulic"
      : type === "m28"
        ? "electric"
        : undefined;
const wireKind = (type: string): PowerKind | undefined =>
  type === "shaft"
    ? "shaft"
    : type === "hydraulic_line"
      ? "hydraulic"
      : type === "cable"
        ? "electric"
        : undefined;
export const isPowerFacility = (type: string) =>
  !!wireKind(type) ||
  !!producerKind(type) ||
  buildingDefinitions.get(type)?.role === "battery";
const compare = (a: BuildingInstance, b: BuildingInstance) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const rotate = <T>(rows: T[], tick: number) =>
  rows.length
    ? [...rows.slice(tick % rows.length), ...rows.slice(0, tick % rows.length)]
    : rows;
export function powerPriority(b: BuildingInstance) {
  if (typeof b.configuration.priority === "number")
    return b.configuration.priority;
  if (producerKind(b.building_type)) return 1;
  if (
    isBelt(b.building_type) ||
    isPort(b.building_type) ||
    buildingDefinitions.get(b.building_type)?.role === "station"
  )
    return 2;
  if (b.building_type === "m51") return 6;
  const outputs = selectedRecipe(b)?.outputs;
  return outputs && strategicItems.some((id) => outputs[id]) ? 1 : 3;
}

// Only conductor tiles connect a grid. A machine touching separate grids uses
// one explicit/first cardinal side; it never silently bridges those grids.
function groupsFor(ordered: BuildingInstance[]) {
  const positions = occupancy(ordered);
  const groups: Group[] = [];
  for (const kind of kinds) {
    const membership = new Map<string, Group>();
    for (const start of ordered) {
      if (
        wireKind(start.building_type) !== kind ||
        !enabled(start) ||
        membership.has(start.id)
      )
        continue;
      const group: Group = {
          id: `${kind}:${start.id}`,
          kind,
          wires: [],
          members: [],
        },
        queue = [start];
      membership.set(start.id, group);
      for (let index = 0; index < queue.length; index++) {
        const b = queue[index];
        group.wires.push(b);
        for (const r of rotations) {
          const [dx, dy] = direction(r),
            next = positions.get(`${b.x + dx},${b.y + dy}`);
          if (
            next &&
            wireKind(next.building_type) === kind &&
            enabled(next) &&
            !membership.has(next.id)
          ) {
            membership.set(next.id, group);
            queue.push(next);
          }
        }
      }
      groups.push(group);
    }
    for (const b of ordered) {
      if (!enabled(b) || wireKind(b.building_type)) continue;
      const d = buildingDefinitions.get(b.building_type)!,
        consumerKind = workKind(b) ?? (d.energy === kind ? kind : undefined);
      if (
        producerKind(b.building_type) !== kind &&
        consumerKind !== kind &&
        !(kind === "electric" && d.role === "battery")
      )
        continue;
      const side =
        typeof b.configuration.power_side === "number" &&
        b.configuration.power_side !== -1
          ? [b.configuration.power_side]
          : rotations;
      let group: Group | undefined;
      for (const r of side) {
        for (const p of edgeCells(b, r)) {
          const next = positions.get(`${p.x},${p.y}`);
          group = next && membership.get(next.id);
          if (group) break;
        }
        if (group) break;
      }
      if (!group && b.building_type === "m21" && kind === "hydraulic") {
        group = {
          id: `hydraulic:internal:${b.id}`,
          kind,
          wires: [],
          members: [],
        };
        groups.push(group);
      }
      group?.members.push(b);
    }
  }
  return groups;
}

export function allocatePower(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation;
  for (const b of ordered) {
    const m = s.buildings[b.id];
    m.supplied_kw = 0;
    m.generated_kw = 0;
    m.power_demand_kw = 0;
    m.powered = false;
    delete m.network_id;
    if (isPowerFacility(b.building_type))
      m.status = enabled(b) ? "no_network" : "disabled";
    if (
      buildingDefinitions.get(b.building_type)?.role === "station" &&
      (m.work_energy_kj ?? 0) > 0
    ) {
      m.station_energy_kj = Math.min(
        buildingDefinitions.get(b.building_type)!.station_capacity_kj ?? 0,
        (m.station_energy_kj ?? 0) + m.work_energy_kj!,
      );
      m.work_energy_kj = 0;
    }
  }
  const allRequests = ordered.flatMap((b) => {
    const d = buildingDefinitions.get(b.building_type)!,
      m = s.buildings[b.id];
    if (!enabled(b)) return [];
    if (d.role === "pump" && b.configuration.fluid_rate === 0) return [];
    const transport =
      isBelt(b.building_type) ||
      isPort(b.building_type) ||
      d.role === "pump" ||
      d.role === "station";
    const station = d.role === "station";
    const demand = station
      ? Math.min(
          d.power_kw ?? 0,
          ((d.station_capacity_kj ?? 0) - (m.station_energy_kj ?? 0)) /
            STEP_SECONDS,
        )
      : transport
        ? (d.power_kw ?? 0)
        : productionReady(f, b) === "working"
          ? workDemand(b)
          : 0;
    m.power_demand_kw = demand;
    const kind = transport ? d.energy : workKind(b);
    if (!demand || !kinds.includes(kind as PowerKind)) return [];
    return [
      {
        b,
        demand,
        needed: Math.min(
          demand * STEP_SECONDS,
          Math.max(
            0,
            demand * (d.role === "pump" ? 1 : STEP_SECONDS) -
              (m.work_energy_kj ?? 0),
          ),
        ),
        priority: powerPriority(b),
        transport,
        station,
      },
    ];
  });
  const requestIndex = new Map(allRequests.map((r) => [r.b.id, r]));
  const networks: Network[] = [];
  for (const g of groupsFor(ordered)) {
    for (const b of [...g.wires, ...g.members]) {
      s.buildings[b.id].network_id = g.id;
      if (wireKind(b.building_type)) s.buildings[b.id].status = "connected";
    }
    const requests = g.members.flatMap((b) => {
      const r = requestIndex.get(b.id);
      return r ? [r] : [];
    });
    const generators = rotate(
      g.members
        .filter((b) => producerKind(b.building_type) === g.kind)
        .sort(compare),
      s.tick,
    );
    const batteries = rotate(
      g.members
        .filter(
          (b) => buildingDefinitions.get(b.building_type)?.role === "battery",
        )
        .sort(compare),
      s.tick,
    );
    const genBudget = new Map(
      generators.map((b) => [
        b.id,
        b.building_type === "m21" && !(s.buildings[b.id].medium ?? 0)
          ? 0
          : Math.min(
              (buildingDefinitions.get(b.building_type)!.power_kw ?? 0) *
                STEP_SECONDS,
              fuelAvailable(
                s.buildings[b.id],
                buildingDefinitions.get(b.building_type)!,
              ),
            ),
      ]),
    );
    const batteryBudget = new Map(
      batteries.map((b) => [
        b.id,
        ["charge", "hold"].includes(b.configuration.battery_mode as string)
          ? 0
          : Math.min(
              s.buildings[b.id].charge_kj ?? 0,
              (buildingDefinitions.get(b.building_type)?.transfer_kw ?? 100) *
                STEP_SECONDS,
            ),
      ]),
    );
    const discharged = new Set<string>();
    const net: Network = {
      id: g.id,
      kind: g.kind,
      producers: generators.length,
      consumers: requests.length,
      capacity_kw: [...genBudget.values(), ...batteryBudget.values()].reduce(
        (a, n) => a + n / STEP_SECONDS,
        0,
      ),
      demand_kw: requests.reduce((sum, r) => sum + r.demand, 0),
      supplied_kw: 0,
      loss_kw: 0,
      charge_kw: 0,
      discharge_kw: 0,
      stored_kj: 0,
    };
    const take = (amount: number, priority: number, allowBattery = true) => {
      let remaining = amount;
      for (const b of generators) {
        const n = Math.min(remaining, genBudget.get(b.id)!);
        if (
          n &&
          spendFuel(
            s.buildings[b.id],
            buildingDefinitions.get(b.building_type)!,
            n,
          )
        ) {
          genBudget.set(b.id, genBudget.get(b.id)! - n);
          s.buildings[b.id].generated_kw =
            (s.buildings[b.id].generated_kw ?? 0) + n / STEP_SECONDS;
          remaining -= n;
        }
        if (!remaining) break;
      }
      if (allowBattery && remaining)
        for (const b of batteries) {
          const m = s.buildings[b.id],
            reserve =
              priority === 1
                ? 0
                : typeof b.configuration.reserve_kj === "number"
                  ? b.configuration.reserve_kj
                  : 0;
          const n = Math.min(
            remaining,
            batteryBudget.get(b.id)!,
            Math.max(0, (m.charge_kj ?? 0) - reserve),
          );
          if (n) {
            m.charge_kj = (m.charge_kj ?? 0) - n;
            m.generated_kw = (m.generated_kw ?? 0) + n / STEP_SECONDS;
            batteryBudget.set(b.id, batteryBudget.get(b.id)! - n);
            remaining -= n;
            discharged.add(b.id);
            net.discharge_kw += n / STEP_SECONDS;
          }
          if (!remaining) break;
        }
      return amount - remaining;
    };
    const needsEnergy = requests.some((r) => r.needed > 0),
      overhead =
        g.kind === "shaft" && needsEnergy
          ? Math.ceil(g.wires.length / 12) * STEP_SECONDS
          : 0;
    const maySupply = !overhead || net.capacity_kw * STEP_SECONDS > overhead;
    if (maySupply && overhead)
      net.loss_kw = take(overhead, 1, false) / STEP_SECONDS;
    if (maySupply)
      for (let priority = 1; priority <= 6; priority++) {
        for (const r of rotate(
          requests
            .filter((r) => r.priority === priority)
            .sort((a, b) => compare(a.b, b.b)),
          s.tick,
        )) {
          const n = take(r.needed, priority),
            m = s.buildings[r.b.id];
          if (r.station) m.station_energy_kj = (m.station_energy_kj ?? 0) + n;
          else m.work_energy_kj = (m.work_energy_kj ?? 0) + n;
          m.supplied_kw = n / STEP_SECONDS;
          net.supplied_kw += n / STEP_SECONDS;
        }
      }
    for (const r of requests) {
      const m = s.buildings[r.b.id];
      if (r.station) m.powered = (m.supplied_kw ?? 0) > 0;
      else if (r.transport) {
        const pump =
          buildingDefinitions.get(r.b.building_type)?.role === "pump";
        if (pump && !onInterval(s.tick, 1)) {
          // The pump pays continuously but transfers whole fluid units on its
          // own one-second cadence. Show supply without spending that credit twice.
          m.powered = (m.supplied_kw ?? 0) >= r.demand;
          continue;
        }
        const energy = r.demand * (pump ? 1 : STEP_SECONDS);
        if ((m.work_energy_kj ?? 0) < energy) continue;
        m.work_energy_kj = (m.work_energy_kj ?? 0) - energy;
        m.powered = true;
      }
    }
    // Charge only with unused generator output. A battery never charges and
    // discharges in one tick, and battery-to-battery charging cannot create a loop.
    for (const b of batteries) {
      const m = s.buildings[b.id],
        d = buildingDefinitions.get(b.building_type)!,
        capacity = d.capacity_kj ?? 15000;
      if (
        !discharged.has(b.id) &&
        !["discharge", "hold"].includes(
          b.configuration.battery_mode as string,
        ) &&
        (m.charge_kj ?? 0) < capacity
      ) {
        const input = Math.min(
          (d.transfer_kw ?? 100) * STEP_SECONDS,
          Math.ceil(
            ((capacity - (m.charge_kj ?? 0)) * 100 -
              (m.charge_remainder ?? 0)) /
              88 /
              STEP_SECONDS,
          ) * STEP_SECONDS,
        );
        const n = take(input, 6, false),
          scaled = n * 88 + (m.charge_remainder ?? 0);
        m.charge_kj = Math.min(
          capacity,
          (m.charge_kj ?? 0) + Math.floor(scaled / 100),
        );
        m.charge_remainder = m.charge_kj === capacity ? 0 : scaled % 100;
        m.supplied_kw = n / STEP_SECONDS;
        net.charge_kw += n / STEP_SECONDS;
      }
      m.status = discharged.has(b.id)
        ? "discharging"
        : (m.supplied_kw ?? 0) > 0
          ? "charging"
          : (m.charge_kj ?? 0) >= capacity
            ? "charged"
            : "storage";
      net.stored_kj += m.charge_kj ?? 0;
    }
    for (const b of generators) {
      const m = s.buildings[b.id];
      m.status =
        b.building_type === "m21" && !(m.medium ?? 0)
          ? "no_medium"
          : !fuelAvailable(m, buildingDefinitions.get(b.building_type)!) &&
              !(m.generated_kw ?? 0)
            ? "no_fuel"
            : (m.generated_kw ?? 0) > 0
              ? "generating"
              : "idle";
    }
    networks.push(net);
  }
  s.networks = networks;
  for (const b of ordered) {
    const d = buildingDefinitions.get(b.building_type)!;
    if (d.role !== "station") continue;
    const m = s.buildings[b.id];
    m.status = !enabled(b)
      ? "disabled"
      : (m.station_energy_kj ?? 0) >= (d.station_capacity_kj ?? 0)
        ? "charged"
        : (m.supplied_kw ?? 0) > 0
          ? "charging"
          : m.network_id
            ? "no_energy"
            : "no_network";
  }
}
