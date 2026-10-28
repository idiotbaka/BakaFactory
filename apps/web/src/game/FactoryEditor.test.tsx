import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import FactoryEditor from "./FactoryEditor";
import definitions from "../../../server/internal/catalog/definitions.json";
import type { Catalog, FactoryDetail } from "../api/client";
const deleteBuilding = vi.fn(),
  getFactory = vi.fn(),
  placeBuilding = vi.fn(),
  updateBuilding = vi.fn();
const catalog = definitions as unknown as Catalog;

it.each([
  [90, 4, -4, 6],
  [270, -4, 4, -6],
] as const)(
  "places the vertical underground exit in front of the displayed %s degree arrow",
  async (rotation, entryY, exitY, behindY) => {
    const placeUnderground = vi.fn().mockResolvedValue(original),
      onError = vi.fn();
    render(
      <FactoryEditor
        commands={{
          deleteBuilding,
          getFactory,
          placeBuilding,
          updateBuilding,
          placeUnderground,
        }}
        factory={original}
        catalog={catalog}
        selectedID={null}
        placementType="underground_belt"
        onExitPlacement={vi.fn()}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onError={onError}
      />,
    );
    for (let i = 0; i < rotation / 90; i++)
      fireEvent.keyDown(window, { key: "r" });
    fireEvent.click(screen.getByLabelText(`空格 (-4,${entryY})`));
    const preview = screen.getByLabelText(`入口预览 (-4,${entryY})，尚未安装`);
    expect(preview.querySelector(".underground-visual > g")).toHaveAttribute(
      "transform",
      `rotate(${rotation} 15 15)`,
    );
    fireEvent.click(screen.getByLabelText(`空格 (-4,${behindY})`));
    expect(placeUnderground).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByLabelText(`空格 (-4,${exitY})`)),
    );
    expect(placeUnderground).toHaveBeenCalledExactlyOnceWith(
      original.id,
      { x: -4, y: entryY, rotation },
      { x: -4, y: exitY, rotation },
    );
  },
);

