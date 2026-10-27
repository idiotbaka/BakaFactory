import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { auditClosure } from "./gameplay-closure.mjs";
import {
  buildingCopy,
  describeItem,
  describeRecipe,
  robotCopy,
  earlyMachineNames,
} from "./gameplay-copy.mjs";
import { advanceQuestStages } from "./quest-closure.mjs";

// The supplied design JSON is the import source. Do not copy recipe formulas
// from the prose/CSV: IDs remain stable if display names or ordering change.
const root = new URL("../", import.meta.url);
const source = new URL(
  "docs/Baka回收厂 游戏设计案 v0.9/Baka回收厂_结构化配方_可导入.json",
  root,
);
const target = new URL("apps/server/internal/catalog/definitions.json", root);
const report = new URL("docs/gameplay-data-audit.md", root);
const d = JSON.parse(await readFile(source, "utf8"));
const previous = JSON.parse(await readFile(target, "utf8"));
const names = new Map(d.items.map((i) => [i.name, i.id.toLowerCase()]));
names.set("流水线机械手", names.get("机械启动套件"));
names.set("地下传送带出入口", "d0001");
const renamedNames = new Map([
  ["机械启动套件", "流水线机械手"],
  ["手摇传送带", "初阶传送带"],
  ...d.machines.flatMap((m) => {
    const renamed = earlyMachineNames[m.code.toLowerCase()];
    return renamed
      ? [
          [m.item, renamed.name],
          [m.name, renamed.name],
        ]
      : [];
  }),
]);
const namePattern = new RegExp(
  [...renamedNames.keys()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);
const displayName = (value) =>
  value.replace(namePattern, (name) => renamedNames.get(name));
// Keep source-name references for importing the untouched v0.9 formulas,
// while authored quests and new content use the current display names.
for (const [name, id] of [...names]) {
  const alias = displayName(name);
  if (names.has(alias) && names.get(alias) !== id)
    throw new Error(`Conflicting item name: ${alias}`);
  names.set(alias, id);
}
const item = (name) => {
  const id = names.get(name);
  if (!id) throw new Error(`Unknown design item: ${name}`);
  return id;
};
const colors = [
  "#ffc879",
  "#a5d4b2",
  "#74edce",
  "#46eff2",
  "#b69aff",
  "#ff72cf",
];
const convert = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([name, n]) => [item(name), n]),
  );
const legacyItems = previous.items
  .filter((i) => ["iron_ore", "iron_plate", "gear"].includes(i.id))
  .map((i) => ({ ...i, legacy: true }));
const legacyBuildings = previous.buildings
  .filter((b) =>
    [
      "miner",
      "furnace",
      "assembler",
      "conveyor",
      "item_output",
      "item_input",
    ].includes(b.id),
  )
  .map((b) => ({ ...b, legacy: true }));
const legacyRecipes = previous.recipes
  .filter((r) => ["iron_mining", "iron_plate", "gear"].includes(r.id))
  .map((r) => ({ ...r, legacy: true }));
const recipes = d.recipes.map((r) => ({
  id: r.id.toLowerCase(),
  name: displayName(Object.keys(r.output).join(" / ")),
  building_type: r.machine.toLowerCase(),
  tier: r.tier,
  duration_ms: r.seconds * 1000,
  // P1 cost adjustments leave the original design input unchanged on disk.
  inputs: convert(
    r.id === "R1032"
      ? { 粗铁锭: 2, 铁铆钉: 4 }
      : r.id === "R1039"
        ? { 机械抓取爪: 1, 低速传动轴: 1, 分拣料箱: 1 }
        : r.input,
  ),
  outputs: convert(r.output),
  description:
    r.id === "R3011"
      ? "建造液压动力站；先用 R3012 制备并注入真实工作液启动，不赠送内置介质。"
      : r.note,
  power_kw: r.id === "R3013" ? 20 : (r.work_power_kw ?? 0),
  ...(r.research_gate ? { gate: item(r.research_gate) } : {}),
  conditions: r.conditions.map((c) => ({
    ...c,
    ...(c.roles ? { roles: c.roles.map(item) } : {}),
  })),
}));
// The original pipe blueprint requires M27 hydraulic power. A P2 manual
// blueprint is necessary to route boiler steam before hydraulic power exists.
recipes.push({
  id: "web_pipe_early",
  name: "简易流体管道",
  building_type: "m08",
  tier: 2,
  duration_ms: 12000,
  inputs: convert({ 粗铜丝: 3, 粗密封圈: 2, 基础铁板: 1 }),
  outputs: convert({ 流体管道: 4 }),
  description: "网页适配：P2 蒸汽启动管道，原案高效配方继续保留。",
  power_kw: 0,
  gate: item("机械启动套件"),
  conditions: [],
});
recipes.push({
  id: "web_cable_start",
  name: "启动绝缘线缆",
  building_type: "m08",
  tier: 4,
  duration_ms: 15000,
  inputs: convert({ 粗铜丝: 5, 绝缘胶: 2 }),
  outputs: convert({ 绝缘线缆: 2 }),
  description: "网页适配：手工制造首批电网导线，通电后改用原案高效配方。",
  power_kw: 0,
  gate: item(d.stages[2].milestone_item.split(":")[0]),
  conditions: [],
});
recipes.push({
  id: "web_underground_belt",
  name: "地下传送带出入口",
  building_type: "m08",
  tier: 2,
  duration_ms: 12000,
  inputs: convert({ 简易齿轮: 2, 基础铁板: 2 }),
  outputs: convert({ 地下传送带出入口: 1 }),
  description:
    "制造一套成对地下端口，入口正前方 1～8 格放置出口，无额外地下行程。",
  power_kw: 0,
  conditions: [],
});
const energy = (mode) =>
  mode === "轴功"
    ? "shaft"
    : mode === "固体热能"
      ? "heat"
      : mode === "流压"
        ? "hydraulic"
        : mode === "蒸汽/流压"
          ? "steam_or_hydraulic"
          : mode === "电力"
            ? "electric"
            : "none";
