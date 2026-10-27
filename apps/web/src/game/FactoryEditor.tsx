import GameSelect from "./GameSelect";
import {
  occupancy,
  footprintSize,
  containsCell,
  supportsLargeSize,
} from "./footprint";
import { batchMoveIssue, rectangleSelection } from "./batchSelection";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  type BuildingDefinition,
  type BuildingInstance,
  type BuildingPlacement,
  type Catalog,
  type FactoryDetail,
} from "../api/client";
import DefinitionIcon from "./DefinitionIcon";
import type { EditorCommands } from "./local/runtime";
import type { RobotRoute } from "./local/robotNavigation";
import type { DistrictSummary } from "./local/world";
import BuildingVisual from "./BuildingVisual";
import MachineNameLayer from "./MachineNameLayer";
import ConveyorItemsLayer from "./ConveyorItemsLayer";
import UndergroundVisual from "./UndergroundVisual";
import {
  undergroundType,
  isUnderground,
  undergroundPeer,
  undergroundSpan,
  undergroundMoveIssue,
} from "./local/underground";
import { entityColor } from "./entityTheme";
import { MachineProgress } from "./SimulationAnimation";
import {
  cellAtPoint,
  centeredCamera,
  GRID_INSET,
  nextRotation,
  placementIssue,
  TILE_SIZE,
  zoomAt,
  type Camera,
  type Cell,
} from "./editorGeometry";

type Props = {
  districts?: DistrictSummary[];
  onSelectDistrict?: (id: string) => void;
  districtSwitchDisabled?: boolean;
  selectedRobotID?: string | null;
  onSelectRobot?: (id: string) => void;
  robotRoute?: RobotRoute;
  robotFocus?: RobotFocus;
  commands: EditorCommands;
  factory: FactoryDetail;
  catalog: Catalog;
  selectedID: string | null;
  placementType: string | null;
  placementSize?: 1 | 2;
  onExitPlacement: () => void;
  onSelect: (building: BuildingInstance | null) => void;
  onChange: (factory: FactoryDetail, selectedID: string | null) => void;
  onError: (error: unknown) => void;
};
export type RobotFocus = {
  factory_id: string;
  x: number;
  y: number;
  sequence: number;
};
type Pointer = { clientX: number; clientY: number; cell: Cell | null };
type Preview = Pointer & {
  groupIDs?: string[];
  size: 1 | 2;
  definition: BuildingDefinition;
  instanceID?: string;
  rotation: BuildingPlacement["rotation"];
};
type Drag = Preview & {
  offset: Cell;
  pointerID: number;
  active: boolean;
  capture: HTMLElement;
};
type Pan = {
  pointerID: number;
  startX: number;
  startY: number;
  camera: Camera;
  active: boolean;
  capture: HTMLElement;
};
type Menu = { id: string; x: number; y: number };
type Marquee = {
  pointerID: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  capture: HTMLElement;
};

