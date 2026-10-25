import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MachineState, Simulation } from "../api/client";
import { AnimationClock, type AnimationFrame } from "./animationClock";
import { productionProgress } from "./animationMath";
import { DEFAULT_TPS, tickIntervalMs } from "./local/tickRate";

const ClockContext = createContext<AnimationClock | null>(null);
const StepMsContext = createContext(1000);
export function SimulationAnimationProvider({
  factoryID,
  simulation,
  powerSaving = false,
  paused = false,
  tickRate = DEFAULT_TPS,
  children,
}: {
  factoryID?: string;
  simulation?: Simulation;
  powerSaving?: boolean;
  paused?: boolean;
  tickRate?: number;
  children: ReactNode;
}) {
  const [clock] = useState(() => new AnimationClock());
  useLayoutEffect(() => clock.setPaused(paused), [clock, paused]);
  useLayoutEffect(() => {
    clock.setPowerSaving(powerSaving);
  }, [clock, powerSaving]);
  useLayoutEffect(() => {
    clock.sync(factoryID, simulation?.tick, tickIntervalMs(tickRate));
  }, [clock, factoryID, simulation?.tick, tickRate]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) clock.pause();
      else clock.wake();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      clock.dispose();
    };
  }, [clock]);
  return (
    <StepMsContext.Provider value={tickIntervalMs(tickRate)}>
      <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>
    </StepMsContext.Provider>
  );
}
export function useSimulationStepMs() {
  return useContext(StepMsContext);
}
export function useSimulationFrame(
  paint: (frame: AnimationFrame) => boolean | void,
) {
  const clock = useContext(ClockContext);
  const latest = useRef(paint);
  useLayoutEffect(() => {
    latest.current = paint;
    paint(clock?.frame() ?? { now: performance.now(), phase: 0, stepMs: 1000 });
    clock?.requestFrame();
  }, [paint, clock]);
  useLayoutEffect(
    () => clock?.subscribe((frame) => latest.current(frame)),
    [clock],
  );
}
export const MachineProgress = memo(function MachineProgress({
  machine,
}: {
  machine: MachineState;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  useSimulationFrame((frame) => {
    const value = machine.duration
      ? productionProgress(machine, frame.phase) / machine.duration
      : 0;
    if (bar.current) bar.current.style.transform = `scaleX(${value})`;
    return (
      machine.duration > 0 && machine.status === "working" && frame.phase < 1
    );
  });
  return (
    <span className="tile-production-bar" aria-hidden="true">
      <span
        ref={bar}
        style={{
          transform: `scaleX(${machine.duration ? machine.progress / machine.duration : 0})`,
        }}
      />
    </span>
  );
});
export function DetailedProgress({
  machine,
  name,
}: {
  machine: MachineState;
  name: string;
}) {
  const bar = useRef<HTMLProgressElement>(null),
    label = useRef<HTMLSpanElement>(null);
  useSimulationFrame((frame) => {
    const value = productionProgress(machine, frame.phase);
    if (bar.current) bar.current.value = value;
    if (label.current)
      label.current.textContent = `${value.toFixed(1)} / ${machine.duration.toFixed(1)}s`;
    return (
      machine.duration > 0 && machine.status === "working" && frame.phase < 1
    );
  });
  return (
    <div className="production-progress">
      <div>
        <span>{name}</span>
        <span ref={label}>
          {machine.progress.toFixed(1)} / {machine.duration.toFixed(1)}s
        </span>
      </div>
      <progress
        ref={bar}
        aria-label="生产进度"
        max={machine.duration || 1}
        value={machine.progress}
      />
    </div>
  );
}
