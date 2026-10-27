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
      id: "miner-a",
      factory_id: "editor-factory",
      building_type: "miner",
      x: 1,
      y: 1,
      rotation: 0,
      configuration: { custom: "preserve" },
    },
    {
      id: "miner-b",
      factory_id: "editor-factory",
      building_type: "miner",
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
        aria-pressed={tool === "miner"}
        onClick={() => {
          setTool(tool === "miner" ? null : "miner");
          setSelected(null);
        }}
      >
        放置采矿机
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
        building_type: "miner",
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
    const building = screen.getByLabelText("采矿机 MIN (1,1)");
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
      "miner-a",
      "miner-b",
    ]);
    expect(deleteBuilding).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".batch-selected")).toHaveLength(0);
  });
  it("drags the group with one command, previews every target and preserves relative offsets", async () => {
    vi.useFakeTimers();
    setupBatch();
    box();
    const building = screen.getByLabelText("采矿机 MIN (1,1)");
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
      ["miner-a", "miner-b"],
      1,
      0,
    );
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("rejects a colliding group without a command and keeps the selection for retry", () => {
    vi.useFakeTimers();
    const { onError } = setupBatch();
    box();
    fireEvent.pointerDown(screen.getByLabelText("采矿机 MIN (1,1)"), {
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
      "miner-a",
      "miner-b",
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
    const building = screen.getByLabelText("采矿机 MIN (1,1)");
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
    const palette = screen.getByRole("button", { name: "放置采矿机" });
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
    expect(placeBuilding).toHaveBeenNthCalledWith(1, original.id, "miner", {
      x: 3,
      y: 2,
      rotation: 90,
    });
    expect(palette).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("空格 (4,2)"));
    });
    expect(placeBuilding).toHaveBeenNthCalledWith(2, original.id, "miner", {
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
    const tool = screen.getByRole("button", { name: "放置采矿机" });
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
    expect(placeBuilding).toHaveBeenCalledWith(original.id, "miner", {
      x: 3,
      y: 2,
      rotation: 0,
    });
  });
  it("shows occupied tiles as invalid and right-click rotates instead of opening a menu in placement mode", () => {
    const errors = vi.fn();
    render(<Harness onError={errors} />);
    fireEvent.click(screen.getByRole("button", { name: "放置采矿机" }));
    fireEvent.pointerMove(area(), { ...point(0, 0), buttons: 0 });
    expect(
      document.querySelector('.map-tile[data-x="0"][data-y="0"]'),
    ).toHaveClass("drop-invalid");
    const bus = screen.getByLabelText("工厂仓库 WH (0,0)");
    fireEvent.contextMenu(bus, { ...point(0, 0), button: 2 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByText(/连续放置 采矿机 · 1×1 · 90°/)).toBeInTheDocument();
    expect(document.querySelector(".drag-ghost")).toHaveTextContent(
      "当前尺寸：1×1",
    );
    expect(document.querySelector(".drag-ghost")).not.toHaveTextContent(
      "E 键切换尺寸",
    );
    fireEvent.click(bus);
    expect(placeBuilding).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: "目标格子已被占用" }),
    );
    fireEvent.pointerLeave(area());
    expect(document.querySelector(".drag-ghost")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "放置采矿机" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "放置采矿机" }));
    fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    fireEvent.click(screen.getByLabelText("空格 (4,2)"));
    expect(placeBuilding).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error("服务器拒绝"));
    });
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: "服务器拒绝" }),
    );
    expect(screen.getByRole("button", { name: "放置采矿机" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("空格 (3,2)")).toBeInTheDocument();
  });
  it("moves the existing instance with right-button rotation and commits once while right remains held", async () => {
    vi.mocked(updateBuilding).mockResolvedValue({
      ...original,
      buildings: original.buildings.map((b) =>
        b.id === "miner-a" ? { ...b, x: 3, y: 2, rotation: 90 } : b,
      ),
    });
    render(<Harness />);
    hold(screen.getByLabelText("采矿机 MIN (1,1)"));
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
    expect(updateBuilding).toHaveBeenCalledWith(original.id, "miner-a", {
      x: 3,
      y: 2,
      rotation: 90,
    });
    expect(screen.getByLabelText("采矿机 MIN (3,2)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("采矿机 MIN (2,2)")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.mouseUp(window, { button: 2 });
  });
  it("short clicks select without moving; Escape, capture loss and window blur cancel dragging", () => {
    render(<Harness />);
    vi.useFakeTimers();
    const miner = screen.getByLabelText("采矿机 MIN (1,1)");
    fireEvent.pointerDown(miner, { ...point(1, 1), button: 0 });
    act(() => vi.advanceTimersByTime(25));
    fireEvent.pointerUp(window, { ...point(1, 1), button: 0, buttons: 0 });
    fireEvent.click(miner);
    expect(miner).toHaveAttribute("aria-pressed", "true");
    for (const cancel of [
      () => fireEvent.keyDown(window, { key: "Escape" }),
      () => fireEvent.pointerCancel(window, { pointerId: 1 }),
      () => fireEvent.blur(window),
    ]) {
      hold(miner);
      cancel();
      fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
    }
    expect(updateBuilding).not.toHaveBeenCalled();
  });
  it("rejects occupied and outside moves and retains the old layout if the server rejects", async () => {
    const errors = vi.fn();
    render(<Harness onError={errors} />);
    hold(screen.getByLabelText("采矿机 MIN (1,1)"));
    fireEvent.pointerUp(window, { ...point(0, 0), button: 0, buttons: 0 });
    hold(screen.getByLabelText("采矿机 MIN (1,1)"));
    fireEvent.pointerUp(window, {
      ...point(),
      clientX: 30,
      button: 0,
      buttons: 0,
    });
    expect(updateBuilding).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(2);
    vi.mocked(updateBuilding).mockRejectedValue(new Error("拒绝保存"));
    hold(screen.getByLabelText("采矿机 MIN (1,1)"));
    await act(async () => {
      fireEvent.pointerUp(window, { ...point(), button: 0, buttons: 0 });
    });
    expect(screen.getByLabelText("采矿机 MIN (1,1)")).toBeInTheDocument();
  });
  it("opens an extensible menu for the exact right-clicked instance and deletes it", async () => {
    vi.mocked(deleteBuilding).mockResolvedValue({
      ...original,
      buildings: original.buildings.filter((b) => b.id !== "miner-b"),
    });
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("采矿机 MIN (1,1)"));
    fireEvent.contextMenu(screen.getByLabelText("采矿机 MIN (2,2)"), {
      button: 2,
      clientX: 500,
      clientY: 350,
    });
    expect(screen.getByRole("menu", { name: "建筑操作" })).toBeInTheDocument();
    expect(screen.getByLabelText("采矿机 MIN (2,2)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("menuitem", { name: "删除" }).querySelector("svg"),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    });
    expect(deleteBuilding).toHaveBeenCalledWith(original.id, "miner-b");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByLabelText("采矿机 MIN (1,1)")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "放置采矿机" }));
    fireEvent.pointerMove(area(), { ...point(), buttons: 0 });
    expect(
      document.querySelector('.map-tile[data-x="3"][data-y="2"]'),
    ).toHaveClass("drop-valid");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("空格 (3,2)"));
    });
    expect(placeBuilding).toHaveBeenCalledWith(original.id, "miner", {
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
    expect(layer).toHaveTextContent("采矿机");
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
      buildings: original.buildings.filter((b) => b.id !== "miner-a"),
    });
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("采矿机 MIN (1,1)"));
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
      screen.queryByRole("button", { name: "采矿机 MIN (1,1)" }),
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
    screen.getByText(/左键建造 \/ 右键旋转 \/ E 键切换尺寸 \/ Esc 退出/),
  ).toBeInTheDocument();
  expect(document.querySelector(".drag-ghost")).toHaveTextContent(
    "当前尺寸：2×2",
  );
  expect(document.querySelector(".drag-ghost")).toHaveTextContent(
    "E 键切换尺寸",
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
});