it("marks an underground entrance without editing and commits only a valid second click", async () => {
  const placeUnderground = vi.fn().mockResolvedValue(original),
    onError = vi.fn();
  const props = {
    commands: {
      deleteBuilding,
      getFactory,
      placeBuilding,
      updateBuilding,
      placeUnderground,
    },
    factory: original,
    catalog,
    selectedID: null,
    placementType: "underground_belt",
    onExitPlacement: vi.fn(),
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onError,
  };
  const { rerender } = render(<FactoryEditor {...props} />);
  fireEvent.click(screen.getByLabelText("空格 (-4,3)"));
  expect(placeUnderground).not.toHaveBeenCalled();
  expect(placeBuilding).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText("入口预览 (-4,3)，尚未安装"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("空格 (5,3)"));
  expect(placeUnderground).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("空格 (3,4)"));
  expect(placeUnderground).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByLabelText("空格 (4,3)")));
  expect(placeUnderground).toHaveBeenCalledWith(
    original.id,
    { x: -4, y: 3, rotation: 0 },
    { x: 4, y: 3, rotation: 0 },
  );
  expect(
    screen.queryByLabelText("入口预览 (-4,3)，尚未安装"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("空格 (-4,3)"));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByLabelText("入口预览 (-4,3)，尚未安装"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("空格 (-4,3)"));
  rerender(<FactoryEditor {...props} placementType="hand_belt" />);
  rerender(<FactoryEditor {...props} />);
  expect(
    screen.queryByLabelText("入口预览 (-4,3)，尚未安装"),
  ).not.toBeInTheDocument();
});
const original: FactoryDetail = {
  id: "editor-factory",
  owner_id: "owner",
  name: "编辑测试",
  width: 21,
  height: 21,
  created_at: "now",
  buildings: [
    {
      id: "bus",
      factory_id: "editor-factory",
      building_type: "bus",
      x: 0,
      y: 0,
      rotation: 0,
      configuration: {},
    },
    {
      id: "workbench-a",
      factory_id: "editor-factory",
      building_type: "m01",
      x: 1,
      y: 1,
      rotation: 0,
      configuration: { custom: "preserve" },
    },
    {
      id: "workbench-b",
      factory_id: "editor-factory",
      building_type: "m01",
      x: 2,
      y: 2,
      rotation: 0,
      configuration: {},
    },
  ],
};
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(
    type: string,
    options: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
  ) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "mouse";
  }
}
beforeAll(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const map = this.classList.contains("map-viewport");
      return {
        x: map ? 100 : 0,
        y: map ? 100 : 0,
        left: map ? 100 : 0,
        top: map ? 100 : 0,
        right: map ? 730 : 0,
        bottom: map ? 730 : 0,
        width: map ? 630 : 0,
        height: map ? 630 : 0,
        toJSON: () => ({}),
      };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
function Harness({
  onError = vi.fn(),
}: {
  onError?: (error: unknown) => void;
}) {
  const [factory, setFactory] = useState(original),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<string | null>(null);
  return (
    <>
      <button
        aria-pressed={tool === "m01"}
        onClick={() => {
          setTool(tool === "m01" ? null : "m01");
          setSelected(null);
        }}
      >
        放置自动工作台
      </button>
      <input aria-label="备注" />
      <FactoryEditor
        commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
        factory={factory}
        catalog={catalog}
        selectedID={selected}
        placementType={tool}
        onExitPlacement={() => setTool(null)}
        onSelect={(b) => setSelected(b?.id ?? null)}
        onChange={(f, id) => {
          setFactory(f);
          if (!tool) setSelected(id);
        }}
        onError={onError}
      />
    </>
  );
}
function area() {
  return screen.getByLabelText("工厂地图，可滚轮缩放和拖动空格平移");
}
function point(x = 3, y = 2) {
  // Derive screen positions from the rendered camera, rather than assuming 100% zoom.
  const scene = document.querySelector<HTMLElement>(".factory-map")!;
  const parts = scene.style.transform.match(
    /translate\(([-.\d]+)px, ([-.\d]+)px\) scale\(([-.\d]+)\)/,
  )!;
  const [cx, cy, zoom] = parts.slice(1).map(Number);
  return {
    clientX: 100 + cx + (26 + (x + 10.5) * 30) * zoom,
    clientY: 100 + cy + (26 + (10.5 - y) * 30) * zoom,
    pointerId: 1,
    pointerType: "mouse",
    buttons: 1,
  };
}
function hold(element: HTMLElement) {
  vi.useFakeTimers();
  fireEvent.pointerDown(element, { ...point(1, 1), button: 0 });
  act(() => vi.advanceTimersByTime(50));
  fireEvent.pointerMove(window, point());
}

it("always renders every supplied robot route and uses directional PNGs before a robot is selected", () => {
  const robots = [0, 1].map((n) => ({
    id: `route-${n}`,
    item: "i0108",
    factory_id: original.id,
    home_factory_id: original.id,
    home_station: "workbench-a",
    x: -4 - n,
    y: 0,
    energy_kj: 1000,
    enabled: true,
    allowed_zones: [original.id],
    priority: 3,
    cooldown: 0,
    status: "moving",
  }));
  const onSelectRobot = vi.fn();
  render(
    <FactoryEditor
      commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
      factory={{ ...original, robots }}
      catalog={catalog}
      selectedID={null}
      placementType={null}
      onExitPlacement={vi.fn()}
      onSelect={vi.fn()}
      onChange={vi.fn()}
      onError={vi.fn()}
      onSelectRobot={onSelectRobot}
      robotRoutes={robots.map((r) => ({
        robot_id: r.id,
        factory_id: original.id,
        status: "ready",
        points: [
          { factory_id: original.id, x: r.x, y: r.y },
          { factory_id: original.id, x: r.x, y: 2 },
        ],
      }))}
    />,
  );
  expect(document.querySelectorAll("[data-robot-route]")).toHaveLength(2);
  expect(document.querySelectorAll("[data-robot-visual] img")).toHaveLength(2);
  expect(document.querySelector("[data-robot-visual] svg")).toBeNull();
  fireEvent.click(screen.getByLabelText("机器人当前路段预览"));
  expect(onSelectRobot).not.toHaveBeenCalled();
});

it("selects the logistics tile when it overlaps a visible robot", () => {
  const belt = {
    ...original.buildings[1],
    id: "shared-belt",
    building_type: "hand_belt",
    x: 4,
    y: 0,
  };
  const onSelect = vi.fn(),
    onSelectRobot = vi.fn();
  render(
    <FactoryEditor
      commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
      factory={{
        ...original,
        buildings: [...original.buildings, belt],
        robots: [
          {
            id: "overlap",
            item: "i0108",
            factory_id: original.id,
            home_factory_id: original.id,
            home_station: "workbench-a",
            x: 4,
            y: 0,
            energy_kj: 1000,
            enabled: true,
            allowed_zones: [original.id],
            priority: 3,
            cooldown: 0,
            status: "moving",
          },
        ],
      }}
      catalog={catalog}
      selectedID={null}
      placementType={null}
      onExitPlacement={vi.fn()}
      onSelect={onSelect}
      onChange={vi.fn()}
      onError={vi.fn()}
      onSelectRobot={onSelectRobot}
    />,
  );
  expect(
    document.querySelector('[data-robot-visual="overlap"] img'),
  ).not.toBeNull();
  expect(
    screen.queryByLabelText("选择机器人 overlap (4,0)"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("初阶传送带 HAND (4,0)"), point(4, 0));
  expect(onSelect).toHaveBeenCalledWith(belt);
  expect(onSelectRobot).not.toHaveBeenCalled();
});

it.each(["middle", "e", "E"])(
  "picks the complete hovered footprint with %s and keeps its direction",
  (key) => {
    const instance = {
      ...original.buildings[1],
      size: 2 as const,
      rotation: 270 as const,
    };
    const factory = {
      ...original,
      buildings: [original.buildings[0], instance],
    };
    const onPickBuilding = vi.fn().mockReturnValue(true);
    function PickHarness() {
      const [type, setType] = useState<string | null>(null);
      return (
        <FactoryEditor
          commands={{
            deleteBuilding,
            getFactory,
            placeBuilding,
            updateBuilding,
          }}
          factory={factory}
          catalog={catalog}
          selectedID={null}
          placementType={type}
          placementSize={2}
          onExitPlacement={vi.fn()}
          onSelect={vi.fn()}
          onChange={vi.fn()}
          onError={vi.fn()}
          onPickBuilding={(b) => {
            onPickBuilding(b);
            setType(b.building_type);
            return true;
          }}
        />
      );
    }
    render(<PickHarness />);
    fireEvent.pointerMove(area(), point(2, 0));
    if (key === "middle") {
      fireEvent.pointerDown(area(), { ...point(2, 0), button: 1, buttons: 4 });
    } else {
      fireEvent.keyDown(window, { key });
    }
    expect(onPickBuilding).toHaveBeenCalledExactlyOnceWith(instance);
    expect(document.querySelector(".drag-ghost")).toHaveTextContent("270°");
    expect(document.querySelector(".drag-ghost")).toHaveTextContent(
      "当前尺寸：2×2",
    );
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(updateBuilding).not.toHaveBeenCalled();
  },
);

it("isolates pick shortcuts from typing, composition, modifiers, repeats, hidden maps and empty cells", () => {
  const onPickBuilding = vi.fn().mockReturnValue(true);
  const props = {
    commands: { deleteBuilding, getFactory, placeBuilding, updateBuilding },
    factory: original,
    catalog,
    selectedID: null,
    placementType: null,
    onExitPlacement: vi.fn(),
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onError: vi.fn(),
    onPickBuilding,
  };
  const { rerender } = render(
    <>
      <input aria-label="拾取输入隔离" />
      <FactoryEditor {...props} />
    </>,
  );
  fireEvent.pointerMove(area(), point(1, 1));
  fireEvent.keyDown(screen.getByLabelText("拾取输入隔离"), { key: "e" });
  for (const options of [
    { isComposing: true },
    { repeat: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ]) {
    fireEvent.keyDown(window, { key: "e", ...options });
  }
  rerender(<FactoryEditor {...props} visible={false} />);
  fireEvent.keyDown(window, { key: "e" });
  expect(onPickBuilding).not.toHaveBeenCalled();
  rerender(<FactoryEditor {...props} />);
  fireEvent.pointerMove(area(), point(4, 4));
  fireEvent.keyDown(window, { key: "e" });
  fireEvent.pointerMove(area(), point(1, 1));
  fireEvent.pointerLeave(area());
  fireEvent.keyDown(window, { key: "e" });
  expect(onPickBuilding).not.toHaveBeenCalled();
});

it.each(["hand_belt", "pipe", "return_pipe", "pressure_valve"])(
  "changes %s direction in place through update, keeps build mode and skips identical directions",
  async (type) => {
    const definition = catalog.buildings.find((d) => d.id === type)!;
    const instance = {
      ...original.buildings[1],
      building_type: type,
      rotation: 180 as const,
    };
    const factory = {
      ...original,
      buildings: [original.buildings[0], instance],
    };
    updateBuilding.mockResolvedValue(factory);
    const onExitPlacement = vi.fn(),
      onError = vi.fn();
    const props = {
      commands: { deleteBuilding, getFactory, placeBuilding, updateBuilding },
      factory,
      catalog,
      selectedID: null,
      placementType: type,
      onExitPlacement,
      onSelect: vi.fn(),
      onChange: vi.fn(),
      onError,
    };
    const { rerender } = render(<FactoryEditor {...props} />);
    fireEvent.pointerMove(area(), point(1, 1));
    expect(document.querySelectorAll(".drop-valid")).toHaveLength(1);
    expect(screen.getByText(/修正方向 .*不消耗道具/)).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", {
          name: `${definition.name} ${definition.code} (1,1)`,
        }),
        point(1, 1),
      ),
    );
    expect(updateBuilding).toHaveBeenCalledExactlyOnceWith(
      factory.id,
      instance.id,
      { x: 1, y: 1, rotation: 0 },
    );
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(deleteBuilding).not.toHaveBeenCalled();
    expect(onExitPlacement).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    rerender(
      <FactoryEditor
        {...props}
        factory={{
          ...factory,
          buildings: [factory.buildings[0], { ...instance, rotation: 0 }],
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `${definition.name} ${definition.code} (1,1)`,
      }),
      point(1, 1),
    );
    expect(updateBuilding).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ["hand_belt", "mechanical_belt"],
  ["pipe", "return_pipe"],
  ["m01", "m01"],
  ["underground_belt", "underground_belt"],
])(
  "rejects occupied %s when holding %s without replacement",
  (existingType, holdingType) => {
    const definition = catalog.buildings.find((d) => d.id === existingType)!;
    const onError = vi.fn();
    render(
      <FactoryEditor
        commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
        factory={{
          ...original,
          buildings: [
            { ...original.buildings[1], building_type: existingType },
          ],
        }}
        catalog={catalog}
        selectedID={null}
        placementType={holdingType}
        onExitPlacement={vi.fn()}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onError={onError}
      />,
    );
    fireEvent.pointerMove(area(), point(1, 1));
    expect(document.querySelectorAll(".drop-invalid")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: `${definition.name} ${definition.code} (1,1)`,
      }),
      point(1, 1),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "目标格子已被占用" }),
    );
    expect(updateBuilding).not.toHaveBeenCalled();
    expect(placeBuilding).not.toHaveBeenCalled();
  },
);
function addBuilding(
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
  base = original,
): FactoryDetail {
  return {
    ...base,
    buildings: [
      ...base.buildings,
      {
        id: `new-${x}-${y}`,
        factory_id: original.id,
        building_type: "m01",
        x,
        y,
        rotation,
        configuration: {},
      },
    ],
  };
}
describe("batch map gestures", () => {
  const moveBuildings = vi.fn(),
    deleteBuildings = vi.fn();
  function setupBatch(factory = original) {
    const onError = vi.fn(),
      onChange = vi.fn();
    render(
      <FactoryEditor
        factory={factory}
        catalog={catalog}
        selectedID={null}
        placementType={null}
        commands={{
          deleteBuilding,
          getFactory,
          placeBuilding,
          updateBuilding,
          moveBuildings,
          deleteBuildings,
        }}
        onSelect={vi.fn()}
        onExitPlacement={vi.fn()}
        onChange={onChange}
        onError={onError}
      />,
    );
    return { onError, onChange };
  }
  function box(a = point(0, 3), b = point(3, 0)) {
    fireEvent.pointerDown(area(), { ...a, button: 2, buttons: 2 });
    fireEvent.pointerMove(window, { ...b, buttons: 2 });
    expect(screen.getByLabelText("建筑框选范围")).toBeInTheDocument();
    fireEvent.pointerUp(window, { ...b, button: 2, buttons: 0 });
  }
  it("right-drags to select buildings, excludes WH and opens an immediate batch menu", async () => {
    setupBatch();
    box();
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(2);
    expect(
      document.querySelector('.map-tile[data-x="0"][data-y="0"]'),
    ).not.toHaveClass("batch-selected");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const building = screen.getByLabelText("自动工作台 M01 (1,1)");
    fireEvent.pointerDown(building, { ...point(1, 1), button: 2, buttons: 2 });
    fireEvent.pointerUp(window, { ...point(1, 1), button: 2, buttons: 0 });
    fireEvent.contextMenu(building, point(1, 1));
    deleteBuildings.mockResolvedValue(original);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("menuitem", { name: "删除选中 2 个建筑" }),
      ),
    );
    expect(deleteBuildings).toHaveBeenCalledExactlyOnceWith(original.id, [
      "workbench-a",
      "workbench-b",
    ]);
    expect(deleteBuilding).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(0);
  });
  it("drags the group with one command, previews every target and preserves relative offsets", async () => {
    vi.useFakeTimers();
    setupBatch();
    box();
    const building = screen.getByLabelText("自动工作台 M01 (1,1)");
    fireEvent.pointerDown(building, { ...point(1, 1), button: 0 });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.pointerMove(window, point(2, 1));
    expect(document.querySelectorAll(".batch-move-preview")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "r" });
    expect(updateBuilding).not.toHaveBeenCalled();
    moveBuildings.mockResolvedValue(original);
    await act(async () =>
      fireEvent.pointerUp(window, { ...point(2, 1), button: 0, buttons: 0 }),
    );
    expect(moveBuildings).toHaveBeenCalledExactlyOnceWith(
      original.id,
      ["workbench-a", "workbench-b"],
      1,
      0,
    );
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("rejects a colliding group without a command and keeps the selection for retry", () => {
    vi.useFakeTimers();
    const { onError } = setupBatch();
    box();
    fireEvent.pointerDown(screen.getByLabelText("自动工作台 M01 (1,1)"), {
      ...point(1, 1),
      button: 0,
    });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.pointerMove(window, point(0, 0));
    expect(document.querySelectorAll(".drop-invalid").length).toBeGreaterThan(
      0,
    );
    fireEvent.pointerUp(window, { ...point(0, 0), button: 0, buttons: 0 });
    expect(moveBuildings).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(2);
  });
  it("deletes with Del, protects input fields, and clears selection with Escape", async () => {
    setupBatch();
    box();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(deleteBuildings).not.toHaveBeenCalled();
    input.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(0);
    box();
    deleteBuildings.mockResolvedValue(original);
    await act(async () => fireEvent.keyDown(window, { key: "Delete" }));
    expect(deleteBuildings).toHaveBeenCalledExactlyOnceWith(original.id, [
      "workbench-a",
      "workbench-b",
    ]);
  });
  it("selects the full large footprint and the off-rectangle tunnel peer", () => {
    const factory = structuredClone(original);
    factory.buildings.push(
      {
        id: "large",
        factory_id: factory.id,
        building_type: "m08",
        x: 3,
        y: 4,
        size: 2,
        rotation: 0,
        configuration: {},
      },
      {
        id: "entry",
        factory_id: factory.id,
        building_type: "underground_belt",
        x: 4,
        y: 2,
        rotation: 0,
        configuration: { underground_peer: "exit", underground_role: "entry" },
      },
      {
        id: "exit",
        factory_id: factory.id,
        building_type: "underground_belt",
        x: 7,
        y: 2,
        rotation: 0,
        configuration: { underground_peer: "entry", underground_role: "exit" },
      },
    );
    setupBatch(factory);
    box(point(4, 3), point(4, 2));
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(6);
    expect(
      screen.getByText("删除选中 3 个建筑").closest("button"),
    ).toBeEnabled();
  });
  it("cancels an unfinished rectangle on pointer loss and preserves simple right-click menus", () => {
    setupBatch();
    fireEvent.pointerDown(area(), { ...point(0, 3), button: 2, buttons: 2 });
    fireEvent.pointerMove(window, { ...point(3, 0), buttons: 2 });
    fireEvent.pointerCancel(window, point());
    expect(screen.queryByLabelText("建筑框选范围")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(0);
    const building = screen.getByLabelText("自动工作台 M01 (1,1)");
    fireEvent.pointerDown(building, { ...point(1, 1), button: 2, buttons: 2 });
    fireEvent.pointerUp(window, { ...point(1, 1), button: 2, buttons: 0 });
    fireEvent.contextMenu(building, point(1, 1));
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });
});

