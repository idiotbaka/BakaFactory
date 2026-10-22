import type { LocalFactory } from "./state";
import {
  buildingDefinitions,
  catalog,
  itemDefinitions,
  recipeDefinitions,
  itemID,
} from "./catalog";

// Lifetime acquisition history for the palette and obtain-item quests; never
// changes quantities, crafted totals or manufacturing milestones.
export function discoverItems(f: LocalFactory, ids: Iterable<string>) {
  const p = f.simulation.industry;
  if (!p) return;
  const known = new Set(p.discovered_items ?? []);
  for (const id of ids) if (itemDefinitions.has(id)) known.add(id);
  if (known.size !== (p.discovered_items?.length ?? 0))
    p.discovered_items = [...known];
}

// Only called while reading a save. Historical production and currently owned
// resources can be recovered; an old save cannot prove already spent pickups.
export function restoreDiscoveries(f: LocalFactory) {
  const ids = new Set<string>();
  const stacks = (rows?: { item: string; count: number }[]) => {
    for (const row of rows ?? []) if (row.count > 0) ids.add(row.item);
  };
  for (const [id, n] of Object.entries(f.simulation.industry?.crafted ?? {}))
    if (n > 0) ids.add(id);
  for (const district of [f, ...(f.districts ?? [])]) {
    // Zero-count warehouse entries survive spending and prove prior ownership.
    Object.keys(district.simulation.warehouse).forEach((id) => ids.add(id));
    for (const b of district.buildings) {
      const item = buildingDefinitions.get(b.building_type)?.item;
      if (item) ids.add(item);
      const m = district.simulation.buildings[b.id];
      stacks(m.input);
      stacks(m.output);
      stacks(m.fuel);
      if (m.belt) ids.add(m.belt.item);
      if (m.fluid?.count) ids.add(m.fluid.item);
      if (m.medium) ids.add(itemID("液压工作液"));
    }
  }
  const job = f.simulation.industry?.workshop;
  if (job?.order)
    Object.entries(job.order.inventory).forEach(([id, n]) => {
      if (n > 0) ids.add(id);
    });
  else if (job)
    Object.keys(recipeDefinitions.get(job.recipe_id)?.inputs ?? {}).forEach(
      (id) => ids.add(id),
    );
  for (const r of f.robots ?? []) {
    ids.add(r.item);
    if (r.cargo?.count) ids.add(r.cargo.item);
    if (r.camera) ids.add(itemID("摄像头组件"));
    if (r.service?.parts) ids.add(itemID("维修备件箱"));
  }
  discoverItems(f, ids);
  if (f.simulation.industry) f.simulation.industry.discovered_items ??= [];
}

export function validDiscoveries(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= catalog.items.length &&
      new Set(value).size === value.length &&
      value.every((id) => typeof id === "string" && itemDefinitions.has(id)))
  );
}
