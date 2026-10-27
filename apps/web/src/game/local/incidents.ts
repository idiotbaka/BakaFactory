import { secondsToTicks } from "./simulationTime";
import type { BuildingInstance, MachineState } from "../../api/client";
import type { LocalFactory } from "./state";
import type { components } from "../../api/schema";
import { buildingDefinitions, isFluidNode, selectedRecipe } from "./catalog";
import { canProcess } from "./production";
import { enabled } from "./transportConfig";
type Incident = components["schemas"]["WorkIncident"];
export function incidentKind(
  f: LocalFactory,
  b: BuildingInstance,
): Incident["kind"] | undefined {
  if (!enabled(b)) return;
  const m = f.simulation.buildings[b.id];
  if (isFluidNode(b.building_type))
    return m.fluid?.count ===
      (buildingDefinitions.get(b.building_type)?.fluid_capacity ?? 0)
      ? "fluid_full"
      : undefined;
  if (!selectedRecipe(b)) return;
  const status = canProcess(f, b, true);
  if (status === "output_full" || status === "no_energy") return status;
  // Brand new, empty machines are not evidence of a previously running line
  // starving. Old saves become eligible after their next actual batch.
  if (status === "no_input" && (m.batches_completed ?? 0) > 0) return status;
}
export function syncIncidents(root: LocalFactory) {
  for (const f of [root, ...(root.districts ?? [])])
    for (const b of f.buildings) {
      const m = f.simulation.buildings[b.id],
        kind = incidentKind(
          {
            ...f,
            simulation: { ...f.simulation, industry: root.simulation.industry },
            robots: root.robots,
          },
          b,
        );
      if (!kind) delete m.incident;
      else if (m.incident?.kind !== kind)
        m.incident = {
          kind,
          since_tick: root.simulation.tick,
          inspected: false,
          maintained: false,
        };
    }
}
export function validIncident(value: unknown, tick: number): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).every((k) =>
      ["kind", "since_tick", "inspected", "maintained"].includes(k),
    ) &&
    ["no_input", "no_energy", "output_full", "fluid_full"].includes(
      r.kind as string,
    ) &&
    Number.isSafeInteger(r.since_tick) &&
    (r.since_tick as number) >= 0 &&
    (r.since_tick as number) <= tick &&
    typeof r.inspected === "boolean" &&
    typeof r.maintained === "boolean"
  );
}
export const matureIncident = (m: MachineState, tick: number) =>
  !!m.incident && tick - m.incident.since_tick >= secondsToTicks(5);