const multiSizeMachines = new Set([
  "m08",
  "m14",
  "m15",
  "m19",
  "m20",
  "m21",
  "m22",
  "m23",
  "m25",
  "m27",
  "m29",
  "m31",
  "m32",
  "m33",
  "m34",
  "m35",
  "m36",
  "m37",
  "m38",
  "m39",
  "m40",
  "m41",
  "m42",
  "m43",
  "m44",
  "m45",
  "m46",
  "m47",
  "m48",
  "m49",
  "m50",
  "m51",
  "m52",
  "m53",
  "m54",
  "m55",
]);
const buildings = d.machines.map((m) => {
  const rs = recipes.filter((r) => r.building_type === m.code.toLowerCase());
  return {
    id: m.code.toLowerCase(),
    ...(multiSizeMachines.has(m.code.toLowerCase())
      ? { supported_sizes: [1, 2] }
      : {}),
    name: displayName(m.name),
    code: m.code,
    icon: ["M09", "M21", "M28"].includes(m.code)
      ? "generator"
      : m.code === "M17"
        ? "splitter"
        : m.mode === "固体热能"
          ? "furnace"
          : "assembler",
    color: colors[m.tier - 1],
    description: buildingCopy[m.code.toLowerCase()] ?? m.note,
    category: "machine",
    fixed: false,
    tier: m.tier,
    item: item(m.item),
    work_mode: m.mode,
    energy: energy(m.mode),
    power_kw: m.kw,
    role: ["M09", "M21", "M28"].includes(m.code)
      ? "generator"
      : m.code === "M17"
        ? "splitter"
        : m.code === "M18"
          ? "station"
          : "production",
    input_slots: 12,
    output_slots: 12,
    stack_limit: 100,
    input_whitelist: [...new Set(rs.flatMap((r) => Object.keys(r.inputs)))],
    ...(m.code === "M18"
      ? { station_capacity_kj: 1000, station_transfer_kw: 5 }
      : {}),
  };
});
// New construction items use the source recipes; new utility blueprints are
// explicit additions with a separate namespace, never edits to source IDs.
const utility = (id, name, nameItem, tier, role, extra = {}) => ({
  id,
  name,
  code: id.slice(0, 4).toUpperCase(),
  icon:
    role === "belt"
      ? "conveyor"
      : role === "port"
        ? "feeder"
        : role === "chest"
          ? "chest"
          : role === "splitter"
            ? "splitter"
            : "bus",
  color: colors[tier - 1],
  description:
    buildingCopy[id] ?? `${name}：安装消耗 1 个${nameItem}，拆迁完整回收。`,
  category: "logistics",
  fixed: false,
  tier,
  item: item(nameItem),
  role,
  input_slots: 12,
  output_slots: 12,
  stack_limit: 100,
  input_whitelist: [],
  ...extra,
});
const utilities = [
  utility("hand_belt", "初阶传送带", "初阶传送带", 1, "belt", {
    belt_ticks: 2,
    batch_size: 2,
  }),
  utility("feeder", "自动投料机", "初阶自动投料机", 1, "port", {
    batch_size: 20,
  }),
  utility("waste_port", "垃圾提取口", "初阶自动投料机", 1, "source", {
    code: "JUNK",
    icon: "recycler",
  }),
  utility("chest", "分拣料箱", "分拣料箱", 1, "chest", {
    input_slots: 8,
    output_slots: 8,
  }),
  utility("buffer_chest", "物流缓冲仓", "物流缓冲仓", 2, "chest"),
  utility("shaft", "传动轴", "低速传动轴", 2, "shaft", { icon: "shaft" }),
  utility("mechanical_belt", "机械传送带", "机械传送带", 2, "belt", {
    belt_ticks: 1,
    batch_size: 2,
    energy: "shaft",
    power_kw: 1,
  }),
  utility(
    "underground_belt",
    "地下传送带出入口",
    "地下传送带出入口",
    2,
    "belt",
    {
      code: "UG",
      belt_ticks: 1,
      batch_size: 6,
    },
  ),
  utility("pipe", "流体管道", "流体管道", 2, "pipe", {
    icon: "pipe",
    fluid_capacity: 10,
    fluid_rate: 2,
  }),
  utility("return_pipe", "回流管路", "回流管路", 3, "pipe", {
    icon: "pipe",
    fluid_capacity: 20,
    fluid_rate: 6,
  }),
  utility("steam_tank", "蒸汽储压罐", "蒸汽储压包", 2, "tank", {
    icon: "tank",
    fluid_capacity: 200,
    fluid_rate: 4,
    input_whitelist: [item("高压蒸汽")],
  }),
  utility("hydraulic_line", "液压动力管", "流体管道", 3, "hydraulic_line", {
    icon: "pressure",
  }),
  utility("hydraulic_belt", "液压输送带", "液压输送带", 3, "belt", {
    belt_ticks: 1,
    batch_size: 10,
    energy: "hydraulic",
    power_kw: 2,
  }),
  utility("tank", "流体储罐", "流体储罐", 3, "tank", {
    icon: "tank",
    fluid_capacity: 500,
    fluid_rate: 4,
  }),
  utility("valve", "分液阀", "分液阀", 3, "valve", {
    icon: "valve",
    fluid_capacity: 10,
    fluid_rate: 4,
  }),
  utility("pressure_valve", "压力调节阀", "压力调节阀", 3, "pipe", {
    icon: "valve",
    fluid_capacity: 10,
    fluid_rate: 2,
  }),
  utility("pump", "化工投料泵", "化工自动投料泵", 3, "pump", {
    icon: "pump",
    fluid_capacity: 20,
    fluid_rate: 10,
    energy: "hydraulic",
    power_kw: 5,
  }),
  utility("cable", "能量线缆", "绝缘线缆", 4, "cable", { icon: "cable" }),
  utility(
    "hydraulic_station",
    "液压机器人补给站",
    "液压工业示范机组",
    3,
    "station",
    {
      icon: "robot",
      energy: "hydraulic",
      power_kw: 15,
      station_capacity_kj: 3000,
      station_transfer_kw: 15,
    },
  ),
  utility("charge_station", "机器人换电站", "机器人换电站", 4, "station", {
    icon: "robot",
    energy: "electric",
    power_kw: 100,
    station_capacity_kj: 30000,
    station_transfer_kw: 100,
  }),
  utility("battery", "储能箱", "储能箱", 4, "battery", {
    icon: "battery",
    capacity_kj: 15000,
    transfer_kw: 100,
  }),
  utility("dense_battery", "高密度储能箱", "高密度电池组", 6, "battery", {
    icon: "battery",
    capacity_kj: 30000,
    transfer_kw: 100,
  }),
  utility("electric_feeder", "电动投料臂", "通用机械臂", 4, "port", {
    batch_size: 3,
    energy: "electric",
    power_kw: 5,
  }),
  utility("precision_feeder", "精密投料臂", "精密机械臂", 5, "port", {
    batch_size: 5,
    energy: "electric",
    power_kw: 8,
  }),
  utility("flexible_feeder", "柔性投料节点", "神经调度单元", 6, "port", {
    batch_size: 6,
    energy: "electric",
    power_kw: 12,
  }),
  utility("smart_gate", "智能分拣闸门", "智能分拣闸门", 4, "splitter", {
    batch_size: 3,
    energy: "electric",
    power_kw: 5,
  }),
  utility("electric_belt", "电动传送带", "电动传送带", 4, "belt", {
    belt_ticks: 1,
    batch_size: 20,
    energy: "electric",
    power_kw: 2,
  }),
  utility("precision_belt", "高速精密传送带", "高速精密传送带", 5, "belt", {
    belt_ticks: 1,
    batch_size: 50,
    energy: "electric",
    power_kw: 3,
  }),
  utility("flexible_belt", "柔性立体输送带", "柔性立体输送带", 6, "belt", {
    belt_ticks: 1,
    batch_size: 100,
    energy: "electric",
    power_kw: 4,
  }),
];
// Source capacities are fixed; prose action intervals become minimum action
// work, with actual route travel added separately in the browser runtime.
const robotTuning = [
  ["shaft", 1000, 8, false, "carrier"],
  ["hydraulic", 3000, 10, true, "carrier"],
  ["hydraulic", 3000, 30, true, "inspector"],
  ["electric", 15000, 8, true, "carrier"],
  ["electric", 15000, 5, false, "carrier"],
  ["electric", 15000, 2, false, "carrier"],
  ["electric", 15000, 40, true, "repair"],
  ["electric", 15000, 35, true, "repair"],
  ["electric", 30000, 2, true, "smart"],
];
const expectedRobots = [
  "发条搬运车",
  "液压搬运机器人",
  "管线巡检机器人",
  "电动物流机器人",
  "自动分拣机器人",
  "高速分拣机器人",
  "自动维修机器人",
  "高温维修机器人",
  "智能机器人",
];
if (d.robot_specs.length !== expectedRobots.length)
  throw new Error("Robot source count changed; review web tuning");
