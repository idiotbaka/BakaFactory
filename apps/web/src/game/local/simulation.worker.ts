import { type LocalFactory } from "./state";
import {
  actWorld,
  createWorld,
  districtSummary,
  editWorld,
  initializeWorld,
  projectFactory,
  stepWorld,
} from "./world";
import type { WorkerCommand, WorkerEvent } from "./workerProtocol";
import { worldFrame } from "./worldFrame";
import { Observations } from "./observations";
import { DEFAULT_TPS, tickIntervalMs, validateTickRate } from "./tickRate";
import {
  HEARTBEAT_MS,
  MAX_LEASE_MS,
  MAX_WAKE_GAP_MS,
  MAX_TICKS_PER_WAKE,
} from "./runtimeTiming";
const observations = new Observations();

let factory: LocalFactory | null = null;
let enabled = false,
  expires = 0,
  wallExpires = 0,
  lastWake = 0,
  lastWallWake = 0,
  nextTick = 0;
let tickRate = DEFAULT_TPS;
let timer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
const send = (event: WorkerEvent) => postMessage(event);
const sendState = (request?: number) =>
  send({
    kind: "state",
    factory: projectFactory(factory!),
    root: factory!,
    districts: districtSummary(factory!),
    request,
    observation: observations.snapshot(),
  });
function scheduleHeartbeat() {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    send({ kind: "heartbeat_due" });
    scheduleHeartbeat();
  }, HEARTBEAT_MS);
}
function permitted() {
  return enabled && performance.now() < expires && Date.now() < wallExpires;
}
function schedule(reset = true) {
  clearTimeout(timer);
  if (!enabled || !factory) return;
  if (reset) {
    lastWake = performance.now();
    lastWallWake = Date.now();
    nextTick = lastWake + tickIntervalMs(tickRate);
  }
  timer = setTimeout(
    () => {
      const now = performance.now();
      const wallNow = Date.now();
      if (!permitted()) {
        enabled = false;
        send({ kind: "suspended" });
        return;
      }
      // Some platforms stop performance.now() during system sleep. Check both
      // clocks, and require fresh authorization after a long gap on either one.
      if (
        now - lastWake > MAX_WAKE_GAP_MS ||
        wallNow - lastWallWake > MAX_WAKE_GAP_MS
      ) {
        enabled = false;
        send({ kind: "suspended" });
        return;
      }
      lastWake = now;
      lastWallWake = wallNow;
      try {
        // A one-second background wake still owes two ordinary half-second
        // conversions. Bound the work; never accumulate an offline backlog.
        let count = 0;
        while (
          nextTick <= now + 0.01 &&
          count < MAX_TICKS_PER_WAKE &&
          permitted()
        ) {
          const before = factory!;
          factory = stepWorld(before);
          observations.record(before, factory);
          send({
            kind: "delta",
            frame: worldFrame(before, factory),
            observation: observations.snapshot(),
          });
          count++;
          nextTick += tickIntervalMs(tickRate);
        }
        // Slow machines / accelerated TPS must yield rather than drain a queue.
        if (nextTick <= now) nextTick = now + tickIntervalMs(tickRate);
      } catch (error) {
        enabled = false;
        send({
          kind: "error",
          message: error instanceof Error ? error.message : "模拟失败",
        });
      }
      schedule(false);
    },
    Math.max(1, nextTick - performance.now()),
  );
}
self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  try {
    if (command.kind === "init") {
      factory = command.factory ? initializeWorld(command.factory) : null;
      enabled = false;
      tickRate = DEFAULT_TPS;
      observations.clear();
      clearTimeout(timer);
      scheduleHeartbeat();
      if (factory) sendState();
      return;
    }
    if (command.kind === "permit") {
      const nextRate = validateTickRate(command.tickRate ?? DEFAULT_TPS);
      const rateChanged = nextRate !== tickRate;
      tickRate = nextRate;
      const wasEnabled = enabled;
      enabled = command.enabled && command.validFor > 0;
      const validFor = Math.min(
        MAX_LEASE_MS,
        Math.max(0, command.validFor),
        command.validUntil === undefined
          ? MAX_LEASE_MS
          : command.validUntil - Date.now(),
      );
      expires = performance.now() + validFor;
      wallExpires = Date.now() + validFor;
      enabled = enabled && validFor > 0;
      if (!enabled) clearTimeout(timer);
      else if (!wasEnabled || rateChanged) schedule();
      return;
    }
    if (command.kind === "replace") {
      factory = initializeWorld(command.factory);
      observations.clear();
    } else {
      if (!permitted()) throw new Error("工厂已暂停，请先恢复在线连接");
      if (command.kind === "create") {
        if (factory) throw new Error("当前账号已有本地工厂");
        factory = createWorld(command.user, command.name);
        schedule();
      } else {
        if (!factory) throw new Error("请先创建工厂");
        factory =
          command.kind === "world"
            ? actWorld(factory, command.action)
            : editWorld(factory, command.edit, command.factoryID);
      }
    }
    sendState(command.request);
  } catch (error) {
    send({
      kind: "error",
      message: error instanceof Error ? error.message : "本地操作失败",
      ...("request" in command ? { request: command.request } : {}),
    });
  }
};
