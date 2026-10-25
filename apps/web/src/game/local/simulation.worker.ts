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
const observations = new Observations();

let factory: LocalFactory | null = null;
let enabled = false,
  expires = 0,
  lastWake = 0;
let tickRate = DEFAULT_TPS;
let timer: ReturnType<typeof setTimeout> | undefined;
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
function schedule() {
  clearTimeout(timer);
  if (!enabled || !factory) return;
  lastWake = performance.now();
  timer = setTimeout(() => {
    const now = performance.now();
    if (!enabled || now >= expires) {
      enabled = false;
      return;
    }
    // Suspension, sleep and slow devices never generate accumulated ticks.
    if (now - lastWake <= 2500) {
      try {
        const before = factory!;
        factory = stepWorld(before);
        observations.record(before, factory);
        send({
          kind: "delta",
          frame: worldFrame(before, factory),
          observation: observations.snapshot(),
        });
      } catch (error) {
        enabled = false;
        send({
          kind: "error",
          message: error instanceof Error ? error.message : "模拟失败",
        });
      }
    }
    schedule();
  }, tickIntervalMs(tickRate));
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
      if (factory) sendState();
      return;
    }
    if (command.kind === "permit") {
      const nextRate = validateTickRate(command.tickRate ?? DEFAULT_TPS);
      const rateChanged = nextRate !== tickRate;
      tickRate = nextRate;
      const wasEnabled = enabled;
      enabled = command.enabled && command.validFor > 0;
      expires =
        performance.now() + Math.min(30000, Math.max(0, command.validFor));
      if (!enabled) clearTimeout(timer);
      else if (!wasEnabled || rateChanged) schedule();
      return;
    }
    if (command.kind === "replace") {
      factory = initializeWorld(command.factory);
      observations.clear();
    } else {
      if (!enabled || performance.now() >= expires)
        throw new Error("工厂已暂停，请先恢复在线连接");
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