const robots = d.robot_specs.map((r, index) => {
  if (r.name !== expectedRobots[index])
    throw new Error("Robot source order changed; review web tuning");
  const [energy, energy_capacity_kj, action_ticks, cross_district, role] =
    robotTuning[index];
  return {
    item: item(r.name),
    name: r.name,
    tier: r.tier,
    energy,
    capacity: parseInt(r.capacity, 10),
    energy_capacity_kj,
    action_ticks,
    cross_district,
    role,
    description: robotCopy[r.name] ?? `${r.limitations}；${r.benefit}`,
  };
});
// Quest order is authored recommendation order, independent of recipe order.
const questSource = JSON.parse(
  await readFile(new URL("docs/quests.json", root), "utf8"),
);
const questIDs = new Set();
const finalTiers = new Set();
const quests = questSource.map((q) => {
  if (
    !/^[a-z][a-z0-9_]*$/.test(q.id) ||
    questIDs.has(q.id) ||
    !q.title ||
    !q.description ||
    !Number.isInteger(q.tier) ||
    q.tier < 1 ||
    q.tier > 6 ||
    !Number.isSafeInteger(q.goal?.count) ||
    q.goal.count < 1
  )
    throw new Error(`Invalid quest: ${q.id}`);
  questIDs.add(q.id);
  if (q.critical !== undefined && typeof q.critical !== "boolean")
    throw new Error(`Invalid critical quest flag: ${q.id}`);
  if (q.stage_final !== undefined && typeof q.stage_final !== "boolean")
    throw new Error(`Invalid final quest flag: ${q.id}`);
  if (q.stage_final) {
    if (q.tier >= 6 || finalTiers.has(q.tier))
      throw new Error(`Invalid or duplicate final quest tier: ${q.id}`);
    finalTiers.add(q.tier);
  }
  const target = ["obtain_item", "craft_item"].includes(q.goal.type)
    ? item(q.goal.target)
    : q.goal.target;
  const goalItems = q.goal.items?.map(item);
  const goalValid = ["obtain_item", "craft_item"].includes(q.goal.type)
    ? q.goal.count === 1
    : q.goal.type === "automated_delivery"
      ? target === "bus"
      : ["factory_delivery", "submit_items"].includes(q.goal.type)
        ? target === "bus" &&
          goalItems?.length > 0 &&
          goalItems.length <= 12 &&
          new Set(goalItems).size === goalItems.length
        : q.goal.type === "factory_event"
          ? ["shaft_craft", "steam_tank_fill", "clockwork_transport"].includes(
              target,
            )
          : q.goal.type === "district_count"
            ? target === "world" && q.goal.count <= 100
            : q.goal.type === "workshop_recipe" &&
              recipes.some(
                (r) =>
                  r.id === target &&
                  ["m01", "m02", "m07", "m03", "m04", "m08"].includes(
                    r.building_type,
                  ),
              );
  if (
    !goalValid ||
    (!["factory_delivery", "submit_items"].includes(q.goal.type) &&
      goalItems !== undefined)
  )
    throw new Error(`Invalid quest goal: ${q.id}`);
  const rewards = Object.fromEntries(
    Object.entries(q.rewards).map(([name, n]) => {
      if (!Number.isSafeInteger(n) || n < 1)
        throw new Error(`Invalid quest reward: ${q.id}`);
      return [item(name), n];
    }),
  );
  if (
    (q.unlocks ?? []).some(
      (u) => !["warehouse_orders", "stage_2", "warehouse_io"].includes(u),
    ) ||
    new Set(q.unlocks ?? []).size !== (q.unlocks ?? []).length
  )
    throw new Error(`Invalid quest unlock: ${q.id}`);
  if (!Object.keys(rewards).length && !q.unlocks?.length)
    if (!q.stage_final) throw new Error(`Empty quest reward: ${q.id}`);
  if (q.unlocks?.includes("stage_2") && (!q.stage_final || q.tier !== 1))
    throw new Error(`Stage unlock requires P1 final quest: ${q.id}`);
  return {
    ...q,
    goal: { ...q.goal, target, ...(goalItems ? { items: goalItems } : {}) },
    rewards,
  };
});
if (quests.length > 1000) throw new Error("Too many quests");
if (finalTiers.size !== 5)
  throw new Error("P1–P5 each require one final quest");
