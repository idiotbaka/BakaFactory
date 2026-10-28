import { advanceQuestStages } from "./quest-closure.mjs";

// Existence of a start-up route, not a stock balance or throughput simulation.
// Every capability is derived from already reachable items and installed types.
export function auditClosure(c) {
  const byID = new Map(c.buildings.map((b) => [b.id, b])),
    names = new Map(c.items.map((i) => [i.name, i.id]));
  const items = new Set([c.root_item]),
    machines = new Set(c.starting_machines),
    recipes = new Set(),
    capabilities = new Set(),
    witnesses = [];
  const has = (name) => items.has(names.get(name));
  const facility = (id) => {
    const b = byID.get(id);
    return !!b && (b.tier ?? 1) <= stage && (!b.item || items.has(b.item));
  };
  const solid = () => ["干燥生物质", "生物炭", "固体燃料块"].some(has);
  const power = (kind) =>
    kind === "none" ||
    !kind ||
    (kind === "heat" && solid()) ||
    (kind === "shaft" && facility("m09") && facility("shaft") && solid()) ||
    (kind === "hydraulic" &&
      facility("m21") &&
      facility("hydraulic_line") &&
      has("液体燃料") &&
      has("液压工作液")) ||
    (kind === "electric" &&
      facility("m28") &&
      facility("cable") &&
      has("液体燃料")) ||
    (kind === "steam_or_hydraulic" &&
      (power("hydraulic") || (has("高压蒸汽") && facility("pipe"))));
  const bots = () =>
    c.robots.filter(
      (r) =>
        r.tier <= stage &&
        items.has(r.item) &&
        c.buildings.some(
          (b) =>
            b.role === "station" &&
            b.energy === r.energy &&
            facility(b.id) &&
            power(b.energy),
        ),
    );
  const worked = (r, kind) =>
    kind === "freight"
      ? r.capacity > 0 && ["carrier", "smart"].includes(r.role)
      : (["inspector", "smart"].includes(r.role) && recipes.size > 0) ||
        (r.role === "repair" && has("维修备件箱") && recipes.size > 0);
  const condition = (r, x) => {
    if (x.type === "camera_task_history")
      return (
        has("摄像头组件") &&
        bots().some((b) => worked(b, "freight") || worked(b, "inspection"))
      );
    if (
      x.type !== "deployed_robot_active" ||
      !["r5048", "r5049"].includes(r.id)
    )
      return false;
    return bots().some(
      (b) =>
        (!x.roles?.length || x.roles.includes(b.item)) &&
        worked(b, r.id === "r5048" ? "freight" : "inspection"),
    );
  };
  const blocked = (r) => {
    const b = byID.get(r.building_type),
      why = [];
    if ((r.tier ?? 1) > stage) why.push(`stage:P${r.tier}`);
    if (!machines.has(r.building_type)) why.push(`machine:${r.building_type}`);
    if (r.gate && !items.has(r.gate)) why.push(`gate:${r.gate}`);
    for (const i of Object.keys(r.inputs))
      if (!items.has(i)) why.push(`item:${i}`);
    const kind =
      r.building_type === "m21" && r.power_kw > 0 ? "hydraulic" : b?.energy;
    if (r.power_kw > 0 && !power(kind)) why.push(`energy:${kind}`);
    for (const x of r.conditions ?? [])
      if (!condition(r, x)) why.push(`work:${x.type}`);
    return why;
  };
  let stage = 1,
    changed = true;
  while (changed) {
    changed = false;
    for (const b of c.buildings)
      if (facility(b.id) && !machines.has(b.id)) {
        machines.add(b.id);
        changed = true;
      }
    for (const r of c.recipes)
      if (!recipes.has(r.id) && !blocked(r).length) {
        recipes.add(r.id);
        Object.keys(r.outputs).forEach((i) => items.add(i));
        witnesses.push({ recipe: r.id, stage });
        changed = true;
      }
    for (const kind of [
      "heat",
      "shaft",
      "steam_or_hydraulic",
      "hydraulic",
      "electric",
    ])
      if (power(kind) && !capabilities.has(kind)) {
        capabilities.add(kind);
        witnesses.push({ capability: kind, stage });
        changed = true;
      }
    for (const b of bots())
      for (const kind of ["freight", "inspection"]) {
        const key = `${kind}:${b.item}`;
        if (worked(b, kind) && !capabilities.has(key)) {
          capabilities.add(key);
          witnesses.push({ capability: key, stage });
          changed = true;
        }
      }
    const nextStage = advanceQuestStages(
      c,
      stage,
      items,
      recipes,
      facility("hand_belt") && facility("feeder"),
      {
        shaft_craft:
          power("shaft") &&
          c.recipes.some(
            (r) =>
              recipes.has(r.id) &&
              r.power_kw > 0 &&
              byID.get(r.building_type)?.energy === "shaft",
          ),
        steam_tank_fill: has("高压蒸汽") && facility("steam_tank"),
        clockwork_transport: bots().some(
          (b) => b.name === "发条搬运车" && worked(b, "freight"),
        ),
      },
    );
    if (nextStage !== stage) {
      stage = nextStage;
      changed = true;
    }
  }
  return {
    stage,
    reached: [...recipes],
    items: [...items],
    capabilities: [...capabilities],
    witnesses,
    milestones: c.stages.map((s) => ({
      tier: s.tier,
      item: s.milestone_item,
      reached: items.has(s.milestone_item),
    })),
    unreachable: c.recipes
      .filter((r) => !recipes.has(r.id))
      .map((r) => ({ id: r.id, reasons: blocked(r) })),
  };
}
