import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FactoryDetail } from "../api/client";
import type { RobotRoute } from "./local/robotNavigation";
import { RobotVisuals } from "./robotVisuals";
import { robotSpriteURL } from "./robotSprites";
import { useSimulationFrame, useSimulationStepMs } from "./SimulationAnimation";
import { TILE_SIZE } from "./editorGeometry";

export default memo(function RobotLayer({
  factory,
  routes,
  selectedID,
  paused = false,
  visible = true,
}: {
  factory: FactoryDetail;
  routes: readonly RobotRoute[];
  selectedID?: string | null;
  paused?: boolean;
  visible?: boolean;
}) {
  const [visuals] = useState(() => new RobotVisuals());
  const elements = useRef(new Map<string, HTMLSpanElement>());
  const stepMs = useSimulationStepMs();
  const robots = useMemo(
    () =>
      (factory.robots ?? []).filter(
        (r) => !r.transit && r.factory_id === factory.id,
      ),
    [factory.robots, factory.id],
  );
  const robotItems = useMemo(
    () => new Map(robots.map((r) => [r.id, r.item])),
    [robots],
  );
  const tick = factory.simulation?.tick ?? 0;
  const revision = factory.revision ?? tick;
  const activeRoutes = routes.filter(
    (route) => route.factory_id === factory.id && route.points.length > 1,
  );
  useLayoutEffect(() => {
    visuals.sync(
      robots,
      factory.id,
      tick,
      revision,
      stepMs,
      performance.now(),
      paused,
      !visible || document.hidden,
    );
  }, [visuals, robots, factory.id, tick, revision, stepMs, paused, visible]);
  useEffect(() => {
    const visibility = () => visuals.settle();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [visuals]);
  useSimulationFrame(({ now }) => {
    if (!visible || document.hidden) {
      visuals.settle();
      return false;
    }
    return (
      visuals.paint(now, (id, position) => {
        const element = elements.current.get(id);
        if (!element) return;
        element.style.transform = `translate3d(${(position.x + Math.floor(factory.width / 2)) * TILE_SIZE}px,${(Math.floor(factory.height / 2) - position.y) * TILE_SIZE}px,0)`;
        const image = element.firstElementChild as HTMLImageElement | null;
        const url = robotSpriteURL(robotItems.get(id)!, position.direction);
        if (image && url && image.getAttribute("src") !== url)
          image.setAttribute("src", url);
        if (image)
          image.style.transform =
            position.direction === "left" ? "scaleX(-1)" : "";
      }) && !paused
    );
  });
  return (
    <>
      {activeRoutes.length > 0 && (
        <svg
          className="robot-route-layer"
          viewBox={`0 0 ${factory.width * TILE_SIZE} ${factory.height * TILE_SIZE}`}
          aria-label="机器人当前路段预览"
        >
          {activeRoutes.map((route) => (
            <polyline
              key={route.robot_id}
              data-robot-route={route.robot_id}
              className={
                route.robot_id === selectedID ? "selected-route" : undefined
              }
              points={route.points
                .map(
                  (p) =>
                    `${(p.x + factory.width / 2) * TILE_SIZE},${(factory.height / 2 - p.y) * TILE_SIZE}`,
                )
                .join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={route.robot_id === selectedID ? 2 : 1.25}
              strokeDasharray="5 4"
            />
          ))}
        </svg>
      )}
      <div className="robot-visual-layer" aria-hidden="true">
        {robots.map((robot) => (
          <span
            key={robot.id}
            data-robot-visual={robot.id}
            className={`robot-visual${robot.id === selectedID ? " selected-robot" : ""}`}
            ref={(node) => {
              if (node) elements.current.set(robot.id, node);
              else elements.current.delete(robot.id);
            }}
            style={{
              transform: `translate3d(${(robot.x + Math.floor(factory.width / 2)) * TILE_SIZE}px,${(Math.floor(factory.height / 2) - robot.y) * TILE_SIZE}px,0)`,
            }}
          >
            <img
              src={robotSpriteURL(robot.item, "down")}
              alt=""
              draggable={false}
            />
          </span>
        ))}
      </div>
    </>
  );
});