const machineById = new Map(buildings.map((b) => [b.id, b]));
const machineByItem = new Map(buildings.map((b) => [b.item, b]));
for (const r of recipes)
  r.description = describeRecipe(r, machineById, machineByItem);
// Short narrative goals replace the source's technical roadmap in the HUD.
// Unlock rules remain on quest cards and in the progression runtime.
const stageGoals = [
  "垃圾山给你发来一份「零件组装地狱」体验券。搓出流水线机械手，让夹爪先喘口气吧~",
  "机械手刚学会拧螺丝，大机器就端着空碗来了。喂饱基础零件产线，把液压工业许可包也端上桌吧~",
  "工厂点了一杯「加油不加糖」，还要自带循环管路。调好油液与化工产线，打包一份电气化建设包吧~",
  "恭喜，工厂开始按电费表达食欲了！接好电网、照顾机器人电量，再领一张微电子实验许可证吧~",
  "芯片小小一片，工厂胃口又大一圈。让精密机器人学会照顾产线，把认知系统项目包准备好吧~",
  "零件、芯片和作业经历都齐了，就差一位会自己想办法的同事。造出智能机器人，看看它会先拯救工厂，还是先研究摸鱼吧~",
];
const base = {
  version: 2,
  quests,
  robots,
  root_item: item(d.root_resource.item),
  starting_machines: d.starting_machines.map((m) => m.toLowerCase()),
  stages: d.stages.map((s) => ({
    tier: s.tier,
    name: s.name,
    goal: stageGoals[s.tier - 1] ?? displayName(s.goal),
    milestone_item: item(s.milestone_item.split(":")[0]),
  })),
  items: [
    ...legacyItems,
    {
      id: "d0001",
      name: "地下传送带出入口",
      code: "D0001",
      icon: "conveyor",
      color: colors[1],
      description: describeItem(
        "d0001",
        "地下传送带出入口",
        "component",
        machineByItem,
      ),
      kind: "component",
      tier: 2,
      source_recipes: ["web_underground_belt"],
      used_by: [],
    },
    ...d.items.map((i) => ({
      id: i.id.toLowerCase(),
      name: displayName(i.name),
      code: i.id,
      icon:
        i.kind === "machine"
          ? "assembler"
          : i.kind === "fluid_or_gas"
            ? "fluid"
            : i.kind === "robot"
              ? "robot"
              : "plate",
      color: colors[Math.max(0, i.earliest_tier - 1)],
      description: describeItem(
        i.id.toLowerCase(),
        displayName(i.name),
        i.kind,
        machineByItem,
      ),
      kind: i.kind,
      tier: i.name === "流体管道" ? 2 : Math.max(1, i.earliest_tier),
      source_recipes: recipes
        .filter((r) => r.outputs[i.id.toLowerCase()])
        .map((r) => r.id),
      used_by: recipes
        .filter((r) => r.inputs[i.id.toLowerCase()])
        .map((r) => r.id),
    })),
  ],
  buildings: [
    {
      ...previous.buildings.find((b) => b.id === "bus"),
      description: buildingCopy.bus,
      input_whitelist: [],
      role: "warehouse",
    },
    ...legacyBuildings,
    ...buildings,
    ...utilities,
    ...["warehouse_pickup", "warehouse_intake"].map((id) => ({
      id,
      name: id === "warehouse_pickup" ? "取货终端" : "存入终端",
      code: id === "warehouse_pickup" ? "WOUT" : "WIN",
      icon: "bus",
      color: colors[1],
      description: buildingCopy[id],
      category: "logistics",
      fixed: false,
      tier: 2,
      role: id,
      input_slots: 1,
      output_slots: 1,
      stack_limit: 100,
      input_whitelist: [],
    })),
  ],
  recipes: [...legacyRecipes, ...recipes],
};
// Fixed-point reachability includes machine construction, stage gates and all
// required inputs, so a machine cannot manufacture its own first instance.
const available = new Set([base.root_item]);
const machines = new Set(base.starting_machines);
const reached = new Set();
let stage = 1,
  changed = true;
