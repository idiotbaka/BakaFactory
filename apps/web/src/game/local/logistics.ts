import { STEP_SECONDS, ticksToSeconds, secondsToTicks } from "./simulationTime";
import { occupancy, contactCell } from "../footprint";
import type {
  BuildingInstance,
  ItemTransfer,
  MachineState,
} from "../../api/client";
import type { LocalFactory } from "./state";
import { discoverItems } from "./discovery";
import { recordWarehouseDelivery } from "./quests";
import {
  buildingDefinitions,
  beltCapacity,
  beltTicks,
  catalog,
  direction,
  isBelt,
  isChest,
  isFluid,
  isPort,
  itemDefinitions,
  selectedRecipe,
} from "./catalog";
import { add, count, remove, type Inventory } from "./inventory";
import {
  branchFilter,
  channel,
  enabled,
  face,
  interval,
  itemFilter,
  isSolidTransport,
  rotations,
  side,
} from "./transportConfig";
import { fuelValues } from "./fuel";
import { isUnderground, isUndergroundEntry } from "./underground";
import {
  pickupType,
  intakeType,
  isWarehouseTerminal,
  terminalItems,
} from "./warehouseIO";

type Candidate = {
  source: BuildingInstance;
  target: BuildingInstance;
  via?: BuildingInstance;
  actor: string;
  items: string[];
  limit: number;
};
type Move = Omit<Candidate, "items"> & {
  item: string;
  candidate: Candidate;
  quantity: number;
  payload: string;
  destination: "input" | "output" | "fuel" | "warehouse" | "belt";
};
const endpoint = (b: BuildingInstance, neighbor?: BuildingInstance) => ({
  id: b.id,
  building_type: b.building_type,
  ...(neighbor ? contactCell(b, neighbor) : { x: b.x, y: b.y }),
  rotation: b.rotation,
});
export const poweredTransport = (b: BuildingInstance, m: MachineState) => {
  const d = buildingDefinitions.get(b.building_type)!;
  return !d.energy || d.energy === "none" || m.powered === true;
};

export function advanceTransport(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation;
  for (const b of ordered) {
    const m = s.buildings[b.id],
      d = buildingDefinitions.get(b.building_type)!;
    if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - STEP_SECONDS);
    if (b.building_type === "bus" || isWarehouseTerminal(b.building_type)) {
      m.status = enabled(b) ? "warehouse" : "disabled";
      continue;
    }
    if (
      !isBelt(b.building_type) &&
      !isPort(b.building_type) &&
      !isChest(b.building_type) &&
      d.role !== "source"
    )
      continue;
    if (!enabled(b)) {
      m.status = "disabled";
      continue;
    }
    if (!poweredTransport(b, m)) {
      m.status = "no_energy";
      continue;
    }
    if (isBelt(b.building_type)) {
      m.duration = ticksToSeconds(beltTicks(b.building_type));
      if (m.belt) {
        m.belt.progress = Math.min(
          beltTicks(b.building_type),
          m.belt.progress + 1,
        );
        m.status =
          m.belt.progress >= beltTicks(b.building_type)
            ? "blocked"
            : "transporting";
      } else m.status = "idle";
    } else if (isPort(b.building_type))
      m.status = m.cooldown > 0 ? "transferring" : "no_source";
    else if (isChest(b.building_type)) m.status = "storage";
    else if (d.role === "source") {
      m.duration = 10;
      const output = structuredClone(m.output);
      if (!add(output, catalog.root_item!, 12, d.output_slots)) {
        m.status = "output_full";
        continue;
      }
      m.progress += STEP_SECONDS;
      m.status = "working";
      if (m.progress >= 10) {
        m.output = output;
        discoverItems(f, [catalog.root_item!]);
        m.progress = 0;
      }
    }
  }
}

