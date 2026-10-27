import type { LocalFactory } from "./state";
import { step } from "./simulation";
import { stepWorld } from "./world";
import { secondsToTicks } from "./simulationTime";

// Existing scenario suites describe elapsed seconds. Clock / frame / belt
// suites call the raw half-second transitions explicitly instead.
export function simulationSecond(factory: LocalFactory): LocalFactory {
  for (let tick = 0; tick < secondsToTicks(1); tick++) factory = step(factory);
  return factory;
}
export function worldSecond(factory: LocalFactory): LocalFactory {
  for (let tick = 0; tick < secondsToTicks(1); tick++)
    factory = stepWorld(factory);
  return factory;
}