describe("factory editor interactions", () => {
  it("continuously places with clicks, rotates previews, and exits with the same palette tool", async () => {
    const first = addBuilding(3, 2, 90),
      second = addBuilding(4, 2, 90, first);
    vi.mocked(placeBuilding)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    render(<Harness />);
    const palette = screen.getByRole("button", { name: "放置自动工作台" });
    fireEvent.click(palette);
    fireEvent.pointerMove(area(), { ...point(), buttons: 0 });
    expect(
      document.querySelector('.map-tile[data-x="3"][data-y="2"]'),
    ).toHaveClass("drop-valid");
    fireEvent.contextMenu(area(), { ...point(), button: 2 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    });
    expect(placeBuilding).toHaveBeenNthCalledWith(1, original.id, "m01", {
      x: 3,
      y: 2,
      rotation: 90,
    });
    expect(palette).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("空格 (4,2)"));
    });
    expect(placeBuilding).toHaveBeenNthCalledWith(2, original.id, "m01", {
      x: 4,
      y: 2,
      rotation: 90,
    });
    fireEvent.click(palette);
    expect(palette).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".drag-ghost")).not.toBeInTheDocument();
  });
  it("pans empty tiles in placement mode without building on release, then allows short-click building", async () => {
    vi.mocked(placeBuilding).mockResolvedValue(addBuilding(3, 2));
    render(<Harness />);
    const tool = screen.getByRole("button", { name: "放置自动工作台" });
    fireEvent.click(tool);
    const empty = screen.getByLabelText("空格 (3,2)"),
      start = point();
    fireEvent.pointerDown(empty, { ...start, button: 0 });
    fireEvent.pointerMove(window, { ...start, clientX: start.clientX + 35 });
    fireEvent.pointerUp(window, {
      ...start,
      clientX: start.clientX + 35,
      button: 0,
      buttons: 0,
    });
    fireEvent.click(empty);
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(tool).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.pointerDown(empty, { ...point(), button: 0 });
      fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
      fireEvent.click(empty);
    });
    expect(placeBuilding).toHaveBeenCalledWith(original.id, "m01", {
      x: 3,
      y: 2,
      rotation: 0,
    });
  });
  it("shows occupied tiles as invalid and right-click rotates instead of opening a menu in placement mode", () => {
    const errors = vi.fn();
    render(<Harness onError={errors} />);
    fireEvent.click(screen.getByRole("button", { name: "放置自动工作台" }));
    fireEvent.pointerMove(area(), { ...point(0, 0), buttons: 0 });
    expect(
      document.querySelector('.map-tile[data-x="0"][data-y="0"]'),
    ).toHaveClass("drop-invalid");
    const bus = screen.getByLabelText("工厂仓库 WH (0,0)");
    fireEvent.contextMenu(bus, { ...point(0, 0), button: 2 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByText(/连续放置 自动工作台 · 1×1 · 90°/),
    ).toBeInTheDocument();
    expect(document.querySelector(".drag-ghost")).toHaveTextContent(
      "当前尺寸：1×1",
    );
    expect(document.querySelector(".drag-ghost")).not.toHaveTextContent(
      "Q 键切换尺寸",
    );
    fireEvent.click(bus);
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: "目标格子已被占用" }),
    );
    fireEvent.pointerLeave(area());
    expect(document.querySelector(".drag-ghost")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: "放置自动工作台" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
  it("keeps placement mode after a rejected save and does not duplicate an in-flight request", async () => {
    const errors = vi.fn();
    let reject!: (error: Error) => void;
    vi.mocked(placeBuilding).mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    render(<Harness onError={errors} />);
    fireEvent.click(screen.getByRole("button", { name: "放置自动工作台" }));
    fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    fireEvent.click(screen.getByLabelText("空格 (4,2)"));
    expect(placeBuilding).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error("服务器拒绝"));
    });
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: "服务器拒绝" }),
    );
    expect(
      screen.getByRole("button", { name: "放置自动工作台" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("空格 (3,2)")).toBeInTheDocument();
  });
  it("moves the existing instance with right-button rotation and commits once while right remains held", async () => {
    vi.mocked(updateBuilding).mockResolvedValue({
      ...original,
      buildings: original.buildings.map((b) =>
        b.id === "workbench-a" ? { ...b, x: 3, y: 2, rotation: 90 } : b,
      ),
    });
    render(<Harness />);
    hold(screen.getByLabelText("自动工作台 M01 (1,1)"));
    fireEvent.mouseDown(window, { ...point(), button: 2, buttons: 3 });
    const context = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.mouseUp(window, { ...point(), button: 0, buttons: 2 });
    });
    fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
    expect(updateBuilding).toHaveBeenCalledOnce();
    expect(updateBuilding).toHaveBeenCalledWith(original.id, "workbench-a", {
      x: 3,
      y: 2,
      rotation: 90,
    });
    expect(screen.getByLabelText("自动工作台 M01 (3,2)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("自动工作台 M01 (2,2)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.mouseUp(window, { button: 2 });
  });
  it("short clicks select without moving; Escape, capture loss and window blur cancel dragging", () => {
    render(<Harness />);
    vi.useFakeTimers();
    const workbench = screen.getByLabelText("自动工作台 M01 (1,1)");
    fireEvent.pointerDown(workbench, { ...point(1, 1), button: 0 });
    act(() => vi.advanceTimersByTime(25));
    fireEvent.pointerUp(window, { ...point(1, 1), button: 0, buttons: 0 });
    fireEvent.click(workbench);
    expect(workbench).toHaveAttribute("aria-pressed", "true");
    for (const cancel of [
      () => fireEvent.keyDown(window, { key: "Escape" }),
      () => fireEvent.pointerCancel(window, { pointerId: 1 }),
      () => fireEvent.blur(window),
    ]) {
      hold(workbench);
      cancel();
      fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
    }
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("rejects occupied and outside moves and retains the old layout if the server rejects", async () => {
    const errors = vi.fn();
    render(<Harness onError={errors} />);
    hold(screen.getByLabelText("自动工作台 M01 (1,1)"));
    fireEvent.pointerUp(window, { ...point(0, 0), button: 0, buttons: 0 });
    hold(screen.getByLabelText("自动工作台 M01 (1,1)"));
    fireEvent.pointerUp(window, {
      ...point(),
      clientX: 30,
      button: 0,
      buttons: 0,
    });
    expect(updateBuilding).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(2);
    vi.mocked(updateBuilding).mockRejectedValue(new Error("拒绝保存"));
    hold(screen.getByLabelText("自动工作台 M01 (1,1)"));
    await act(async () => {
      fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
    });
    expect(screen.getByLabelText("自动工作台 M01 (1,1)")).toBeInTheDocument();
  });
  it("opens an extensible menu for the exact right-clicked instance and deletes it", async () => {
    vi.mocked(deleteBuilding).mockResolvedValue({
      ...original,
      buildings: original.buildings.filter((b) => b.id !== "workbench-b"),
    });
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("自动工作台 M01 (1,1)"));
    fireEvent.contextMenu(screen.getByLabelText("自动工作台 M01 (2,2)"), {
      button: 2,
      clientX: 500,
      clientY: 350,
    });
    expect(screen.getByRole("menu", { name: "建筑操作" })).toBeInTheDocument();
    expect(screen.getByLabelText("自动工作台 M01 (2,2)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("menuitem", { name: "删除" }).querySelector("svg"),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    });
    expect(deleteBuilding).toHaveBeenCalledWith(original.id, "workbench-b");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByLabelText("自动工作台 M01 (1,1)")).toBeInTheDocument();
  });
  it("dismisses menus on outside interaction and Escape, and prevents warehouse rotation / deletion", () => {
    render(<Harness />);
    const bus = screen.getByLabelText("工厂仓库 WH (0,0)");
    fireEvent.contextMenu(bus, { button: 2 });
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "r" });
    expect(updateBuilding).not.toHaveBeenCalled();
    expect(deleteBuilding).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(bus, { button: 2 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("drags the warehouse after 50ms while ignoring rotation during the drag and retaining its instance", async () => {
    vi.useFakeTimers();
    vi.mocked(updateBuilding).mockResolvedValue({
      ...original,
      buildings: original.buildings.map((b) =>
        b.id === "bus" ? { ...b, x: 3, y: 2 } : b,
      ),
    });
    render(<Harness />);
    const bus = screen.getByLabelText("工厂仓库 WH (0,0)");
    fireEvent.pointerDown(bus, { ...point(0, 0), button: 0 });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.pointerMove(window, point(3, 2));
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.mouseDown(window, { button: 2 });
    fireEvent.mouseUp(window, { button: 2 });
    await act(async () =>
      fireEvent.pointerUp(window, { ...point(3, 2), button: 0, buttons: 0 }),
    );
    expect(updateBuilding).toHaveBeenCalledExactlyOnceWith(original.id, "bus", {
      x: 3,
      y: 2,
      rotation: 0,
    });
    expect(screen.getByLabelText("工厂仓库 WH (3,2)")).toBeInTheDocument();
    expect(screen.getByLabelText("空格 (0,0)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /旋转建筑/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /删除建筑/ })).toBeDisabled();
    expect(deleteBuilding).not.toHaveBeenCalled();
  });
  it("zooms around the pointer and preserves placement coordinates after zoom and pan", async () => {
    vi.mocked(placeBuilding).mockResolvedValue(addBuilding(3, 2));
    render(<Harness />);
    const anchor = point();
    fireEvent.wheel(area(), { ...anchor, deltaY: -180 });
    const moved = point();
    expect(moved.clientX).toBeCloseTo(anchor.clientX);
    expect(moved.clientY).toBeCloseTo(anchor.clientY);
    const scene = document.querySelector<HTMLElement>(".factory-map")!;
    const before = scene.style.transform;
    fireEvent.pointerDown(screen.getByLabelText("空格 (3,2)"), {
      ...moved,
      button: 0,
    });
    fireEvent.pointerMove(window, {
      ...moved,
      clientX: moved.clientX + 45,
      clientY: moved.clientY + 20,
    });
    fireEvent.pointerUp(window, {
      ...moved,
      clientX: moved.clientX + 45,
      clientY: moved.clientY + 20,
      button: 0,
      buttons: 0,
    });
    fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    expect(scene.style.transform).not.toBe(before);
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(updateBuilding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放置自动工作台" }));
    fireEvent.pointerMove(area(), { ...point(), buttons: 0 });
    expect(
      document.querySelector('.map-tile[data-x="3"][data-y="2"]'),
    ).toHaveClass("drop-valid");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    });
    expect(placeBuilding).toHaveBeenCalledWith(original.id, "m01", {
      x: 3,
      y: 2,
      rotation: 0,
    });
  });
  it("shows machine names only after zooming in and follows fit / recenter", () => {
    render(<Harness />);
    expect(document.querySelector(".machine-name-layer")).not.toBeNull();
    fireEvent.wheel(area(), { ...point(0, 0), deltaY: -10000 });
    const layer = document.querySelector(".machine-name-layer")!;
    expect(layer).toHaveTextContent("工作台");
    expect(layer.closest(".factory-map")).toBeNull();
    expect(layer.querySelector('[data-building-type="bus"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "适应地图" }));
    expect(document.querySelector(".machine-name-layer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "居中放大" }));
    expect(document.querySelector(".machine-name-layer")).not.toBeNull();
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("clamps wheel zoom and restores a centered fit without mutating the factory", () => {
    render(<Harness />);
    fireEvent.wheel(area(), { ...point(0, 0), deltaY: -10000 });
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("300%");
    fireEvent.wheel(area(), { ...point(0, 0), deltaY: 10000 });
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("50%");
    fireEvent.click(screen.getByRole("button", { name: "适应地图" }));
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("91%");
    fireEvent.click(screen.getByRole("button", { name: "居中放大" }));
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("125%");
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("refreshes the authoritative snapshot and does not intercept text-editing shortcuts", async () => {
    vi.mocked(getFactory).mockResolvedValue({
      ...original,
      buildings: original.buildings.filter((b) => b.id !== "workbench-a"),
    });
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("自动工作台 M01 (1,1)"));
    fireEvent.keyDown(screen.getByLabelText("备注"), { key: "Delete" });
    fireEvent.keyDown(screen.getByLabelText("备注"), { key: "r" });
    expect(deleteBuilding).not.toHaveBeenCalled();
    expect(updateBuilding).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重绘布局" }));
    });
    expect(getFactory).toHaveBeenCalledWith(
      original.id,
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole("button", { name: "自动工作台 M01 (1,1)" }),
    ).not.toBeInTheDocument();
  });
});

it("previews four cells and places a 2×2 machine with the clicked top-left anchor", async () => {
  placeBuilding.mockResolvedValue(original);
  render(
    <FactoryEditor
      commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
      factory={original}
      catalog={catalog}
      selectedID={null}
      placementType="m08"
      placementSize={2}
      onExitPlacement={vi.fn()}
      onSelect={vi.fn()}
      onChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.pointerMove(area(), point(4, 4));
  expect(document.querySelectorAll(".drop-valid")).toHaveLength(4);
  expect(
    screen.getByText(/左键建造 \/ 右键旋转 \/ Q 键切换尺寸 \/ Esc 退出/),
  ).toBeInTheDocument();
  expect(document.querySelector(".drag-ghost")).toHaveTextContent(
    "当前尺寸：2×2",
  );
  expect(document.querySelector(".drag-ghost")).toHaveTextContent(
    "Q 键切换尺寸",
  );
  expect(
    document.querySelector<HTMLElement>(".tile-preview")!.style.width,
  ).toBe("60px");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "空格 (4,4)" }));
  });
  expect(placeBuilding).toHaveBeenCalledWith(original.id, "m08", {
    x: 4,
    y: 4,
    rotation: 0,
    size: 2,
  });
});
it("renders one facade and retains the grab offset when moving from a covered footprint cell", async () => {
  vi.useFakeTimers();
  const large = {
    ...original,
    buildings: [
      ...original.buildings,
      {
        id: "large",
        factory_id: original.id,
        building_type: "m08",
        x: 4,
        y: 4,
        size: 2 as const,
        rotation: 0 as const,
        configuration: { recipe_id: "r1036" },
      },
    ],
  };
  const onChange = vi.fn();
  updateBuilding.mockResolvedValue(large);
  render(
    <FactoryEditor
      commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
      factory={large}
      catalog={catalog}
      selectedID="large"
      placementType={null}
      onExitPlacement={vi.fn()}
      onSelect={vi.fn()}
      onChange={onChange}
      onError={vi.fn()}
    />,
  );
  expect(
    document.querySelectorAll('.building-map-visual[data-building-id="m08"]'),
  ).toHaveLength(1);
  const covered = screen.getByRole("button", { name: "自动装配台 M08 (5,3)" });
  fireEvent.pointerDown(covered, { ...point(5, 3), button: 0 });
  act(() => vi.advanceTimersByTime(50));
  fireEvent.pointerMove(window, point(7, 5));
  await act(async () => {
    fireEvent.pointerUp(window, { ...point(7, 5), button: 0, buttons: 0 });
  });
  expect(updateBuilding).toHaveBeenCalledWith(original.id, "large", {
    x: 6,
    y: 6,
    rotation: 0,
    size: 2,
  });
}, 15000);
it("toggles the power region overlay from the camera controls bar", () => {
  render(
    <FactoryEditor
      commands={{ deleteBuilding, getFactory, placeBuilding, updateBuilding }}
      factory={original}
      catalog={catalog}
      selectedID={null}
      placementType={null}
      onExitPlacement={vi.fn()}
      onSelect={vi.fn()}
      onChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const toggle = screen.getByRole("button", { name: "显示组网" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByLabelText("工厂组网覆盖层")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "隐藏组网" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByLabelText("工厂组网覆盖层")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "隐藏组网" }));
  expect(screen.queryByLabelText("工厂组网覆盖层")).toBeNull();
}, 15000);

it("initializes only when visible and retains the camera across factories, hidden tabs and viewport resizing", () => {
  let width = 0,
    height = 0,
    notifyResize = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("map-viewport")
        ? new DOMRect(100, 100, width, height)
        : new DOMRect();
    },
  );
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      notifyResize = callback;
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const props = {
    commands: { deleteBuilding, getFactory, placeBuilding, updateBuilding },
    factory: original,
    catalog,
    selectedID: null,
    placementType: null,
    onExitPlacement: vi.fn(),
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onError: vi.fn(),
  };
  const { rerender, unmount } = render(
    <FactoryEditor {...props} visible={false} />,
  );
  try {
    const viewport =
      screen.getByLabelText("工厂地图，可滚轮缩放和拖动空格平移");
    const scene = () => document.querySelector<HTMLElement>(".factory-map")!;
    expect(viewport.style.visibility).toBe("hidden");
    width = 630;
    height = 630;
    rerender(<FactoryEditor {...props} visible />);
    expect(viewport.style.visibility).toBe("");
    expect(scene().style.transform).not.toContain("translate(0px, 0px)");
    fireEvent.wheel(viewport, { ...point(3, 2), deltaY: -180 });
    fireEvent.pointerDown(viewport, { ...point(-4, -4), button: 0 });
    fireEvent.pointerMove(window, {
      ...point(-4, -4),
      clientX: point(-4, -4).clientX + 30,
      clientY: point(-4, -4).clientY + 20,
    });
    fireEvent.pointerUp(window, { ...point(-4, -4), button: 0, buttons: 0 });
    const beforeSwitch = scene().style.transform;
    const zoom = screen.getByLabelText("当前缩放").textContent;
    const second = {
      ...original,
      id: "second-factory",
      name: "分厂",
      buildings: original.buildings.map((b) => ({
        ...b,
        factory_id: "second-factory",
      })),
    };
    rerender(<FactoryEditor {...props} factory={second} visible />);
    expect(scene().style.transform).toBe(beforeSwitch);
    expect(screen.getByLabelText("当前缩放").textContent).toBe(zoom);
    const focus = { factory_id: second.id, x: 4, y: 3, sequence: 1 };
    rerender(
      <FactoryEditor {...props} factory={second} robotFocus={focus} visible />,
    );
    fireEvent.wheel(viewport, { ...point(-2, -2), deltaY: 100 });
    const beforeHide = scene().style.transform;
    width = 0;
    height = 0;
    rerender(
      <FactoryEditor
        {...props}
        factory={second}
        robotFocus={focus}
        visible={false}
      />,
    );
    act(() => notifyResize());
    expect(scene().style.transform).toBe(beforeHide);
    width = 630;
    height = 630;
    rerender(
      <FactoryEditor {...props} factory={second} robotFocus={focus} visible />,
    );
    expect(scene().style.transform).toBe(beforeHide);
    const previous = beforeHide
      .match(/translate\(([-.\d]+)px, ([-.\d]+)px\) scale\(([-.\d]+)\)/)!
      .slice(1)
      .map(Number);
    width = 830;
    height = 730;
    act(() => notifyResize());
    const resized = scene()
      .style.transform.match(
        /translate\(([-.\d]+)px, ([-.\d]+)px\) scale\(([-.\d]+)\)/,
      )!
      .slice(1)
      .map(Number);
    expect(resized[0]).toBeCloseTo(previous[0] + 100);
    expect(resized[1]).toBeCloseTo(previous[1] + 50);
    expect(resized[2]).toBe(previous[2]);
  } finally {
    unmount();
    globalThis.ResizeObserver = previousObserver;
  }
}, 15000);
