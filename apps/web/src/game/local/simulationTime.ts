// Game time is independent of the Worker's wall-clock scheduling / dev speed.
// Persist durations and cooldowns in seconds; only tick IDs count transitions.
export const SIMULATION_TPS = 2;
export const STEP_SECONDS = 1 / SIMULATION_TPS;
export const STEP_MS = 1000 / SIMULATION_TPS;
export const secondsToTicks = (seconds: number) => seconds * SIMULATION_TPS;
export const ticksToSeconds = (ticks: number) => ticks / SIMULATION_TPS;
export const onInterval = (tick: number, seconds: number) =>
  tick % secondsToTicks(seconds) === 0;
// Whole-unit budgets alternate rather than rounding away an odd per-second rate.
export const wholeUnitsThisTick = (rate: number, tick: number) =>
  Math.floor((tick * rate) / SIMULATION_TPS) -
  Math.floor(((tick - 1) * rate) / SIMULATION_TPS);
export const isStepValue = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value * SIMULATION_TPS) &&
  value >= 0 &&
  value <= max;
