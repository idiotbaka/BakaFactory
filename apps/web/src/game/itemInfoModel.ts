import type { Catalog } from "../api/client";

// Canonical names take priority over facility aliases. Long names must match
// first so “初阶自动投料机” is never split into a prefix and “自动投料机”.
export function createItemInfoIndex(catalog: Catalog) {
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const names = new Map(catalog.items.map((item) => [item.name, item.id]));
  for (const building of catalog.buildings) {
    if (building.item && items.has(building.item) && !names.has(building.name))
      names.set(building.name, building.item);
  }
  for (const item of catalog.items) {
    const shortName = item.name.replace(/^设备·/, "");
    if (!names.has(shortName)) names.set(shortName, item.id);
  }
  const alternatives = [...names.keys()]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const sources = new Map<string, Catalog["recipes"]>();
  for (const recipe of catalog.recipes) {
    for (const [id, count] of Object.entries(recipe.outputs)) {
      if (count <= 0) continue;
      const list = sources.get(id) ?? [];
      list.push(recipe);
      sources.set(id, list);
    }
  }
  return {
    items,
    names,
    sources,
    pattern: new RegExp(alternatives.join("|") || "(?!)", "gu"),
  };
}

export function splitItemText(
  text: string,
  index: ReturnType<typeof createItemInfoIndex>,
) {
  const parts: { text: string; item?: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(index.pattern)) {
    if (match.index > cursor)
      parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: match[0], item: index.names.get(match[0]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export const itemKindNames: Record<string, string> = {
  root_resource: "无限基础资源",
  solid_or_module: "固体材料 / 组件",
  fluid_or_gas: "流体 / 气体",
  machine: "设备道具",
  waste_or_byproduct: "废料 / 副产物",
  milestone: "阶段成果",
  robot: "机器人本体",
};