// All candidates read pre-transfer stock. Reservations are conservative when
// an inventory is simultaneously receiving; no downstream item can move twice.
export function transferSolids(f: LocalFactory, ordered: BuildingInstance[]) {
  const s = f.simulation;
  s.transfers ??= [];
  const positions = occupancy(ordered);
  const nodes = new Map(ordered.map((b) => [b.id, b]));
  const adjacent = (b: BuildingInstance, r: number, offset = 1) => {
    const [dx, dy] = direction(r);
    return positions.get(`${b.x + dx * offset},${b.y + dy * offset}`);
  };
  const usable = (b: BuildingInstance) =>
    (!isSolidTransport(b.building_type) || enabled(b)) &&
    ((!isBelt(b.building_type) && !isPort(b.building_type)) ||
      poweredTransport(b, s.buildings[b.id]));
  const sourceItems = (
    b: BuildingInstance,
    anchor: BuildingInstance,
    filter = "",
  ) => {
    if (!usable(b)) return [];
    const m = s.buildings[b.id];
    if (isUndergroundEntry(b)) return [];
    if (b.building_type === pickupType) {
      if (m.cooldown || side(b, anchor) !== b.rotation) return [];
      const items = terminalItems(b),
        cursor = (m.terminal_cursor ?? 0) % items.length;
      return [...items.slice(cursor), ...items.slice(0, cursor)].filter(
        (id) => (!filter || filter === id) && (s.warehouse[id] ?? 0) > 0,
      );
    }
    if (b.building_type === intakeType) return [];
    if (b.building_type === "bus") {
      const r = side(b, anchor),
        output = r === undefined ? undefined : face(b, r);
      return output?.mode === "output" &&
        output.filter &&
        (!filter || filter === output.filter) &&
        (s.warehouse[output.filter] ?? 0) > 0 &&
        !isFluid(output.filter)
        ? [output.filter]
        : [];
    }
    if (isBelt(b.building_type))
      return m.belt &&
        // An arm polls the stock already on this cell; only passive belt
        // output must wait for the cell's full travel time.
        (isPort(anchor.building_type) ||
          m.belt.progress >= beltTicks(b.building_type)) &&
        (!filter || m.belt.item === filter) &&
        !isFluid(m.belt.item)
        ? [m.belt.item]
        : [];
    return m.output
      .filter(
        (stack) =>
          stack.count > 0 &&
          !isFluid(stack.item) &&
          (!filter || stack.item === filter),
      )
      .map((stack) => stack.item);
  };
  let candidates: Candidate[] = [];
  for (const b of ordered) {
    if (!usable(b)) continue;
    const m = s.buildings[b.id],
      d = buildingDefinitions.get(b.building_type)!;
    if (isBelt(b.building_type)) {
      const target = adjacent(b, b.rotation),
        [item] = sourceItems(b, b, itemFilter(b));
      if (
        !target ||
        !item ||
        (!["bus", "chest", intakeType].includes(target.building_type) &&
          !isBelt(target.building_type) &&
          !isChest(target.building_type))
      )
        continue;
      if (
        isBelt(target.building_type) &&
        adjacent(target, target.rotation)?.id === b.id
      )
        continue;
      candidates.push({
        source: b,
        target,
        actor: b.id,
        items: [item],
        limit: beltCapacity(b.building_type),
      });
    } else if (isPort(b.building_type) && !m.cooldown) {
      const source = adjacent(b, b.rotation, -1);
      if (!source || isPort(source.building_type)) continue;
      const branches =
        d.role === "splitter"
          ? [b.rotation, (b.rotation + 90) % 360, (b.rotation + 270) % 360]
          : [b.rotation];
      const offset =
        Math.floor(s.tick / secondsToTicks(interval(b))) % branches.length;
      const rotated = [...branches.slice(offset), ...branches.slice(0, offset)];
      for (const r of rotated) {
        const target = adjacent(b, r),
          items = sourceItems(
            source,
            b,
            d.role === "splitter" ? branchFilter(b, r) : itemFilter(b),
          );
        if (!target || !items.length || isPort(target.building_type)) continue;
        candidates.push({
          source,
          target,
          via: b,
          actor: b.id,
          items,
          limit: d.batch_size ?? 1,
        });
      }
    } else if (b.building_type === pickupType && !m.cooldown) {
      const target = adjacent(b, b.rotation);
      if (target && !isPort(target.building_type)) {
        const [dx, dy] = direction(b.rotation);
        const items = sourceItems(b, { ...target, x: b.x + dx, y: b.y + dy });
        if (items.length)
          candidates.push({ source: b, target, actor: b.id, items, limit: 1 });
      }
    } else if (b.building_type === "bus" && !m.cooldown) {
      for (const r of rotations) {
        const target = adjacent(b, r),
          output = face(b, r);
        if (
          !target ||
          output.mode !== "output" ||
          isPort(target.building_type) ||
          isFluid(output.filter) ||
          !(s.warehouse[output.filter] ?? 0)
        )
          continue;
        candidates.push({
          source: b,
          target,
          actor: `${b.id}:${r}`,
          items: [output.filter],
          limit: 1,
        });
      }
    }
  }
  // A tunnel is a routing edge, not an extra actor or an intermediate stock.
  // Reserve the real exit buffer in the same transaction as the surface source.
  const tunnels = new Set<Candidate>();
  candidates = candidates.flatMap((c) => {
    if (!isUnderground(c.target)) return [c];
    if (!isUndergroundEntry(c.target)) return [];
    const entry = c.target,
      exit = nodes.get(entry.configuration.underground_peer as string);
    const anchor = c.via ?? c.source,
      [dx, dy] = direction(entry.rotation);
    if (
      !exit ||
      !usable(entry) ||
      !usable(exit) ||
      anchor.x !== entry.x - dx ||
      anchor.y !== entry.y - dy
    )
      return [];
    const filter = itemFilter(entry);
    const route = {
      ...c,
      target: exit,
      items: c.items.filter((id) => !filter || id === filter),
    };
    if (!route.items.length) return [];
    tunnels.add(route);
    return [route];
  });
  if (candidates.length) {
    // A one-second producer becomes ready on even ticks. Rotating by raw
    // half-ticks would always favor the same actor when there are two peers.
    const offset = Math.floor(ticksToSeconds(s.tick)) % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }
  // An active pickup gets first refusal on its belt's old stock. Otherwise
  // passive output can win on alternating rotations and skip a ready arm.
  // Keep the rotated order between arms; failed pickups reserve nothing.
  const pickup = (c: Candidate) => c.via && isBelt(c.source.building_type);
  candidates = [
    ...candidates.filter(pickup),
    ...candidates.filter((c) => !pickup(c)),
  ];
  const excluded = new Set<Candidate>();
  const routesFrom = new Map<string, Candidate[]>(),
    routesTo = new Map<string, Candidate[]>();
  for (const route of candidates) {
    routesFrom.set(route.source.id, [
      ...(routesFrom.get(route.source.id) ?? []),
      route,
    ]);
    routesTo.set(route.target.id, [
      ...(routesTo.get(route.target.id) ?? []),
      route,
    ]);
  }
  const select = () => {
    const failures = new Map<Candidate, "blocked" | "rejected">();
    const fail = (c: Candidate, status: "blocked" | "rejected") => {
      if (failures.get(c) !== "blocked") failures.set(c, status);
    };
    const chosen: Move[] = [],
      beltSources = new Map<string, number>(),
      beltTargets = new Set<string>(),
      actors = new Set<string>();
    const terminalSources = new Set<string>();
    const sources = new Map<string, Inventory>(),
      inputs = new Map<string, Inventory>(),
      outgoing = new Map<string, number>(),
      incoming = new Map<string, number>();
    const payloads = new Set(
      Object.values(s.buildings).flatMap((m) => (m.belt ? [m.belt.id] : [])),
    );
    for (const c of candidates) {
      if (excluded.has(c)) continue;
      const { source, target } = c,
        sourceState = s.buildings[source.id],
        targetState = s.buildings[target.id],
        targetDef = buildingDefinitions.get(target.building_type)!;
      const validTarget =
        isBelt(target.building_type) ||
        isChest(target.building_type) ||
        target.building_type === "bus" ||
        target.building_type === intakeType ||
        (targetDef.category === "machine" && !isPort(target.building_type));
      if (
        actors.has(c.actor) ||
        (source.building_type === pickupType &&
          terminalSources.has(source.id)) ||
        (isBelt(source.building_type) && beltSources.has(source.id))
      )
        continue;
      // Try every old output stack on this route before giving up. Failed
      // probes reserve nothing; one successful item consumes the actor's turn.
      for (const item of c.items) {
        const sourceCount = isBelt(source.building_type)
          ? (sourceState.belt?.count ?? 1)
          : source.building_type === "bus" ||
              source.building_type === pickupType
            ? (s.warehouse[item] ?? 0) - (outgoing.get(item) ?? 0)
            : count(sources.get(source.id) ?? sourceState.output, item);
        let n = Math.min(
            sourceCount,
            c.limit,
            source.building_type === pickupType ? 1 : Infinity,
          ),
          destination: Move["destination"],
          inv: Inventory | undefined;
        // Source reservations are not downstream capacity failures.
        if (n < 1) continue;
        if (!usable(target) || !validTarget) {
          fail(c, "blocked");
          continue;
        }
        if (isBelt(target.building_type)) {
          if (beltTargets.has(target.id)) {
            fail(c, "blocked");
            continue;
          }
          n = Math.min(n, beltCapacity(target.building_type));
          destination = "belt";
          if (itemFilter(target) && itemFilter(target) !== item) {
            fail(c, "rejected");
            continue;
          }
        } else if (
          target.building_type === "bus" ||
          target.building_type === intakeType
        ) {
          const r = side(target, c.via ?? source),
            intake =
              target.building_type === intakeType
                ? { mode: "input", filter: "" }
                : r === undefined
                  ? undefined
                  : face(target, r);
          if (
            !intake ||
            intake.mode !== "input" ||
            (intake.filter && intake.filter !== item)
          ) {
            fail(c, "rejected");
            continue;
          }
          destination = "warehouse";
          n = Math.min(
            n,
            Number.MAX_SAFE_INTEGER -
              (s.warehouse[item] ?? 0) -
              (incoming.get(item) ?? 0),
          );
        } else {
          destination = isChest(target.building_type)
            ? "output"
            : c.via && channel(c.via) === "fuel"
              ? "fuel"
              : "input";
          const accepts =
            destination === "output"
              ? !itemFilter(target) || itemFilter(target) === item
              : destination === "fuel"
                ? !!fuelValues(targetDef)[item]
                : !!selectedRecipe(target)?.inputs[item];
          if (!accepts) {
            fail(c, "rejected");
            continue;
          }
          const key = `${target.id}:${destination}`;
          inv = structuredClone(
            inputs.get(key) ?? targetState[destination] ?? [],
          );
          const slots =
            destination === "fuel"
              ? 3
              : destination === "output"
                ? targetDef.output_slots
                : targetDef.input_slots;
          if (
            !inv.some((stack) => stack.item === item) &&
            inv.length >= (slots ?? 4)
          ) {
            fail(c, "blocked");
            continue;
          }
          n = Math.min(n, 100 - count(inv, item));
        }
        if (n < 1) {
          fail(c, "blocked");
          continue;
        }
        if (inv) {
          add(inv, item, n);
          inputs.set(`${target.id}:${destination}`, inv);
        }
        if (isBelt(source.building_type))
          beltSources.set(source.id, chosen.length);
        else if (
          source.building_type === "bus" ||
          source.building_type === pickupType
        )
          outgoing.set(item, (outgoing.get(item) ?? 0) + n);
        else {
          const inv = structuredClone(
            sources.get(source.id) ?? sourceState.output,
          );
          remove(inv, item, n);
          sources.set(source.id, inv);
        }
        if (destination === "belt") beltTargets.add(target.id);
        if (destination === "warehouse")
          incoming.set(item, (incoming.get(item) ?? 0) + n);
        actors.add(c.actor);
        if (source.building_type === pickupType) terminalSources.add(source.id);
        let payload =
          sourceState.belt && n === (sourceState.belt.count ?? 1)
            ? sourceState.belt.id
            : `payload:${s.tick}:${chosen.length}`;
        if (payload !== sourceState.belt?.id) {
          let collision = 0;
          const base = payload;
          while (payloads.has(payload)) payload = `${base}:${++collision}`;
          payloads.add(payload);
        }
        chosen.push({
          source,
          target,
          via: c.via,
          actor: c.actor,
          limit: c.limit,
          item,
          candidate: c,
          quantity: n,
          payload,
          destination,
        });
        break;
      }
    }
    return { chosen, beltSources, sources, outgoing, failures };
  };
  // A receiving belt must be completely vacated in this same batch. Partial
  // withdrawals cannot free its cell; full closed loops still move atomically.
  // Drop only a route whose immediate belt dependency cannot vacate, then
  // rebuild reservations so its actor can try another branch in this tick.
  // Without a blocked dependency every chain ends in space or a valid cycle.
  let plan = select();
  for (;;) {
    const blocked = plan.chosen.find((move) => {
      const old = s.buildings[move.target.id].belt;
      if (!isBelt(move.target.building_type) || !old) return false;
      const source = plan.beltSources.get(move.target.id);
      return (
        source === undefined ||
        plan.chosen[source].quantity !== (old.count ?? 1)
      );
    });
    if (!blocked) break;
    const pending = [blocked.candidate];
    while (pending.length) {
      const route = pending.pop()!;
      if (excluded.has(route)) continue;
      excluded.add(route);
      // Prune a blocked belt chain in one pass. If another extractor can
      // still empty this belt, leave its incoming routes available to retry.
      if (
        isBelt(route.source.building_type) &&
        routesFrom.get(route.source.id)!.every((c) => excluded.has(c))
      )
        pending.push(...(routesTo.get(route.source.id) ?? []));
    }
    plan = select();
  }
  const { chosen } = plan;
  // Publish only the final plan's diagnostics. A discarded reservation probe
  // must not leave a false rejection/blockage on an otherwise healthy arm.
  const successfulActors = new Set(chosen.map((t) => t.actor));
  const waiting = new Map<string, "blocked" | "rejected">();
  for (const c of candidates) {
    if (!c.via || successfulActors.has(c.actor)) continue;
    const source = s.buildings[c.source.id];
    const available = c.items.some((item) =>
      isBelt(c.source.building_type)
        ? !plan.beltSources.has(c.source.id)
        : c.source.building_type === "bus" ||
            c.source.building_type === pickupType
          ? (s.warehouse[item] ?? 0) - (plan.outgoing.get(item) ?? 0) > 0
          : count(plan.sources.get(c.source.id) ?? source.output, item) > 0,
    );
    if (available && waiting.get(c.actor) !== "blocked")
      waiting.set(c.actor, plan.failures.get(c) ?? "blocked");
  }
  for (const [actor, status] of waiting) s.buildings[actor].status = status;
  // Validate the complete plan before deducting anything. A malformed move
  // must never become an unidentified persisted belt load or receipt.
  for (const move of chosen)
    if (
      !itemDefinitions.has(move.item) ||
      isFluid(move.item) ||
      !Number.isSafeInteger(move.quantity) ||
      move.quantity < 1
    )
      throw new Error("物流转移计划包含无效物品或数量，已停止本次输送");
  for (let i = 0; i < chosen.length; i++) {
    const t = chosen[i],
      m = s.buildings[t.source.id];
    if (isBelt(t.source.building_type)) {
      const left = (m.belt!.count ?? 1) - t.quantity;
      if (left) m.belt!.count = left;
      else {
        delete m.belt;
        m.status = "idle";
      }
    } else if (
      t.source.building_type === "bus" ||
      t.source.building_type === pickupType
    )
      s.warehouse[t.item] -= t.quantity;
    else remove(m.output, t.item, t.quantity);
  }
  for (let i = 0; i < chosen.length; i++) {
    const t = chosen[i],
      m = s.buildings[t.target.id];
    if (
      !tunnels.has(t.candidate) &&
      (t.via ||
        t.source.building_type === "bus" ||
        t.target.building_type === "bus" ||
        isWarehouseTerminal(t.source.building_type) ||
        isWarehouseTerminal(t.target.building_type))
    ) {
      const event: ItemTransfer = {
        id: `transfer:${s.tick}:${i}`,
        payload_id: t.payload,
        item: t.item,
        count: t.quantity,
        tick: s.tick,
        source: endpoint(t.source, t.via ?? t.target),
        target: endpoint(t.target, t.via ?? t.source),
        ...(t.via ? { via: endpoint(t.via) } : {}),
      };
      s.transfers.push(event);
    }
    if (t.source.building_type === pickupType) {
      const items = terminalItems(t.source);
      s.buildings[t.source.id].terminal_cursor =
        (items.indexOf(t.item) + 1) % items.length;
      s.buildings[t.source.id].status = "transferring";
      s.buildings[t.source.id].cooldown = 1;
    }
    if (t.destination === "belt") {
      m.belt = { id: t.payload, item: t.item, count: t.quantity, progress: 0 };
      m.status = "transporting";
    } else if (t.destination === "warehouse") {
      s.warehouse[t.item] = (s.warehouse[t.item] ?? 0) + t.quantity;
      recordWarehouseDelivery(f, t.item, t.quantity);
    } else {
      m[t.destination] ??= [];
      add(m[t.destination]!, t.item, t.quantity);
    }
    if (t.via) {
      const actor = s.buildings[t.via.id];
      actor.cooldown = interval(t.via);
      actor.status = "transferring";
    }
  }
  for (const t of chosen)
    if (t.source.building_type === "bus") s.buildings[t.source.id].cooldown = 1;
  // Receipt storage is O(entities), with one visual event per actor/face; these are a
  // bounded cosmetic log, not an inventory or throughput source.
  s.transfers = s.transfers.slice(-3 * ordered.length);
}