export default function FactoryEditor(props: Props) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const viewport = useRef<HTMLDivElement>(null),
    menuRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1.25 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1.25 });
  const drag = useRef<Drag | null>(null),
    pan = useRef<Pan | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const [selectionBox, setSelectionBox] = useState<
    (Marquee & { left: number; top: number }) | null
  >(null);
  const batchRef = useRef<string[]>([]);
  const [batchIDs, setBatchIDs] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const deleteModeRef = useRef(false);
  useLayoutEffect(() => {
    batchRef.current = batchIDs;
    deleteModeRef.current = deleteMode;
  }, [batchIDs, deleteMode]);
  function setBatch(ids: string[]) {
    batchRef.current = ids;
    setBatchIDs(ids);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lock = useRef(false),
    mounted = useRef(false),
    suppressClick = useRef(false),
    contextBlocked = useRef(false),
    rightChord = useRef(false);
  const [dragPreview, setDragPreview] = useState<Preview | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [cellSelection, setCellSelection] = useState<Cell | null>(null);
  const [saving, setSaving] = useState(false),
    [panning, setPanning] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [orientation, setOrientation] = useState<{
    type: string | null;
    rotation: BuildingPlacement["rotation"];
  }>({ type: null, rotation: 0 });
  const [undergroundEntry, setUndergroundEntry] = useState<Cell | null>(null);
  const [undergroundContext, setUndergroundContext] = useState({
    factoryID: props.factory.id,
    type: props.placementType,
  });
  const { factory, catalog, selectedID, placementType } = props;
  const placementDefinition = catalog.buildings.find(
    (d) => d.id === placementType && !d.fixed && d.id !== "bus",
  );
  const rotation =
    orientation.type === placementType ? orientation.rotation : 0;
  const selected = factory.buildings.find((b) => b.id === selectedID);
  const warehouse = factory.buildings.find((b) => b.building_type === "bus");
  const selectedPeer =
    selected && isUnderground(selected)
      ? undergroundPeer(selected, factory.buildings)
      : undefined;
  const placingUnderground = placementType === undergroundType;
  if (
    undergroundContext.factoryID !== factory.id ||
    undergroundContext.type !== placementType
  ) {
    if (undergroundContext.factoryID !== factory.id || placementType)
      setDeleteMode(false);
    setUndergroundContext({ factoryID: factory.id, type: placementType });
    setUndergroundEntry(null);
    setBatchIDs([]);
  }
  const isFixed = (b: BuildingInstance) =>
    b.building_type === "bus" ||
    Boolean(catalog.buildings.find((d) => d.id === b.building_type)?.fixed);
  const isTerminal = (b: BuildingInstance) =>
    ["warehouse_pickup", "warehouse_intake"].includes(b.building_type);
  const fixed = selected ? isFixed(selected) : false;
  const preview: Preview | null =
    dragPreview ??
    (placementDefinition && pointer?.cell
      ? {
          ...pointer,
          definition: placementDefinition,
          rotation,
          size: props.placementSize ?? 1,
        }
      : null);

  function moveCamera(next: Camera) {
    cameraRef.current = next;
    setCamera(next);
  }
  function center(fit = false) {
    const area = viewport.current;
    if (!area) return;
    const rect = area.getBoundingClientRect(),
      f = latest.current.factory;
    moveCamera(centeredCamera(rect.width, rect.height, f.width, f.height, fit));
    setPointer(null);
    setMenu(null);
  }
  function hit(clientX: number, clientY: number): Cell | null {
    const area = viewport.current;
    if (!area) return null;
    const rect = area.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    )
      return null;
    const c = cameraRef.current,
      f = latest.current.factory;
    return cellAtPoint(
      rect.left + c.x + GRID_INSET * c.zoom,
      rect.top + c.y + GRID_INSET * c.zoom,
      TILE_SIZE * c.zoom,
      f.width,
      f.height,
      clientX,
      clientY,
    );
  }
  function show(p: Drag) {
    setDragPreview({ ...p });
  }
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    contextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function suppressNextClick() {
    suppressClick.current = true;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      suppressClick.current = false;
    }, 500);
  }
  function blockContext() {
    contextBlocked.current = true;
    if (contextTimer.current) clearTimeout(contextTimer.current);
    contextTimer.current = setTimeout(() => {
      contextBlocked.current = false;
    }, 800);
  }
  function cancel() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const pending = drag.current ?? pan.current ?? marquee.current;
    drag.current = null;
    pan.current = null;
    marquee.current = null;
    if (pending) {
      if (pending.active && mounted.current) suppressNextClick();
      try {
        pending.capture.releasePointerCapture?.(pending.pointerID);
      } catch {
        /* Capture may have ended already. */
      }
    }
    if (mounted.current) {
      setDragPreview(null);
      setPanning(false);
      setSelectionBox(null);
    }
  }
  function consumeClick() {
    const blocked = suppressClick.current;
    suppressClick.current = false;
    return blocked;
  }
  function begin(
    event: ReactPointerEvent<HTMLElement>,
    definition: BuildingDefinition,
    instance: BuildingInstance,
  ) {
    if (
      event.button !== 0 ||
      latest.current.placementType ||
      deleteModeRef.current ||
      (definition.fixed && instance.building_type !== "bus") ||
      lock.current ||
      marquee.current ||
      drag.current
    )
      return;
    suppressClick.current = false;
    setMenu(null);
    const groupIDs = batchRef.current.includes(instance.id)
      ? [...batchRef.current]
      : undefined;
    if (!groupIDs) setBatch([]);
    props.onSelect(instance);
    const p: Drag = {
      groupIDs,
      definition,
      size: footprintSize(instance),
      offset: (() => {
        const at = hit(event.clientX, event.clientY) ?? instance;
        return { x: at.x - instance.x, y: at.y - instance.y };
      })(),
      instanceID: instance.id,
      rotation: instance.rotation,
      pointerID: event.pointerId,
      active: false,
      capture: event.currentTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      cell: { x: instance.x, y: instance.y },
    };
    drag.current = p;
    try {
      p.capture.setPointerCapture?.(p.pointerID);
    } catch {
      /* Window events provide fallback. */
    }
    timer.current = setTimeout(() => {
      if (drag.current !== p || lock.current) return;
      p.active = true;
      show(p);
    }, 50);
  }
  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (deleteModeRef.current && event.button === 2) {
      event.preventDefault();
      exitDeletion();
      blockContext();
      return;
    }
    if (
      event.button === 2 &&
      !latest.current.placementType &&
      !drag.current &&
      !pan.current &&
      !lock.current
    ) {
      event.preventDefault();
      contextBlocked.current = false;
      setMenu(null);
      marquee.current = {
        pointerID: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        capture: event.currentTarget,
      };
      return;
    }
    if (
      event.button !== 0 ||
      drag.current ||
      marquee.current ||
      pan.current ||
      (event.target instanceof Element && event.target.closest(".occupied"))
    )
      return;
    suppressClick.current = false;
    setMenu(null);
    setCellSelection(null);
    pan.current = {
      pointerID: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera: cameraRef.current,
      active: false,
      capture: event.currentTarget,
    };
  }
  function boxCell(x: number, y: number): Cell {
    const rect = viewport.current!.getBoundingClientRect(),
      c = cameraRef.current,
      f = latest.current.factory;
    return {
      x:
        Math.floor(
          (x - rect.left - c.x) / (TILE_SIZE * c.zoom) - GRID_INSET / TILE_SIZE,
        ) - Math.floor(f.width / 2),
      y:
        Math.floor(f.height / 2) -
        Math.floor(
          (y - rect.top - c.y) / (TILE_SIZE * c.zoom) - GRID_INSET / TILE_SIZE,
        ),
    };
  }
  function updateBox(event: PointerEvent) {
    const box = marquee.current;
    if (!box || box.pointerID !== event.pointerId) return false;
    box.x = event.clientX;
    box.y = event.clientY;
    if (Math.hypot(box.x - box.startX, box.y - box.startY) >= 4)
      box.active = true;
    if (box.active) {
      try {
        box.capture.setPointerCapture?.(box.pointerID);
      } catch {
        /* Window fallback. */
      }
      setMenu(null);
      blockContext();
      const rect = box.capture.getBoundingClientRect();
      setSelectionBox({ ...box, left: rect.left, top: rect.top });
    }
    return true;
  }
  function finishBox(clientX: number, clientY: number) {
    const box = marquee.current;
    if (!box) return;
    if (box.active) {
      const { factory: f, catalog: c } = latest.current;
      setBatch(
        rectangleSelection(
          f,
          c.buildings,
          boxCell(box.startX, box.startY),
          boxCell(clientX, clientY),
        ),
      );
      latest.current.onSelect(null);
      setCellSelection(null);
      setMenu(null);
      blockContext();
    }
    cancel();
  }
  async function commit(
    action: () => Promise<FactoryDetail>,
    selection: (f: FactoryDetail) => string | null,
  ) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setMenu(null);
    try {
      const result = await action();
      if (mounted.current) {
        latest.current.onChange(result, selection(result));
        setCellSelection(null);
      }
    } catch (error) {
      if (mounted.current) latest.current.onError(error);
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function finish(clientX: number, clientY: number) {
    const p = drag.current;
    if (!p?.active) {
      cancel();
      return;
    }
    const cellHit = hit(clientX, clientY);
    p.cell = cellHit && {
      x: cellHit.x - p.offset.x,
      y: cellHit.y - p.offset.y,
    };
    const f = latest.current.factory,
      originalEnd = f.buildings.find((b) => b.id === p.instanceID),
      issue = p.groupIDs
        ? batchMoveIssue(
            f,
            p.groupIDs,
            p.cell && originalEnd
              ? { x: p.cell.x - originalEnd.x, y: p.cell.y - originalEnd.y }
              : null,
          )
        : (placementIssue(f, p.cell, p.instanceID, p.definition.id, p.size) ??
          (originalEnd && p.cell
            ? undergroundMoveIssue(
                originalEnd,
                { ...p.cell, rotation: p.rotation },
                f.buildings,
              )
            : null));
    cancel();
    if (issue) {
      latest.current.onError(new Error(issue));
      return;
    }
    const cell = p.cell!,
      original = f.buildings.find((b) => b.id === p.instanceID);
    if (p.groupIDs && original) {
      const dx = cell.x - original.x,
        dy = cell.y - original.y;
      if (!dx && !dy) return;
      void commit(
        () => {
          if (!latest.current.commands.moveBuildings)
            throw new Error("批量移动命令不可用");
          return latest.current.commands.moveBuildings(
            f.id,
            p.groupIDs!,
            dx,
            dy,
          );
        },
        () => null,
      );
      return;
    }
    if (
      original?.x === cell.x &&
      original.y === cell.y &&
      original.rotation === p.rotation
    )
      return;
    void commit(
      () =>
        latest.current.commands.updateBuilding(f.id, p.instanceID!, {
          ...cell,
          rotation: p.rotation,
          ...(p.size === 2 ? { size: p.size } : {}),
        }),
      () => p.instanceID!,
    );
  }
  function rotateDrag() {
    const p = drag.current;
    if (!p) return;
    if (p.groupIDs) return;
    if (p.definition.id === "bus") return;
    if (p.definition.id === undergroundType) {
      latest.current.onError(
        new Error("已安装地下端口须保持共同朝向；更换方向请回收整对后重建"),
      );
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    p.active = true;
    p.rotation = nextRotation(p.rotation);
    show(p);
    blockContext();
  }
  function rotatePlacement() {
    const type = latest.current.placementType;
    if (!type) return;
    setOrientation((previous) => ({
      type,
      rotation: nextRotation(previous.type === type ? previous.rotation : 0),
    }));
  }
  function rotateSelected() {
    if (batchRef.current.length) return;
    const f = latest.current.factory,
      b = f.buildings.find((b) => b.id === latest.current.selectedID);
    if (!b || isFixed(b) || lock.current) return;
    if (isUnderground(b)) {
      latest.current.onError(
        new Error("已安装地下端口须保持共同朝向；更换方向请回收整对后重建"),
      );
      return;
    }
    void commit(
      () =>
        latest.current.commands.updateBuilding(f.id, b.id, {
          x: b.x,
          y: b.y,
          rotation: nextRotation(b.rotation),
        }),
      () => b.id,
    );
  }
  function remove(id = latest.current.selectedID) {
    if (batchRef.current.length && !lock.current) {
      const ids = [...batchRef.current];
      void commit(
        async () => {
          if (!latest.current.commands.deleteBuildings)
            throw new Error("批量删除命令不可用");
          const result = await latest.current.commands.deleteBuildings(
            latest.current.factory.id,
            ids,
          );
          if (mounted.current) setBatch([]);
          return result;
        },
        () => null,
      );
      return;
    }
    const f = latest.current.factory,
      b = f.buildings.find((b) => b.id === id);
    if (!b || isFixed(b) || isTerminal(b) || lock.current) return;
    void commit(
      () => latest.current.commands.deleteBuilding(f.id, b.id),
      () => null,
    );
  }
  function exitDeletion() {
    deleteModeRef.current = false;
    setDeleteMode(false);
    setMenu(null);
    setPointer(null);
    cancel();
  }
  function deleteShortcut() {
    if (
      lock.current ||
      drag.current ||
      pan.current ||
      marquee.current ||
      deleteModeRef.current
    )
      return;
    const f = latest.current.factory;
    if (
      batchRef.current.length ||
      f.buildings.some((b) => b.id === latest.current.selectedID)
    ) {
      remove();
      return;
    }
    cancel();
    suppressClick.current = false;
    setMenu(null);
    setCellSelection(null);
    setUndergroundEntry(null);
    latest.current.onExitPlacement();
    latest.current.onSelect(null);
    deleteModeRef.current = true;
    setDeleteMode(true);
  }
  function deletionIssue(b: BuildingInstance) {
    if (isFixed(b) || isTerminal(b)) return "该设施不可删除";
    if (
      factory.robots?.some(
        (r) => r.home_factory_id === factory.id && r.home_station === b.id,
      )
    )
      return "该补能站仍绑定机器人，请先召回后再删除";
    return null;
  }
  function clickCell(cell: Cell, instance?: BuildingInstance) {
    if (consumeClick() || lock.current) return;
    setMenu(null);
    if (deleteModeRef.current) {
      if (instance) {
        const issue = deletionIssue(instance);
        if (issue) props.onError(new Error(issue));
        else remove(instance.id);
      }
      return;
    }
    if (placementDefinition) {
      const issue = placementIssue(
        latest.current.factory,
        cell,
        undefined,
        placementDefinition.id,
        props.placementSize ?? 1,
      );
      if (issue) {
        props.onError(new Error(issue));
        return;
      }
      const f = latest.current.factory;
      if (placingUnderground) {
        if (!undergroundEntry) {
          setUndergroundEntry(cell);
          return;
        }
        const entry = { ...undergroundEntry, rotation },
          exit = { ...cell, rotation };
        if (!undergroundSpan(entry, exit)) {
          props.onError(
            new Error("出口必须在入口正前方的直线上，距离为 1～8 格"),
          );
          return;
        }
        const entranceIssue = placementIssue(
          f,
          undergroundEntry,
          undefined,
          undergroundType,
        );
        if (entranceIssue) {
          props.onError(new Error(entranceIssue));
          return;
        }
        void commit(
          async () => {
            if (!latest.current.commands.placeUnderground)
              throw new Error("地下端口建造命令不可用");
            const result = await latest.current.commands.placeUnderground(
              f.id,
              entry,
              exit,
            );
            setUndergroundEntry(null);
            return result;
          },
          (snapshot) =>
            snapshot.buildings.find((b) => b.x === cell.x && b.y === cell.y)
              ?.id ?? null,
        );
        return;
      }
      void commit(
        () =>
          latest.current.commands.placeBuilding(f.id, placementDefinition.id, {
            ...cell,
            ...(props.placementSize === 2 ? { size: props.placementSize } : {}),
            rotation,
          }),
        (snapshot) =>
          snapshot.buildings.find((b) => b.x === cell.x && b.y === cell.y)
            ?.id ?? null,
      );
    } else {
      if (instance && batchRef.current.includes(instance.id)) return;
      setBatch([]);
      const robot = latest.current.factory.robots?.find(
        (r) =>
          (!r.transit &&
            r.factory_id === factory.id &&
            r.x === cell.x &&
            r.y === cell.y) ||
          (!r.returning &&
            r.construction?.factory_id === factory.id &&
            containsCell(r.construction, cell)),
      );
      if (robot && props.onSelectRobot) {
        props.onSelectRobot(robot.id);
        setCellSelection(null);
        return;
      }
      props.onSelect(instance ?? null);
      setCellSelection(instance ? null : cell);
    }
  }
  function openMenu(event: React.MouseEvent, instance: BuildingInstance) {
    event.preventDefault();
    event.stopPropagation();
    if (deleteModeRef.current) {
      exitDeletion();
      blockContext();
      return;
    }
    if (drag.current || rightChord.current || contextBlocked.current) return;
    if (latest.current.placementType) {
      rotatePlacement();
      return;
    }
    if (pan.current?.active || lock.current) return;
    if (!batchRef.current.includes(instance.id)) setBatch([]);
    props.onSelect(instance);
    setMenu({
      id: instance.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 116)),
    });
  }
  function reloadFactory() {
    const { factory: f, selectedID: id } = latest.current;
    void commit(
      () => latest.current.commands.getFactory(f.id, AbortSignal.timeout(8000)),
      (snapshot) => (snapshot.buildings.some((b) => b.id === id) ? id : null),
    );
  }
  const actions = useRef({
    finish,
    rotateDrag,
    rotateSelected,
    rotatePlacement,
    remove,
    center,
    hit,
    cancel,
    updateBox,
    finishBox,
    deleteShortcut,
  });
  useLayoutEffect(() => {
    actions.current = {
      finish,
      rotateDrag,
      rotateSelected,
      rotatePlacement,
      remove,
      center,
      hit,
      cancel,
      updateBox,
      finishBox,
      deleteShortcut,
    };
  });
  useEffect(() => {
    mounted.current = true;
    actions.current.center();
    const initialBounds = viewport.current!.getBoundingClientRect();
    let viewWidth = initialBounds.width,
      viewHeight = initialBounds.height;
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const bounds = viewport.current?.getBoundingClientRect();
            if (!bounds?.width || !bounds.height) return;
            const dx = bounds.width - viewWidth,
              dy = bounds.height - viewHeight;
            viewWidth = bounds.width;
            viewHeight = bounds.height;
            if (!dx && !dy) return;
            // Keep the same world point at the viewport centre when HUD panels fold.
            actions.current.cancel();
            const previous = cameraRef.current;
            moveCamera({
              ...previous,
              x: previous.x + dx / 2,
              y: previous.y + dy / 2,
            });
            setPointer(null);
            setMenu(null);
          });
    resize?.observe(viewport.current!);
    const move = (event: PointerEvent) => {
      if (actions.current.updateBox(event)) {
        if (event.pointerType === "mouse" && (event.buttons & 2) === 0)
          actions.current.finishBox(event.clientX, event.clientY);
        return;
      }
      const p = drag.current,
        view = pan.current;
      if (p?.pointerID === event.pointerId) {
        p.clientX = event.clientX;
        p.clientY = event.clientY;
        const at = actions.current.hit(event.clientX, event.clientY);
        p.cell = at && { x: at.x - p.offset.x, y: at.y - p.offset.y };
        if (p.active) show(p);
        if (event.pointerType === "mouse" && (event.buttons & 1) === 0)
          actions.current.finish(event.clientX, event.clientY);
      } else if (view?.pointerID === event.pointerId) {
        const dx = event.clientX - view.startX,
          dy = event.clientY - view.startY;
        if (Math.hypot(dx, dy) >= 4) view.active = true;
        if (view.active) {
          try {
            view.capture.setPointerCapture?.(view.pointerID);
          } catch {
            /* Window events provide fallback. */
          }
          moveCamera({
            ...view.camera,
            x: view.camera.x + dx,
            y: view.camera.y + dy,
          });
          setPanning(true);
          setPointer(null);
        }
        if (event.pointerType === "mouse" && (event.buttons & 1) === 0)
          actions.current.cancel();
      }
    };
    const up = (event: PointerEvent) => {
      if (
        event.button === 2 &&
        marquee.current?.pointerID === event.pointerId
      ) {
        actions.current.finishBox(event.clientX, event.clientY);
        return;
      }
      if (event.button !== 0) return;
      if (drag.current?.pointerID === event.pointerId)
        actions.current.finish(event.clientX, event.clientY);
      else if (pan.current?.pointerID === event.pointerId)
        actions.current.cancel();
    };
    const down = (event: MouseEvent) => {
      if (event.button === 2 && drag.current) {
        rightChord.current = true;
        event.preventDefault();
        actions.current.rotateDrag();
      }
    };
    const mouseUp = (event: MouseEvent) => {
      if (event.button === 2 && marquee.current)
        actions.current.finishBox(event.clientX, event.clientY);
      if (event.button === 2 && rightChord.current) {
        rightChord.current = false;
        blockContext();
      }
      if (event.button === 0 && drag.current)
        actions.current.finish(event.clientX, event.clientY);
      else if (event.button === 0 && pan.current) actions.current.cancel();
    };
    const context = (event: MouseEvent) => {
      if (drag.current || rightChord.current || contextBlocked.current)
        event.preventDefault();
    };
    const lost = (event: PointerEvent) => {
      if (
        drag.current?.pointerID === event.pointerId ||
        pan.current?.pointerID === event.pointerId ||
        marquee.current?.pointerID === event.pointerId
      ) {
        rightChord.current = false;
        actions.current.cancel();
      }
    };
    const blur = () => {
      rightChord.current = false;
      actions.current.cancel();
      setPointer(null);
      setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input,textarea,select,[role="combobox"],[data-game-select-popup],[contenteditable="true"]',
          ))
      )
        return;
      if (event.key === "Escape") {
        deleteModeRef.current = false;
        setDeleteMode(false);
        setUndergroundEntry(null);
        batchRef.current = [];
        setBatchIDs([]);
        actions.current.cancel();
        setMenu(null);
        setPointer(null);
        latest.current.onExitPlacement();
        event.preventDefault();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (drag.current) actions.current.rotateDrag();
        else if (latest.current.placementType)
          actions.current.rotatePlacement();
        else actions.current.rotateSelected();
      } else if (
        (event.key === "Delete" || event.key.toLowerCase() === "d") &&
        !drag.current &&
        !pan.current &&
        !marquee.current
      ) {
        event.preventDefault();
        actions.current.deleteShortcut();
      } else if (
        event.key === "Backspace" &&
        !deleteModeRef.current &&
        !drag.current &&
        !marquee.current &&
        !latest.current.placementType
      ) {
        event.preventDefault();
        actions.current.remove();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current || marquee.current) return;
      const rect = viewport.current!.getBoundingClientRect(),
        c = cameraRef.current;
      const pixels =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      const next = zoomAt(
        c,
        event.clientX - rect.left,
        event.clientY - rect.top,
        c.zoom * Math.exp(-pixels * 0.0015),
      );
      moveCamera(next);
      const view = pan.current;
      if (view) {
        // Continue dragging from the zoomed view instead of restoring the
        // camera recorded at pointerdown on the next pointermove.
        view.camera = next;
        view.startX = event.clientX;
        view.startY = event.clientY;
        view.active = true;
        setPanning(true);
        setPointer(null);
      } else {
        setPointer({
          clientX: event.clientX,
          clientY: event.clientY,
          cell: actions.current.hit(event.clientX, event.clientY),
        });
      }
      setMenu(null);
    };
    const area = viewport.current!;
    area.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", mouseUp, true);
    window.addEventListener("pointercancel", lost);
    window.addEventListener("lostpointercapture", lost);
    window.addEventListener("contextmenu", context);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    return () => {
      mounted.current = false;
      resize?.disconnect();
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (contextTimer.current) clearTimeout(contextTimer.current);
      actions.current.cancel();
      area.removeEventListener("wheel", wheel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mouseup", mouseUp, true);
      window.removeEventListener("pointercancel", lost);
      window.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("contextmenu", context);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
    };
  }, [factory.id]);
  useLayoutEffect(() => {
    const focus = props.robotFocus,
      area = viewport.current;
    if (!focus || !area || focus.factory_id !== factory.id) return;
    const rect = area.getBoundingClientRect(),
      zoom = cameraRef.current.zoom;
    moveCamera({
      zoom,
      x:
        rect.width / 2 -
        (GRID_INSET + (focus.x + factory.width / 2) * TILE_SIZE) * zoom,
      y:
        rect.height / 2 -
        (GRID_INSET + (factory.height / 2 - focus.y) * TILE_SIZE) * zoom,
    });
  }, [props.robotFocus, factory.id, factory.width, factory.height]);
  useEffect(() => {
    if (menu)
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);

  const groupOrigin = factory.buildings.find(
    (b) => b.id === preview?.instanceID,
  );
  const groupDelta =
    preview?.cell && groupOrigin
      ? { x: preview.cell.x - groupOrigin.x, y: preview.cell.y - groupOrigin.y }
      : null;
  const groupPreview =
    preview?.groupIDs && groupDelta
      ? factory.buildings
          .filter((b) => preview.groupIDs!.includes(b.id))
          .map((b) => ({ ...b, x: b.x + groupDelta.x, y: b.y + groupDelta.y }))
      : [];
  const groupTargets = occupancy(groupPreview);
  const issue = preview?.groupIDs
    ? batchMoveIssue(factory, preview.groupIDs, groupDelta)
    : preview
      ? (placementIssue(
          factory,
          preview.cell,
          preview.instanceID,
          preview.definition.id,
          preview.size,
        ) ??
        (preview.cell && preview.instanceID
          ? (() => {
              const b = factory.buildings.find(
                (b) => b.id === preview.instanceID,
              );
              return b
                ? undergroundMoveIssue(
                    b,
                    { ...preview.cell!, rotation: preview.rotation },
                    factory.buildings,
                  )
                : null;
            })()
          : placingUnderground &&
              undergroundEntry &&
              preview.cell &&
              !undergroundSpan(
                { ...undergroundEntry, rotation },
                { ...preview.cell, rotation },
              )
            ? "出口须位于入口正前方 1～8 格"
            : null))
      : null;
  const buildings = useMemo(
    () => occupancy(factory.buildings),
    [factory.buildings],
  );
  const buildingDefinitions = useMemo(
    () => new Map(catalog.buildings.map((d) => [d.id, d])),
    [catalog.buildings],
  );
  const robots = useMemo(
    () =>
      new Map(
        (factory.robots ?? [])
          .filter((r) => !r.transit && r.factory_id === factory.id)
          .map((r) => [`${r.x},${r.y}`, r]),
      ),
    [factory.robots, factory.id],
  );
  const menuBuilding = factory.buildings.find((b) => b.id === menu?.id);
  const blueprints = useMemo(
    () =>
      new Map(
        (factory.robots ?? [])
          .filter(
            (r) => !r.returning && r.construction?.factory_id === factory.id,
          )
          .flatMap((r) => [...occupancy([r.construction!])]),
      ),
    [factory.robots, factory.id],
  );
  const deletionTarget =
    deleteMode && pointer?.cell
      ? buildings.get(`${pointer.cell.x},${pointer.cell.y}`)
      : undefined;
  const deletionPeer =
    deletionTarget && isUnderground(deletionTarget)
      ? undergroundPeer(deletionTarget, factory.buildings)
      : undefined;
  const targetDeletionIssue = deletionTarget
    ? deletionIssue(deletionTarget)
    : null;
  return (
    <>
      <div className="editor-controls" aria-label="建筑编辑工具">
        <button
          onClick={() => {
            exitDeletion();
            setMenu(null);
            props.onExitPlacement();
            props.onSelect(null);
            setCellSelection(null);
            setBatch([]);
          }}
          disabled={saving}
        >
          选择 / 取消
        </button>
        <button
          onClick={placementDefinition ? rotatePlacement : rotateSelected}
          disabled={
            saving ||
            deleteMode ||
            batchIDs.length > 0 ||
            (!placementDefinition &&
              (!selected || fixed || isUnderground(selected))) ||
            Boolean(dragPreview)
          }
        >
          ↻ {placementDefinition ? "旋转预览" : "旋转建筑"} <kbd>R</kbd>
        </button>
        <button
          className="delete-building"
          onClick={() => (deleteMode ? exitDeletion() : deleteShortcut())}
          aria-pressed={deleteMode}
          disabled={
            saving ||
            (!deleteMode &&
              !batchIDs.length &&
              !!selected &&
              (fixed || isTerminal(selected))) ||
            Boolean(preview) ||
            Boolean(selectionBox)
          }
        >
          {deleteMode
            ? "退出删除模式"
            : batchIDs.length
              ? `删除选中 ${batchIDs.length} 个建筑`
              : selected && isUnderground(selected)
                ? "回收整对"
                : selected
                  ? "删除建筑"
                  : "连续删除"}{" "}
          <kbd>D / Del</kbd>
        </button>
        <button
          onClick={reloadFactory}
          disabled={saving || Boolean(dragPreview)}
        >
          重绘布局
        </button>
        <span>
          {deleteMode
            ? "连续删除模式 · 左键点击建筑立即回收 · 右键 / Esc 退出"
            : batchIDs.length
              ? `已框选 ${batchIDs.length} 个建筑 · 左键拖动整组 · D / Del / 右键删除 · Esc 取消${dragPreview ? " · 松开左键确认" : ""}`
              : dragPreview
                ? dragPreview.definition.id === "bus"
                  ? "移动工厂仓库 · 方向固定 · 松开左键确认"
                  : dragPreview.definition.id === undergroundType
                    ? "沿原直线移动端口 · 保持 1～8 格 · 松开左键确认"
                    : "移动建筑 · 右键旋转 · 松开左键确认"
                : placementDefinition
                  ? placingUnderground
                    ? undergroundEntry
                      ? "入口已标记 · 点击正前方 1～8 格设置出口 · Esc 取消"
                      : "地下传送带：先点击入口 · R / 右键选择方向 · 完成配对才消耗 1 套"
                    : `连续放置 ${placementDefinition.name} · ${props.placementSize ?? 1}×${props.placementSize ?? 1} · ${rotation}° · 左键建造 / 右键旋转${supportsLargeSize(placementDefinition) ? " / E 键切换尺寸" : ""} / Esc 退出`
                  : selected
                    ? selected.building_type === "bus"
                      ? "工厂仓库可长按移动 · 方向固定 · 不可删除"
                      : fixed
                        ? "固定设施，无法编辑"
                        : `已选中 ${selected.building_type} (${selected.x}, ${selected.y}) · 右键打开菜单`
                    : "D / Del 连续删除 · 右键拖动框选 · 长按建筑移动 · 拖动空格平移"}
        </span>
      </div>
      <div className="map-caption">
        <span>
          <span className="small-square" />
          产线现场 / LIVE FLOOR
        </span>
        <span className="map-caption-actions">
          <span>X → / Y ↑</span>
          {props.onSelectDistrict && (
            <GameSelect
              catalog={catalog}
              aria-label="快捷切换厂区"
              value={factory.id}
              disabled={
                props.districtSwitchDisabled ||
                saving ||
                !!dragPreview ||
                !!selectionBox ||
                panning
              }
              onValueChange={(choiceValue) =>
                props.onSelectDistrict?.(choiceValue)
              }
            >
              {(props.districts?.length
                ? props.districts
                : [{ id: factory.id, name: factory.name }]
              ).map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name}
                </option>
              ))}
            </GameSelect>
          )}
        </span>
      </div>
      <div className="camera-controls" aria-label="地图视图工具">
        <span aria-label="当前缩放">{Math.round(camera.zoom * 100)}%</span>
        <button
          onClick={() => center(true)}
          disabled={Boolean(dragPreview) || panning || !!selectionBox}
        >
          适应地图
        </button>
        <button
          onClick={() => center()}
          disabled={Boolean(dragPreview) || panning || !!selectionBox}
        >
          居中放大
        </button>
        <small>滚轮缩放 · 拖动空格平移</small>
      </div>
      <div
        className={`map-viewport ${deleteMode ? "is-deleting" : ""} ${dragPreview || panning ? "is-dragging" : ""} ${placementDefinition ? "is-placing" : ""}`}
        ref={viewport}
        tabIndex={0}
        aria-label="工厂地图，可滚轮缩放和拖动空格平移"
        onPointerDown={beginPan}
        onPointerMove={(event) => {
          if (!drag.current && !pan.current?.active)
            setPointer({
              clientX: event.clientX,
              clientY: event.clientY,
              cell: hit(event.clientX, event.clientY),
            });
        }}
        onPointerLeave={() => setPointer(null)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (deleteModeRef.current) {
            exitDeletion();
            blockContext();
            return;
          }
          if (drag.current || rightChord.current || contextBlocked.current)
            return;
          if (placementDefinition) rotatePlacement();
          else if (batchRef.current.length) {
            setMenu({
              id: batchRef.current[0],
              x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
              y: Math.max(8, Math.min(event.clientY, window.innerHeight - 116)),
            });
          } else setMenu(null);
        }}
      >
        <div
          className={`factory-map ${camera.zoom < 1 ? "is-zoomed-out" : ""}`}
          style={
            {
              "--grid-width": factory.width,
              "--grid-height": factory.height,
              "--map-zoom": camera.zoom,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            } as CSSProperties
          }
        >
          <div className="axis-corner">Y/X</div>
          <div className="x-axis">
            {Array.from(
              { length: factory.width },
              (_, i) => i - Math.floor(factory.width / 2),
            ).map((x) => (
              <span
                key={x}
                className={`${x === 0 ? "axis-origin" : ""} ${x % 5 === 0 ? "axis-major" : "axis-minor"}`}
              >
                {x}
              </span>
            ))}
          </div>
          <div className="y-axis">
            {Array.from(
              { length: factory.height },
              (_, i) => Math.floor(factory.height / 2) - i,
            ).map((y) => (
              <span
                key={y}
                className={`${y === 0 ? "axis-origin" : ""} ${y % 5 === 0 ? "axis-major" : "axis-minor"}`}
              >
                {y}
              </span>
            ))}
          </div>
          <div
            className="factory-grid"
            role="group"
            aria-label={`${factory.width} × ${factory.height} 工厂地图，X 向右、Y 向上`}
          >
            <ConveyorItemsLayer
              factory={factory}
              catalog={catalog}
              zoom={camera.zoom}
            />
            {groupPreview.map((b) => (
              <span
                key={b.id}
                className="batch-move-preview"
                aria-hidden="true"
                style={{
                  left: (b.x + Math.floor(factory.width / 2)) * TILE_SIZE,
                  top: (Math.floor(factory.height / 2) - b.y) * TILE_SIZE,
                  width: TILE_SIZE * footprintSize(b),
                  height: TILE_SIZE * footprintSize(b),
                }}
              >
                <BuildingVisual
                  definition={buildingDefinitions.get(b.building_type)!}
                  x={b.x}
                  y={b.y}
                  rotation={b.rotation}
                  buildings={groupTargets}
                  instanceID={b.id}
                  undergroundExit={b.configuration.underground_role === "exit"}
                />
              </span>
            ))}
            {((undergroundEntry && placingUnderground) || selectedPeer) && (
              <svg
                className="underground-link-layer"
                viewBox="0 0 630 630"
                aria-hidden="true"
              >
                <line
                  x1={((undergroundEntry?.x ?? selected!.x) + 10.5) * TILE_SIZE}
                  y1={(10.5 - (undergroundEntry?.y ?? selected!.y)) * TILE_SIZE}
                  x2={
                    ((undergroundEntry
                      ? (pointer?.cell?.x ?? undergroundEntry.x)
                      : selectedPeer!.x) +
                      10.5) *
                    TILE_SIZE
                  }
                  y2={
                    (10.5 -
                      (undergroundEntry
                        ? (pointer?.cell?.y ?? undergroundEntry.y)
                        : selectedPeer!.y)) *
                    TILE_SIZE
                  }
                  stroke={undergroundEntry && issue ? "#ff6179" : "#a5d4b2"}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              </svg>
            )}
            {props.robotRoute?.factory_id === factory.id &&
              props.robotRoute.points.length > 1 && (
                <svg
                  className="robot-route-layer"
                  viewBox="0 0 630 630"
                  aria-label="机器人当前路段预览"
                >
                  <polyline
                    points={props.robotRoute.points
                      .map(
                        (p) =>
                          `${(p.x + 10.5) * TILE_SIZE},${(10.5 - p.y) * TILE_SIZE}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="5 4"
                  />
                </svg>
              )}
            {Array.from(
              { length: factory.width * factory.height },
              (_, index) => {
                const x =
                    (index % factory.width) - Math.floor(factory.width / 2),
                  y =
                    Math.floor(factory.height / 2) -
                    Math.floor(index / factory.width);
                const instance = buildings.get(`${x},${y}`),
                  d =
                    instance && buildingDefinitions.get(instance.building_type);
                const target = preview?.groupIDs
                    ? groupTargets.has(`${x},${y}`)
                    : preview?.cell &&
                      containsCell(
                        { ...preview.cell, size: preview.size },
                        { x, y },
                      ),
                  anchor = instance?.x === x && instance?.y === y,
                  highlight =
                    anchor &&
                    (instance?.id === selectedID ||
                      instance?.id === selectedPeer?.id);
                const runtime =
                  instance && factory.simulation?.buildings[instance.id];
                return (
                  <div
                    key={`${x},${y}`}
                    className={`map-tile ${instance && (instance.id === deletionTarget?.id || instance.id === deletionPeer?.id) ? (targetDeletionIssue ? "delete-protected" : "delete-target") : ""} ${instance && batchIDs.includes(instance.id) ? "batch-selected" : ""} ${y === Math.floor(factory.height / 2) ? "waste-edge" : ""} ${x === 0 || y === 0 ? "center-line" : ""} ${instance ? "occupied" : ""} ${highlight ? "selected-building" : ""} ${target ? (issue ? "drop-invalid" : "drop-valid") : ""} ${!preview && pointer?.cell?.x === x && pointer?.cell?.y === y ? "hover-tile" : ""} ${cellSelection?.x === x && cellSelection?.y === y ? "selected-cell" : ""}`}
                    title={`(${x}, ${y})${y === Math.floor(factory.height / 2) ? " · 垃圾堆" : ""}${d ? ` · ${d.name}` : ""}`}
                    data-x={x}
                    data-y={y}
                    style={
                      {
                        "--footprint-size":
                          anchor && instance ? footprintSize(instance) : 1,
                      } as CSSProperties
                    }
                  >
                    {blueprints.has(`${x},${y}`) && (
                      <span
                        className="blueprint-marker"
                        role="img"
                        aria-label={`在建蓝图 ${buildingDefinitions.get(blueprints.get(`${x},${y}`)!.building_type)?.name} (${x},${y})`}
                        title={`在建蓝图 · ${buildingDefinitions.get(blueprints.get(`${x},${y}`)!.building_type)?.name}`}
                      >
                        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                          <path
                            d="M4 4H28V28H4Z"
                            stroke="currentColor"
                            strokeDasharray="4 3"
                            strokeWidth="2"
                          />
                          <path
                            d="M10 22L22 10M16 9L23 16M9 16L16 23"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      </span>
                    )}
                    {robots.has(`${x},${y}`) &&
                      props.onSelectRobot &&
                      !placementDefinition && (
                        <button
                          type="button"
                          className={`robot-marker ${robots.get(`${x},${y}`)!.id === props.selectedRobotID ? "selected-robot" : ""}`}
                          title="选择机器人"
                          aria-label={`选择机器人 ${robots.get(`${x},${y}`)!.id} (${x},${y})`}
                          aria-pressed={
                            robots.get(`${x},${y}`)!.id ===
                            props.selectedRobotID
                          }
                          onPointerDown={(e) => {
                            if (!deleteMode) e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (deleteMode) return;
                            if (!consumeClick()) {
                              setBatch([]);
                              props.onSelectRobot?.(
                                robots.get(`${x},${y}`)!.id,
                              );
                            }
                          }}
                        >
                          <svg
                            viewBox="0 0 32 32"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 9H24V24H8ZM16 9V4M12 15H13M19 15H20M12 20H20M5 13V21M27 13V21M11 24V28M21 24V28"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <circle cx="16" cy="4" r="2" fill="currentColor" />
                          </svg>
                        </button>
                      )}
                    {instance && d ? (
                      <button
                        className="building-art-button"
                        aria-label={`${d.name} ${d.code} (${x},${y})`}
                        aria-pressed={
                          instance.id === selectedID ||
                          batchIDs.includes(instance.id)
                        }
                        tabIndex={anchor ? 0 : -1}
                        disabled={saving}
                        onPointerDown={(event) => begin(event, d, instance)}
                        onClick={(event) =>
                          clickCell(
                            hit(event.clientX, event.clientY) ?? { x, y },
                            instance,
                          )
                        }
                        onContextMenu={(event) => openMenu(event, instance)}
                        style={
                          {
                            "--entity-color": entityColor(d),
                            width: anchor
                              ? TILE_SIZE * footprintSize(instance)
                              : TILE_SIZE,
                            height: anchor
                              ? TILE_SIZE * footprintSize(instance)
                              : TILE_SIZE,
                            zIndex: anchor ? 2 : 0,
                          } as CSSProperties
                        }
                      >
                        {anchor && (
                          <BuildingVisual
                            definition={d}
                            x={x}
                            y={y}
                            rotation={instance.rotation}
                            buildings={buildings}
                            instanceID={instance.id}
                            machine={runtime}
                          />
                        )}
                        {anchor &&
                          (d.category === "machine" || d.role === "source") &&
                          runtime && (
                            <>
                              <span
                                className={`tile-machine-status status-${runtime.status}`}
                                aria-hidden="true"
                              />
                              <MachineProgress
                                key={instance.id}
                                machine={runtime}
                              />
                            </>
                          )}
                      </button>
                    ) : (
                      <button
                        className="empty-tile"
                        aria-label={`空格 (${x},${y})`}
                        disabled={saving}
                        onClick={() => clickCell({ x, y })}
                      >
                        <span className="tile-point" />
                      </button>
                    )}
                    {target &&
                      preview &&
                      !preview.groupIDs &&
                      preview.cell?.x === x &&
                      preview.cell?.y === y && (
                        <span
                          className="tile-preview"
                          style={{
                            width: TILE_SIZE * preview.size,
                            height: TILE_SIZE * preview.size,
                          }}
                          aria-hidden="true"
                        >
                          <BuildingVisual
                            definition={preview.definition}
                            x={x}
                            y={y}
                            rotation={preview.rotation}
                            buildings={buildings}
                            instanceID={preview.instanceID}
                            undergroundExit={
                              preview.definition.id === undergroundType
                                ? preview.instanceID
                                  ? factory.buildings.find(
                                      (b) => b.id === preview.instanceID,
                                    )?.configuration.underground_role === "exit"
                                  : !!undergroundEntry
                                : undefined
                            }
                          />
                        </span>
                      )}
                    {placingUnderground &&
                      undergroundEntry?.x === x &&
                      undergroundEntry.y === y && (
                        <span
                          className="underground-entry-preview"
                          aria-label={`入口预览 (${x},${y})，尚未安装`}
                        >
                          <UndergroundVisual rotation={rotation} />
                        </span>
                      )}
                  </div>
                );
              },
            )}
          </div>
        </div>
        <MachineNameLayer
          factory={
            preview?.groupIDs
              ? {
                  ...factory,
                  buildings: factory.buildings.map(
                    (b) => groupPreview.find((p) => p.id === b.id) ?? b,
                  ),
                }
              : factory
          }
          catalog={catalog}
          camera={camera}
          preview={
            preview && !preview.groupIDs
              ? { ...preview, invalid: Boolean(issue) }
              : undefined
          }
        />
        {selectionBox && (
          <div
            className="batch-selection-box"
            aria-label="建筑框选范围"
            style={{
              left:
                Math.min(selectionBox.startX, selectionBox.x) -
                selectionBox.left,
              top:
                Math.min(selectionBox.startY, selectionBox.y) -
                selectionBox.top,
              width: Math.abs(selectionBox.x - selectionBox.startX),
              height: Math.abs(selectionBox.y - selectionBox.startY),
            }}
          />
        )}
      </div>
      <div className="map-statusbar">
        <span>
          {deleteMode
            ? (targetDeletionIssue ??
              (deletionTarget
                ? `${isUnderground(deletionTarget) ? "点击回收整对地下出入口" : "点击删除建筑"} (${deletionTarget.x},${deletionTarget.y})`
                : "左键点击建筑回收 · 空格和机器人不会删除"))
            : preview
              ? (issue ??
                `放置于 (${preview.cell?.x}, ${preview.cell?.y}) · ${preview.rotation}°`)
              : pointer?.cell
                ? `坐标 (${pointer.cell.x}, ${pointer.cell.y})`
                : warehouse
                  ? `■ 工厂仓库 (${warehouse.x},${warehouse.y}) · 长按移动`
                  : "■ 工厂地图"}
        </span>
        <span>
          {factory.buildings.length} 个建筑实例 /{" "}
          {factory.width * factory.height} 格
        </span>
        <span role="status">
          {saving
            ? "正在保存…"
            : deleteMode
              ? "连续删除 · 右键 / Esc 退出"
              : placementDefinition
                ? "连续放置 · Esc 退出"
                : dragPreview
                  ? "移动预览 · Esc 取消"
                  : "布局已保存在本机"}
        </span>
      </div>
      {preview &&
        createPortal(
          <div
            className={`drag-ghost ${issue ? "invalid" : "valid"}`}
            style={{
              left: Math.max(
                8,
                Math.min(preview.clientX + 14, window.innerWidth - 300),
              ),
              top: Math.max(
                8,
                Math.min(preview.clientY + 14, window.innerHeight - 112),
              ),
            }}
            aria-hidden="true"
          >
            <DefinitionIcon
              definition={preview.definition}
              rotation={preview.rotation}
            />
            <span className="drag-ghost-details">
              <span>
                {preview.groupIDs
                  ? `移动 ${preview.groupIDs.length} 个建筑`
                  : `${preview.definition.name} · ${preview.rotation}°`}
              </span>
              <span>
                当前尺寸：{preview.size}×{preview.size}
              </span>
              {!dragPreview && supportsLargeSize(preview.definition) && (
                <span>
                  <kbd>E</kbd> 键切换尺寸
                </span>
              )}
            </span>
          </div>,
          document.body,
        )}
      {menu &&
        !placementType &&
        menuBuilding &&
        createPortal(
          <div
            className="building-menu"
            role="menu"
            aria-label="建筑操作"
            ref={menuRef}
            style={{ left: menu.x, top: menu.y }}
          >
            <small>
              {
                catalog.buildings.find(
                  (d) => d.id === menuBuilding.building_type,
                )?.name
              }{" "}
              ({menuBuilding.x}, {menuBuilding.y})
            </small>
            <button
              role="menuitem"
              disabled={
                (!batchIDs.length &&
                  (isFixed(menuBuilding) || isTerminal(menuBuilding))) ||
                saving
              }
              onClick={() => remove(menuBuilding.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
              </svg>
              <span>
                {batchIDs.length
                  ? `删除选中 ${batchIDs.length} 个建筑`
                  : isUnderground(menuBuilding)
                    ? "回收整对出入口"
                    : "删除"}
              </span>
            </button>
            {isFixed(menuBuilding) && (
              <small>工厂仓库可移动，不可旋转或删除</small>
            )}
            {isTerminal(menuBuilding) && (
              <small>仓库终端可移动，不可删除</small>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
