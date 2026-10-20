import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  downloadSave,
  gameHeartbeat,
  uploadSave,
} from "../../api/client";
import { GameRuntime, type GameView } from "./runtime";
import { readLocal, writeLocal, type LocalRecord } from "./storage";
import {
  createLocalFactory,
  editFactory,
  toSave,
  type CloudSave,
  type LocalFactory,
} from "./state";
import { step } from "./simulation";
import type { WorkerCommand, WorkerEvent } from "./workerProtocol";
vi.mock("./storage", () => ({ readLocal: vi.fn(), writeLocal: vi.fn() }));
vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  downloadSave: vi.fn(),
  gameHeartbeat: vi.fn(),
  uploadSave: vi.fn(),
}));
const user = {
  id: "owner",
  username: "owner",
  display_name: "厂长",
  created_at: "now",
  last_login_at: "now",
};
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: WorkerEvent }) => void) | null = null;
  onerror: (() => void) | null = null;
  factory: LocalFactory | null = null;
  enabled = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(command: WorkerCommand) {
    if (command.kind === "init") this.factory = command.factory;
    else if (command.kind === "permit") this.enabled = command.enabled;
    else {
      if (command.kind === "create")
        this.factory = createLocalFactory(command.user, command.name);
      else if (command.kind === "edit")
        this.factory = editFactory(this.factory!, command.edit);
      else this.factory = command.factory;
      this.onmessage?.({
        data: {
          kind: "state",
          factory: structuredClone(this.factory!),
          request: command.request,
        },
      });
    }
  }
  tick() {
    if (this.enabled && this.factory) {
      this.factory = step(this.factory);
      this.onmessage?.({
        data: { kind: "state", factory: structuredClone(this.factory) },
      });
    }
  }
  terminate() {
    this.enabled = false;
  }
}
let saved: LocalRecord | undefined;
let view: GameView;
let game: GameRuntime;
const expired = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  saved = undefined;
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  const held = new Set<string>();
  vi.stubGlobal("navigator", {
    onLine: true,
    storage: { persist: async () => true },
    locks: {
      request: async (
        name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({});
        } finally {
          held.delete(name);
        }
      },
    },
  });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.mocked(readLocal).mockImplementation(async () => structuredClone(saved));
  vi.mocked(writeLocal).mockImplementation(async (record) => {
    saved = structuredClone(record);
  });
  vi.mocked(gameHeartbeat).mockResolvedValue({
    user,
    session_id: "session-1",
    lease_seconds: 30,
  });
  vi.mocked(downloadSave).mockResolvedValue(null);
  game = new GameRuntime(
    user,
    (next) => {
      view = next;
    },
    expired,
  );
});
afterEach(async () => {
  await game.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("local persistence and cloud lifecycle", () => {
  it("restores a newer cloud checkpoint over an empty local placeholder", async () => {
    saved = {
      owner: user.id,
      version: 1,
      save: null,
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    const factory = createLocalFactory(user, "新设备云恢复");
    vi.mocked(downloadSave).mockResolvedValue({
      version: 3,
      saved_at: "now",
      save: toSave(factory),
    });
    await game.start();
    expect(view.conflict).toBe(false);
    expect(view.factory?.id).toBe(factory.id);
    expect(saved?.cloudVersion).toBe(3);
  });
  it("restores an explicitly selected cloud save as one complete local record", async () => {
    await game.start();
    await game.create("本机旧进度");
    const factory = createLocalFactory(user, "手动云恢复");
    factory.simulation.warehouse.iron_ore = 42;
    vi.mocked(downloadSave).mockResolvedValue({
      version: 4,
      saved_at: "now",
      save: toSave(factory),
    });
    await game.restoreCloud();
    expect(view.factory?.id).toBe(factory.id);
    expect(saved?.save?.factory.simulation?.warehouse.iron_ore).toBe(42);
    expect(saved?.cloudVersion).toBe(4);
    expect(view.paused).toBe(false);
    expect(view.dirty).toBe(false);
  });
  it("creates and edits locally and does not send factory snapshots during heartbeats", async () => {
    await game.start();
    const f = await game.create("本机");
    await game.commands.placeBuilding(f.id, "miner", {
      x: 1,
      y: 1,
      rotation: 0,
    });
    expect(saved?.save?.factory.buildings).toHaveLength(2);
    expect(uploadSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(gameHeartbeat).toHaveBeenLastCalledWith(
      "session-1",
      expect.any(AbortSignal),
    );
    expect(downloadSave).toHaveBeenCalledOnce();
    expect(uploadSave).not.toHaveBeenCalled();
  });
  it("restores the cloud only when no local save exists", async () => {
    const f = createLocalFactory(user, "云端");
    f.simulation.tick = 100;
    f.revision = 100;
    vi.mocked(downloadSave).mockResolvedValue({
      version: 4,
      saved_at: "2026-10-20T00:00:00Z",
      save: toSave(f),
    });
    await game.start();
    expect(view.factory?.simulation.tick).toBe(100);
    expect(saved?.cloudVersion).toBe(4);
    expect(FakeWorker.instances[0].enabled).toBe(true);
  });
  it("pauses without overwriting either branch when local lineage differs", async () => {
    const local = createLocalFactory(user, "本机");
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(local),
      cloudVersion: 1,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    const remote = createLocalFactory(user, "另一设备");
    vi.mocked(downloadSave).mockResolvedValue({
      version: 2,
      saved_at: "now",
      save: toSave(remote),
    });
    await game.start();
    expect(view.conflict).toBe(true);
    expect(view.factory?.id).toBe(local.id);
    expect(FakeWorker.instances[0].enabled).toBe(false);
    expect(uploadSave).not.toHaveBeenCalled();
  });
  it("never lets an upload acknowledgement replace newer live gameplay", async () => {
    await game.start();
    const f = await game.create("本机");
    await game.commands.placeBuilding(f.id, "miner", {
      x: 1,
      y: 1,
      rotation: 0,
    });
    let finish!: (cloud: CloudSave) => void;
    vi.mocked(uploadSave).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const uploading = game.backup();
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    const snapshot = vi.mocked(uploadSave).mock.calls[0][2];
    FakeWorker.instances[0].tick();
    FakeWorker.instances[0].tick();
    finish({ version: 1, saved_at: "now", save: snapshot });
    await uploading;
    expect(view.factory?.simulation.tick).toBe(2);
    expect(saved?.save?.factory.simulation?.tick).toBe(2);
    expect(view.dirty).toBe(true);
    expect(saved?.uploadedRevision).toBe(snapshot.factory.revision);
  });
  it("pauses on connection loss, resumes after validation and never catches up", async () => {
    await game.start();
    await game.create("本机");
    vi.mocked(gameHeartbeat).mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(view.online).toBe(false);
    expect(FakeWorker.instances[0].enabled).toBe(false);
    vi.mocked(gameHeartbeat).mockResolvedValue({
      user,
      session_id: "session-1",
      lease_seconds: 30,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(view.online).toBe(true);
    expect(view.factory?.simulation.tick).toBe(0);
  });
  it("stops a kicked session and never uploads its local progress", async () => {
    await game.start();
    await game.create("本机");
    vi.mocked(gameHeartbeat).mockRejectedValue(new ApiError(401, "kicked"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(expired).toHaveBeenCalledOnce();
    expect(FakeWorker.instances[0].enabled).toBe(false);
    await expect(game.backup()).rejects.toThrow("连接");
    expect(uploadSave).not.toHaveBeenCalled();
  });
  it("stops on IndexedDB failure and allows a successful retry", async () => {
    await game.start();
    await game.create("本机");
    vi.mocked(writeLocal).mockRejectedValueOnce(new Error("quota"));
    await expect(
      game.commands.placeBuilding(view.factory!.id, "miner", {
        x: 1,
        y: 1,
        rotation: 0,
      }),
    ).rejects.toThrow("quota");
    expect(FakeWorker.instances[0].enabled).toBe(false);
    await game.retryStorage();
    expect(FakeWorker.instances[0].enabled).toBe(true);
    expect(saved?.save?.factory.buildings).toHaveLength(2);
  });
  it("refuses a second tab while the first tab holds the save lock", async () => {
    await game.start();
    let secondView: GameView | undefined;
    const second = new GameRuntime(
      user,
      (next) => {
        secondView = next;
      },
      expired,
    );
    await second.start();
    expect(secondView?.error).toContain("另一个标签页");
    await second.close();
  });
  it("backs up after thirty minutes and retries a failed manual upload within a minute", async () => {
    await game.start();
    await game.create("自动备份");
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: new Date().toISOString(),
      save,
    }));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(uploadSave).toHaveBeenCalledOnce();
    await game.commands.placeBuilding(view.factory!.id, "miner", {
      x: 1,
      y: 1,
      rotation: 0,
    });
    vi.mocked(uploadSave).mockRejectedValueOnce(new Error("upload offline"));
    await expect(game.backup()).rejects.toThrow("upload offline");
    expect(FakeWorker.instances[0].enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(uploadSave).toHaveBeenCalledTimes(3);
    expect(view.dirty).toBe(false);
  });
});
