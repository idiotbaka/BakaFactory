import { createLocalFactory, editFactory, type LocalFactory } from "./state";
import { step } from "./simulation";
import type { WorkerCommand, WorkerEvent } from "./workerProtocol";

let factory: LocalFactory | null = null;
let enabled = false,
  expires = 0,
  lastWake = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const send = (event: WorkerEvent) => postMessage(event);
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
        factory = step(factory!);
        send({ kind: "state", factory });
      } catch (error) {
        enabled = false;
        send({
          kind: "error",
          message: error instanceof Error ? error.message : "模拟失败",
        });
      }
    }
    schedule();
  }, 1000);
}
self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  try {
    if (command.kind === "init") {
      factory = command.factory;
      enabled = false;
      clearTimeout(timer);
      return;
    }
    if (command.kind === "permit") {
      const wasEnabled = enabled;
      enabled = command.enabled && command.validFor > 0;
      expires =
        performance.now() + Math.min(30000, Math.max(0, command.validFor));
      if (!enabled) clearTimeout(timer);
      else if (!wasEnabled) schedule();
      return;
    }
    if (command.kind === "replace") factory = command.factory;
    else {
      if (!enabled || performance.now() >= expires)
        throw new Error("工厂已暂停，请先恢复在线连接");
      if (command.kind === "create") {
        if (factory) throw new Error("当前账号已有本地工厂");
        factory = createLocalFactory(command.user, command.name);
        schedule();
      } else {
        if (!factory) throw new Error("请先创建工厂");
        factory = editFactory(factory, command.edit);
      }
    }
    send({ kind: "state", factory: factory!, request: command.request });
  } catch (error) {
    send({
      kind: "error",
      message: error instanceof Error ? error.message : "本地操作失败",
      ...("request" in command ? { request: command.request } : {}),
    });
  }
};