while (changed) {
  changed = false;
  for (const r of recipes) {
    if (
      r.tier > stage ||
      !machines.has(r.building_type) ||
      Object.keys(r.inputs).some((i) => !available.has(i))
    )
      continue;
    if (!reached.has(r.id)) {
      reached.add(r.id);
      changed = true;
    }
    Object.keys(r.outputs).forEach((i) => available.add(i));
  }
  for (const b of buildings)
    if (available.has(b.item) && !machines.has(b.id)) {
      machines.add(b.id);
      changed = true;
    }
  const canDeliver = ["hand_belt", "feeder"].every((id) => {
    const b = utilities.find((b) => b.id === id);
    return b && available.has(b.item);
  });
  const nextStage = advanceQuestStages(
    base,
    stage,
    available,
    reached,
    canDeliver,
  );
  if (nextStage !== stage) {
    stage = nextStage;
    changed = true;
  }
}
const unreachable = recipes.filter((r) => !reached.has(r.id));
const closure = auditClosure(base);
if (closure.unreachable.length || closure.milestones.some((s) => !s.reached))
  throw new Error(
    `Energy/work closure blocked: ${JSON.stringify(closure.unreachable)}`,
  );
const lines = [
  "# v0.9 数据导入审计",
  "",
  "由 `node scripts/import-gameplay.mjs` 生成。原始文件不改写；本报告为静态前置可达分析，不代替实际生产、供能与长局测试。",
  "",
  `- 原始物品 ${d.items.length}、机器 ${d.machines.length}、配方 ${d.recipes.length}；全部保留稳定的小写原始编号。`,
  `- 开放任务 ${quests.length} 项由 docs/quests.json 按推荐顺序导入；P1～P5 各一项阶段终局，其他任务完成至少一半（向上取整）后可达，领奖推进下一阶段；不以任务奖励作为工业闭包的免费启动资源。`,
  "- 网页适配：所有 WH 共用总仓库，规则 3 只保存一份库存；旧 1/2 分仓在客户端校验后合并，现场缓存 / 管道 / 能网独立。P2 可直接启动空分厂，机器人本轮只对接共享库存，定位调整留待后续。",
  `- 兼容旧测试物品 ${legacyItems.length} / 设备 ${legacyBuildings.length} / 配方 ${legacyRecipes.length}，不展示为新建造内容。`,
  `- 基础分拣有 9 种产物，通用机器缓存提升至 12 格；终局最大输入 5 种。`,
  `- 不考虑能源和真实作业条件的材料/机器/阶段闭包到达 P${stage}；${reached.size}/${recipes.length} 配方可达。`,
  `- 未达配方：${unreachable.map((r) => r.id).join("、") || "无"}。`,
  `- F1 含阶段门槛、燃料 / 导线 / 蒸汽启动 / 工作液、兼容补能站与可积累真实凭据的静态闭包：P${closure.stage}，${closure.reached.length} 配方，六阶段成果 ${closure.milestones.filter((s) => s.reached).length}/6。`,
  `- 启动证据：${closure.witnesses
    .filter((w) => w.capability)
    .map((w) => `P${w.stage} ${w.capability}`)
    .join("；")}。`,
  "- 凭据能力表示可布置真实取送、运行后持续异常 / 实际备件清理并逐次积累；不赠送库存 / 历史。多燃料机并网、管线连通、邻格通路、仓储腾空与有限批次数量须玩家实际搭建，本报告不证明吞吐、布局、资源数量或长局通过。",
  "",
  "## 扩展与偏差",
  "",
  "物流适配：自动投料机 feeder 每批最多 20 件、未配置间隔时默认 0.5 秒；垃圾提取口可在任意厂区顶部安装，不设阶段数量上限，仍实际扣除道具。机器人每半秒走一格、每格 1 kJ，装卸 / 作业 / 跨厂保留秒级工时；流体每半秒执行一次原批次，泵仍为 5 kW。地下端口配方 web_underground_belt 改为简易齿轮 2、基础铁板 2，12 秒产一套，不修改原案 JSON。",
  "",
  "P1 追加真实 WH 自动化入库与制造流水线机械手两任务。I0060 / R1040 编号与物料保持，原机械启动套件显示名改为流水线机械手。P1～P5 每阶段唯一终局，需完成同阶段其他任务至少一半（向上取整）才开放；只有完成并领取终局奖励才推进下一阶段，制造记录仅保留成果与配方前置。P1 终局同时开放仓库订单；旧档只补认已跨过阶段的终局，不补普通历史或奖励。P2 新增十三项自动化 / 作业 / 扩建目标和五项首造补给，普通任务达成 10/19 后开放原许可包终局；逐物品自动化进度取地图制造与 WH 自动入库较小值，不以库存 / 工作室 / 收取替代。P3～P5 普通任务尚待配置。静态闭包检查可安装机器产出、真实事件能力和半数门槛可达，不发任务物品、不证明百件吞吐 / 路径实际运行。仓库递归订单只使用当前已开放工作室配方，一次预留、独占队列、逐批真实结算，取消回收当前实物；复杂度 / 工序 / 批次数有界，见 warehouse-orders.md。",
  "",
  "工作室便捷加工保留初始 M01/M02/M07；M03 / M04 / M08 在累计制造对应设备至少 1 次后开放共用手工队列，不要求安装且不消耗解锁设备。仅持有、拆回或查看设备不算制造；工作室运行层每批耗时为 max(1, floor(duration_ms / 2000)) 秒，原始 duration_ms 留给地图机器，不改导入配方工时。材料和 1～100 批预留 / 取消规则保持；UI 超限自动回填当前库存上限，Worker 原子复核。旧队列保留原工时范围内的进度，达到新工时时下一运行 tick 最多结算当前一批。不开放热能炉或其他机器。starting_machines 仍只有原三种，不额外赠设备或独立队列。界面按 M02 / M07 / M01 / M03 / M04 / M08 分组，仅设备子分类在工作室滚动区内吸顶，垃圾堆正常滚动，库存 / 每批原料及产物用物品卡显示。",
  "",
  "网页适配增加 web_pipe_early：P2 自动装配台使用粗铜丝 3、粗密封圈 2、基础铁板 1，原配方 12 秒（工作室 6 秒）制造 4 管道，解除蒸汽启动依赖 P3 液压管道的前置环；原有 R3045 保留。流体管道物品与设施最低阶段改为 P2，来源去向包含新增配方。液压带复用原案已有道具与配方，没有新增同名替代品。",
  "",
  "F1 新增 web_cable_start：P4 M08 在首次制造电气化建设包后，用粗铜丝 5、绝缘胶 2，原配方 15 秒（工作室 7 秒）制造 2 绝缘线缆，解除原 R4008 / R4009 与电网互相依赖。原案高效配方保留，不赠送线缆或电量。闭包涵盖真实燃料、蒸汽 / 工作液、兼容补能站与可积累作业条件；仅证明存在启动路线，不证明数量、布局、吞吐或已游玩通过。",
  "F2 只读诊断区分名义速率与最近 60 秒（120 tick） 的确认制造 / 物流；永久智能机器人里程碑及已制造许可证反馈主目标 / 沙盒目标。F3 增量传输未变布局与安静分厂，主线程仍保存完整世界；行业进度单次克隆、世界端点和需求 / 来源承诺索引，慢自动保存合并。独立合成测量可配置规模 / 种子，尚未执行，不宣称百厂性能达标。",
  "M21 的 R3012 作为冷混配，不计网络功率，配方仍真实消耗液体燃料添加剂；R3013 增压原案未给功率，适配明确为 20 kW，由动力站自身燃料驱动。液压站需注入至少 1 u 真实工作液，闭环介质最多 10 u，拆除返还；不赠送可刷取的启动介质。M20 可消耗高压蒸汽，每 u 释放 100 kJ；M09/M21/M28 按实际出功计费。储能充电效率 88%，不用互充或同刻充放制造电量。",
  "",
  "安装用 item 字段显式关联设备道具；原始发电机、分流器和站点没有加工配方，按设施角色运行，不伪造空输入生产配方。新增轴、线缆、管道、箱/罐、储能等设施复用原案可制作物品；没有免费发放高阶设备。",
  "",
  "原案工业蜡被归类为流体、溶剂与有机溶剂是两个独立物品，当前保留原始分类和 ID。普通物料管道与抽象闭环液压动力管作为不同设施，避免物料流体被当作免费能量。",
  "物料流体采用整单位、定向、有界容器：普通管道 10 u / 2 u每 0.5 秒、回流管 20 / 6、蒸汽储压包 200 / 4、储罐 500 / 4、分液阀 10 / 4、调压阀 10 / 2、泵 20 / 10（液压 5 kW）。节点单介质，禁止混液；阀按整数权重轮换，满分支等待保持配比。保守预留不把同刻排出视为可用容量，满闭环需真实出口腾空。没有连续压力求解或随机泄漏。",
  "",
  "条件配方 R5048/R5049/R5050 保留真实作业限制；材料闭包不证明这些条件已满足。能源、机器人作业和地图运行在对应阶段验证。",
  "E2a 导入原案 9 机器人规格，保留 4/12/0/24/8/12/6/4/32 u 载重；动作间隔适配为至少 8/10/30/8/5/2/40/35/2 秒，实际路径另计。网页储能容量轴功 1000、液压 3000、电动 15000、智能 30000 kJ，部署零能量，召回散失储能。电动机器人补能效率 88%，保存百分之一 kJ 余数，满电余数舍弃。M18 储能 / 补给上限 1000 kJ / 5 kW；液压补给站复用实际液压工业示范机组 3000 / 15；换电站复用原案道具 30000 / 100。站点只存已付能量，不免费补液或创建燃料。",
  "E2b 搬运角色通过真实空格路径取送，每 0.5 秒最多一格、每移动 / 跨区行程秒 / 装卸准备秒 / 成功装卸行动消耗 1 kJ；跨厂经 WH，行程 8 秒。规格动作工时后每刻装卸最多一载重，WH 输出每面最多 1 u；自动流体输出时机器人保守让出该 WH 本刻输出。液压搬运机器人与智能机器人可密封搬运单种流体，其他搬运机仅固体；不混液、不从机器输入 / 燃料偷取。出发补满并保留真实返程能源，取消 / 端点删除实际携货返归属 WH 再返站，不瞬移退款。completed_tasks 仅用于统计；E2c 使用另一份可消费凭据账本。原案 JSON 和生成配方均不为这些适配改写。",
  "E2c 不制造随机故障：实际运行后缺料、真实缺能、产物积压、流体满容持续至少 5 tick 后可现场巡检，一次异常只记一次巡检凭据。维护机器人从归属站手动装载真实维修备件箱，按规格工时清走一载重固体积压、消耗一箱并实际携货返仓；同一异常可继续清理但不重复记维护凭据。取消 / 恢复 / 端点消失不奖励，未用备件实际返站后退回。摄像头从真实组件安装，随有效作业生成视觉凭据，卸下 / 召回返还组件。训练配方原材料 / 工时 / 能耗不变，每批完成时消费 40 / 20 / 30 次原案匹配凭据，机器人须仍部署并启用；凭据按机器人 / 类别最多 10000 次、总计最多 1500 行，跨厂共享，召回清除该实体未用凭据。静态材料闭包不代表已执行这些真实作业或长局验收。",
  "E2d1 智能机器人可按显式权限自动派配方补料 / 巡检 / 维护，默认关闭；实际走既有库存 / 路径 / 能源规则。5 tick 评估周期、共享 2000 次候选 / 来源访问预算、最多 20 条有限日志。需求与来源库存扣除现有任务承诺，现场同类任务排他，失败提案回滚；不免费调拨或生成凭据，不调用外部 AI。性能实测仍待后续阶段。",
  "E2d2 显式单格蓝图每智能机器人同时一张，可多机并行；在归属站补满并装载 1 个实际成品设备，不重复扣制造原料。格位预留、路径与返程储能验证、现场 10 秒每秒 1 kJ 后安装，跨区复用 WH 与 8 秒付费行程，可选已解锁配方。垃圾源头可在任意厂区顶部安装，不设阶段数量或蓝图配额限制，旧测试 / 固定设备不可施工。取消或能量中止释放格位，cargo 沿实际路径返归属 WH 再回站；不瞬移退款、不赠训练凭据。多格批量模板 / 自动整厂排程不在本阶段。",
  "E2d3 / E2e 地图与列表统一选取、当前单路段只读预览、确认过境落点 / 跨厂定位、必需授权锁定、暂停 / 返程说明及真实归属站召回反馈。复用实际寻路，区分占格等待、静态无路与有限储能超限，不通过图形 / 筛选 / 查看路线结算资源、改 revision 或生成凭据。F 已补前置闭包、终局诊断与快照 / 索引；百厂性能仍未实测。",
  "",
];
if (unreachable.length)
  throw new Error(
    `Design has unreachable recipes: ${unreachable.map((r) => r.id).join(", ")}`,
  );
await writeFile(target, await format(JSON.stringify(base), { parser: "json" }));
await writeFile(report, await format(lines.join("\n"), { parser: "markdown" }));
console.log(
  `Imported ${d.items.length} items, ${d.machines.length} machines, ${d.recipes.length} recipes → ${fileURLToPath(target)}; static material closure P${stage}.`,
);
