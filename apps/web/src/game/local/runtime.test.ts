import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  downloadSave,
  gameHeartbeat,
  uploadSave,
} from "../../api/client";
import { GameRuntime, type GameView } from "./runtime";
import { workshopDuration } from "./workshop";
import { readLocal, writeLocal, type LocalRecord } from "./storage";
import {
  createLocalFactory,
  toSave,
  type CloudSave,
  type LocalFactory,
} from "./state";
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
import { catalog, buildingDefinitions, itemID } from "./catalog";
import { worldFrame } from "./worldFrame";
import { openingStoryID, p1StoryID } from "../stories/progress";
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
  tickRate = 2;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(command: WorkerCommand) {
    if (command.kind === "init")
      this.factory = command.factory ? initializeWorld(command.factory) : null;
    else if (command.kind === "permit") {
      this.enabled = command.enabled;
      this.tickRate = command.tickRate ?? 2;
    } else {
      if (command.kind === "create")
        this.factory = createWorld(command.user, command.name);
      else if (command.kind === "edit")
        this.factory = editWorld(
          this.factory!,
          command.edit,
          command.factoryID,
        );
      else if (command.kind === "world")
        this.factory = actWorld(this.factory!, command.action);
      else this.factory = initializeWorld(command.factory);
      this.onmessage?.({
        data: {
          kind: "state",
          factory: structuredClone(projectFactory(this.factory!)),
          root: structuredClone(this.factory!),
          districts: districtSummary(this.factory!),
          request: command.request,
        },
      });
    }
  }
  tick() {
    if (this.enabled && this.factory) {
      const before = this.factory;
      this.factory = stepWorld(this.factory);
      this.onmessage?.({
        data: {
          kind: "delta",
          frame: structuredClone(worldFrame(before, this.factory)),
        },
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
  it("controls session-only TPS through permits, preserves save rules and resets when tools close or runtime restarts", async () => {
    await game.start();
    await game.create("倍速测试");
    expect(view.tickRate).toBe(2);
    expect(() => game.setTickRate(4)).toThrow("开发者工具");
    await game.setDeveloperToolsVisible(true);
    const revision = view.factory!.revision;
    game.setTickRate(4);
    expect(view.tickRate).toBe(4);
    expect(FakeWorker.instances[0].tickRate).toBe(4);
    expect(view.factory!.revision).toBe(revision);
    expect(view.factory!.simulation.tick_rate).toBe(2);
    expect(() => game.setTickRate(0)).toThrow("整数");
    expect(view.tickRate).toBe(4);
    await game.act({ type: "scavenge" });
    expect(saved).not.toHaveProperty("tickRate");
    expect(saved!.save).not.toHaveProperty("tickRate");
    expect(saved!.save!.factory.simulation!.tick_rate).toBe(2);
    window.dispatchEvent(new Event("offline"));
    expect(FakeWorker.instances[0].enabled).toBe(false);
    expect(() => game.setTickRate(2)).toThrow("在线运行");
    await game.setDeveloperToolsVisible(false);
    expect(view.tickRate).toBe(2);
    expect(FakeWorker.instances[0].tickRate).toBe(2);
    await game.close();
    game = new GameRuntime(
      user,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.tickRate).toBe(2);
  });
  it("defaults developer visibility off, serializes toggles with world saves and restores the local-only preference", async () => {
    await game.start();
    expect(view.developerToolsVisible).toBe(false);
    await game.create("本机工具");
    const revision = view.factory!.revision;
    await Promise.all([
      game.setDeveloperToolsVisible(true),
      game.setDeveloperToolsVisible(false),
    ]);
    expect(saved!.developerToolsVisible).toBe(false);
    await game.setDeveloperToolsVisible(true);
    expect(game.developerToolsVisible).toBe(true);
    expect(view.factory!.revision).toBe(revision);
    expect(saved!.save).not.toHaveProperty("developerToolsVisible");
    for (let i = 0; i < 5; i++) FakeWorker.instances[0].tick();
    await game.act({ type: "scavenge" });
    expect(saved!.developerToolsVisible).toBe(true);
    await game.close();
    game = new GameRuntime(
      user,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.developerToolsVisible).toBe(true);
    await game.setDeveloperToolsVisible(false);
    expect(saved!.developerToolsVisible).toBe(false);
    expect(view.developerToolsVisible).toBe(false);
  });
  it("keeps developer visibility local during cloud restore and upload and isolates another account", async () => {
    await game.start();
    await game.setDeveloperToolsVisible(true);
    const cloudRoot = createWorld(user, "云端工厂");
    vi.mocked(downloadSave).mockResolvedValue({
      version: 1,
      saved_at: "now",
      save: toSave(cloudRoot),
    });
    await game.restoreCloud();
    expect(saved!.developerToolsVisible).toBe(true);
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: "now",
      save,
    }));
    await game.backup();
    expect(vi.mocked(uploadSave).mock.calls[0][2]).not.toHaveProperty(
      "developerToolsVisible",
    );
    await game.close();
    const otherUser = { ...user, id: "another-developer" };
    vi.mocked(readLocal).mockResolvedValue(undefined);
    vi.mocked(downloadSave).mockResolvedValue(null);
    vi.mocked(gameHeartbeat).mockResolvedValue({
      user: otherUser,
      session_id: "other-session",
      lease_seconds: 30,
    });
    game = new GameRuntime(
      otherUser,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.developerToolsVisible).toBe(false);
  });
  it("rejects invalid toggles and reports a failed metadata write before showing the tools, with retry support", async () => {
    await game.start();
    await expect(
      game.setDeveloperToolsVisible("true" as unknown as boolean),
    ).rejects.toThrow("devTools");
    vi.mocked(writeLocal).mockRejectedValueOnce(new Error("暂时不可写"));
    await expect(game.setDeveloperToolsVisible(true)).rejects.toThrow(
      "暂时不可写",
    );
    expect(view.developerToolsVisible).toBe(false);
    expect(view.paused).toBe(true);
    await game.retryStorage();
    expect(saved!.developerToolsVisible).toBe(true);
    expect(view.developerToolsVisible).toBe(true);
  });
  it("persists a pending P1 chapter with the real claim, resumes it after reload and removes it only after completion commits", async () => {
    const root = createWorld(user, "P1 领奖");
    root.simulation.industry!.crafted.i0060 = 1;
    root.simulation.industry!.milestones = ["i0060"];
    root.simulation.industry!.quests!.completed = [
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
      "p1_free_hands",
    ];
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    expect(view.pendingStories).toEqual([]);
    await game.world({
      type: "developer_settings",
      warehouse_orders_always_available: true,
    });
    expect(view.pendingStories).toEqual([]);
    await game.world({ type: "claim_quest", id: "p1_free_hands" });
    expect(view.pendingStories).toEqual([p1StoryID]);
    expect(saved!.pendingStories).toEqual([p1StoryID]);
    expect(
      saved!.save!.factory.simulation!.industry!.quests!.claimed,
    ).toContain("p1_free_hands");
    FakeWorker.instances.at(-1)!.tick();
    expect(view.pendingStories).toEqual([p1StoryID]);
    await game.close();
    game = new GameRuntime(
      user,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.pendingStories).toEqual([p1StoryID]);
    vi.mocked(writeLocal).mockRejectedValueOnce(new Error("剧情保存失败"));
    await expect(game.markStoryViewed(p1StoryID)).rejects.toThrow(
      "剧情保存失败",
    );
    expect(view.pendingStories).toEqual([p1StoryID]);
    expect(view.viewedStories).not.toContain(p1StoryID);
    await game.markStoryViewed(p1StoryID);
    expect(view.pendingStories).toEqual([]);
    expect(saved!.pendingStories).toEqual([]);
    expect(saved!.viewedStories).toContain(p1StoryID);
  });
  it("keeps a chapter visible when ticks arrive during its completion transaction", async () => {
    let root = createWorld(user, "剧情保存中");
    root.simulation.industry!.crafted.i0060 = 1;
    root.simulation.industry!.milestones = ["i0060"];
    root.simulation.industry!.quests!.completed = [
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
    ];
    root = actWorld(root, { type: "claim_quest", id: "p1_free_hands" });
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      pendingStories: [p1StoryID],
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    let commit: (() => void) | undefined;
    vi.mocked(writeLocal).mockImplementationOnce(
      (record) =>
        new Promise<void>((resolve) => {
          commit = () => {
            saved = structuredClone(record);
            resolve();
          };
        }),
    );
    const finishing = game.markStoryViewed(p1StoryID);
    await vi.waitFor(() => expect(commit).toBeTypeOf("function"));
    FakeWorker.instances.at(-1)!.tick();
    expect(view.pendingStories).toEqual([p1StoryID]);
    expect(view.viewedStories).not.toContain(p1StoryID);
    commit!();
    await finishing;
    expect(view.pendingStories).toEqual([]);
    expect(view.viewedStories).toContain(p1StoryID);
  });
  it("does not invent automatic chapters from historical or cloud claims and prunes invalidated pending chapters", async () => {
    let root = createWorld(user, "既有 P2");
    root.simulation.industry!.crafted.i0060 = 1;
    root.simulation.industry!.milestones = ["i0060"];
    root.simulation.industry!.quests!.completed = [
      "p1_dismantler",
      "p1_crusher",
      "p1_smelter",
      "p1_assembler",
      "p1_free_hands",
    ];
    root = actWorld(root, { type: "claim_quest", id: "p1_free_hands" });
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    expect(view.pendingStories).toEqual([]);
    vi.mocked(downloadSave).mockResolvedValue({
      version: 1,
      saved_at: "now",
      save: toSave(root),
    });
    await game.restoreCloud();
    expect(view.pendingStories).toEqual([]);
    await game.close();
    saved!.pendingStories = [p1StoryID];
    game = new GameRuntime(
      user,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.pendingStories).toEqual([p1StoryID]);
    vi.mocked(downloadSave).mockResolvedValue({
      version: 2,
      saved_at: "now",
      save: toSave(createWorld(user, "尚未领奖")),
    });
    await game.restoreCloud();
    expect(view.pendingStories).toEqual([]);
    expect(saved!.pendingStories).toEqual([]);
  });
  it("persists a completed opening before factory creation and retains UI history through cloud replacement", async () => {
    await game.start();
    expect(view.factory).toBeNull();
    await game.markStoryViewed(openingStoryID);
    expect(saved!.save).toBeNull();
    expect(saved!.viewedStories).toEqual([openingStoryID]);
    await game.markStoryViewed(openingStoryID);
    expect(saved!.viewedStories).toEqual([openingStoryID]);
    await game.close();
    game = new GameRuntime(
      user,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.viewedStories).toEqual([openingStoryID]);
    const root = createWorld(user, "已有云厂");
    vi.mocked(downloadSave).mockResolvedValue({
      version: 1,
      saved_at: "now",
      save: toSave(root),
    });
    await game.restoreCloud();
    expect(saved!.viewedStories).toEqual([openingStoryID]);
    expect(saved!.save!.factory.id).toBe(root.id);
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: "now",
      save,
    }));
    await game.backup();
    expect(vi.mocked(uploadSave).mock.calls[0][2]).not.toHaveProperty(
      "viewedStories",
    );
  });
  it("does not report story completion until its transaction commits and can retry a failed write", async () => {
    await game.start();
    vi.mocked(writeLocal).mockRejectedValueOnce(new Error("磁盘暂时不可写"));
    await expect(game.markStoryViewed(openingStoryID)).rejects.toThrow(
      "磁盘暂时不可写",
    );
    expect(view.viewedStories).toEqual([]);
    expect(saved!.viewedStories).toBeUndefined();
    expect(view.paused).toBe(true);
    await game.markStoryViewed(openingStoryID);
    expect(view.viewedStories).toEqual([openingStoryID]);
    expect(saved!.viewedStories).toEqual([openingStoryID]);
    expect(view.paused).toBe(false);
    expect(view.message).not.toContain("本地保存失败");
  });
  it("keeps viewed-story history isolated between account records", async () => {
    await game.start();
    await game.markStoryViewed(openingStoryID);
    await game.close();
    const otherUser = { ...user, id: "other-story-owner", username: "other" };
    vi.mocked(readLocal).mockResolvedValue(undefined);
    vi.mocked(gameHeartbeat).mockResolvedValue({
      user: otherUser,
      session_id: "other-session",
      lease_seconds: 30,
    });
    game = new GameRuntime(
      otherUser,
      (next) => {
        view = next;
      },
      expired,
    );
    await game.start();
    expect(view.viewedStories).toEqual([]);
    expect(view.factory).toBeNull();
  });
  it("announces newly confirmed quests once, saves claimed rewards and suppresses cloud replay", async () => {
    const root = createWorld(user, "任务通知");
    root.simulation.warehouse[itemID("垃圾包")] = 12;
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    await game.act({ type: "workshop", recipe: "r1001" });
    const duration = workshopDuration(
      catalog.recipes.find((r) => r.id === "r1001")!,
    );
    for (let i = 0; i < duration; i++) FakeWorker.instances[0].tick();
    expect(view.questNotices).toEqual([{ sequence: 1, id: "p1_sort_waste" }]);
    await game.world({ type: "claim_quest", id: "p1_sort_waste" });
    expect(saved!.save!.factory.simulation!.industry!.quests!.claimed).toEqual([
      "p1_sort_waste",
    ]);
    expect(saved!.save!.factory.simulation!.warehouse[itemID("简易支架")]).toBe(
      10,
    );
    FakeWorker.instances[0].tick();
    expect(view.questNotices).toHaveLength(1);
    const cloudRoot = createWorld(user, "云任务");
    cloudRoot.simulation.industry!.crafted[
      buildingDefinitions.get("m03")!.item!
    ] = 1;
    delete cloudRoot.simulation.industry!.quests;
    delete cloudRoot.simulation.industry!.discovered_items;
    vi.mocked(downloadSave).mockResolvedValue({
      version: 1,
      saved_at: "now",
      save: toSave(cloudRoot),
    });
    await game.restoreCloud();
    expect(view.questNotices).toEqual([]);
    expect(view.factory!.simulation.industry!.quests!.completed).toContain(
      "p1_dismantler",
    );
    FakeWorker.instances[0].tick();
    expect(view.questNotices).toEqual([]);
  });
  it("normalizes old obtained-item tasks before establishing the notification baseline", async () => {
    const root = createWorld(user, "旧任务");
    root.simulation.industry!.crafted[buildingDefinitions.get("m03")!.item!] =
      1;
    delete root.simulation.industry!.quests;
    delete root.simulation.industry!.discovered_items;
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    FakeWorker.instances[0].tick();
    expect(view.questNotices).toEqual([]);
    expect(view.factory!.simulation.industry!.quests!.completed).toEqual([
      "p1_dismantler",
    ]);
  });
  it("derives workshop backpressure from the headquarters warehouse while viewing an empty child", async () => {
    let root = createWorld(user, "批量背压");
    root.simulation.warehouse[itemID("垃圾包")] = 24;
    root = editWorld(root, {
      kind: "industry",
      action: { type: "workshop", recipe: "r1001", batches: 2 },
    });
    root.simulation.warehouse[itemID("铁质碎片")] = Number.MAX_SAFE_INTEGER;
    root = actWorld(root, {
      type: "select_district",
      id: root.districts![0].id,
    });
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    FakeWorker.instances[0].tick();
    expect(view.workshopBlocked).toBe(true);
    expect(view.factory!.id).toBe(root.active_district_id);
    expect(view.factory!.simulation.warehouse).toEqual(
      root.simulation.warehouse,
    );
    expect(view.factory!.simulation.industry!.workshop).toMatchObject({
      remaining: 2,
      total: 2,
      progress: 0,
    });
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: "now",
      save,
    }));
    await game.backup();
    expect(
      vi.mocked(uploadSave).mock.calls[0][2].factory.simulation!.industry!
        .workshop,
    ).toMatchObject({ remaining: 2, total: 2, progress: 0 });
  });
  it("coalesces slow automatic saves to the latest complete world instead of queueing every checkpoint", async () => {
    await game.start();
    await game.create("保存背压");
    vi.mocked(writeLocal).mockClear();
    let release: (() => void) | undefined;
    vi.mocked(writeLocal).mockImplementationOnce(
      (record) =>
        new Promise<void>((resolve) => {
          release = () => {
            saved = structuredClone(record);
            resolve();
          };
        }),
    );
    try {
      for (let n = 0; n < 50; n++) FakeWorker.instances[0].tick();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeLocal).toHaveBeenCalledOnce();
      release?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeLocal).toHaveBeenCalledTimes(2);
      expect(saved?.save?.factory.simulation?.tick).toBe(50);
    } finally {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    }
  });
  it("backs up a complete reconstructed world before the five-second autosave and pauses on a missing frame", async () => {
    await game.start();
    await game.create("增量世界");
    const worker = FakeWorker.instances[0];
    worker.tick();
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: "now",
      save,
    }));
    await game.backup();
    expect(
      vi.mocked(uploadSave).mock.calls[0][2].factory.simulation!.tick,
    ).toBe(1);
    expect(
      vi.mocked(uploadSave).mock.calls[0][2].factory.districts,
    ).toHaveLength(5);
    const previous = structuredClone(worker.factory!),
      after = stepWorld(previous),
      frame = worldFrame(previous, after),
      savedBefore = structuredClone(saved);
    worker.onmessage?.({
      data: {
        kind: "delta",
        frame: { ...frame, base_revision: frame.base_revision + 1 },
      },
    });
    expect(view.paused).toBe(true);
    expect(view.message).toContain("快照序列");
    expect(view.factory!.simulation.tick).toBe(1);
    expect(saved).toEqual(savedBefore);
  });
  it("keeps a real construction checkpoint and read-only route through offline permission loss", async () => {
    let root = createWorld(user, "施工恢复");
    root.simulation.industry!.stage = 6;
    root.simulation.industry!.quests!.completed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    root.simulation.industry!.quests!.claimed.push(
      ...catalog
        .quests!.filter(
          (q) => q.stage_final && q.tier < root.simulation.industry!.stage,
        )
        .map((q) => q.id),
    );
    root.simulation.industry!.milestones = catalog
      .stages!.slice(0, 5)
      .map((s) => s.milestone_item);
    root.simulation.warehouse[
      buildingDefinitions.get("charge_station")!.item!
    ] = 1;
    root = editWorld(root, {
      kind: "place",
      id: "station",
      building_type: "charge_station",
      placement: { x: 4, y: 0, rotation: 0 },
    });
    root.simulation.warehouse[itemID("智能机器人")] = 1;
    root = actWorld(root, {
      type: "robot_deploy",
      id: "builder",
      item: itemID("智能机器人"),
      station: "station",
      factory_id: root.id,
    });
    root.robots![0].energy_kj = 30000;
    root.simulation.warehouse[buildingDefinitions.get("m03")!.item!] = 1;
    root = actWorld(root, {
      type: "robot_construct",
      id: "builder",
      blueprint: {
        id: "site",
        factory_id: root.id,
        building_type: "m03",
        x: 6,
        y: 2,
        rotation: 0,
      },
    });
    saved = {
      owner: user.id,
      version: 1,
      save: toSave(root),
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: "now",
    };
    await game.start();
    const before = structuredClone(saved);
    expect(game.robotRoute("builder")?.target?.building_id).toBe("site");
    expect(saved).toEqual(before);
    vi.mocked(gameHeartbeat).mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(10000);
    const worker = FakeWorker.instances[0];
    worker.tick();
    expect(view.paused).toBe(true);
    expect(worker.factory!.robots).toEqual(root.robots);
    expect(game.robotRoute("builder")?.status).toBe("ready");
    await expect(
      game.world({ type: "robot_return", id: "builder" }),
    ).rejects.toThrow("暂停");
    vi.mocked(gameHeartbeat).mockResolvedValue({
      user,
      session_id: "session-1",
      lease_seconds: 30,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(worker.factory!.simulation.tick).toBe(root.simulation.tick);
    worker.tick();
    expect(worker.factory!.simulation.tick).toBe(root.simulation.tick + 1);
    expect(worker.factory!.robots![0].cargo).toEqual(root.robots![0].cargo);
    expect(worker.factory!.buildings.some((b) => b.id === "site")).toBe(false);
  });
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
  it("keeps the entire world when editing and backing up a non-headquarters viewport", async () => {
    await game.start();
    const headquarters = await game.create("世界存档");
    expect(view.districts).toHaveLength(6);
    const child = view.districts!.find((f) => !f.headquarters)!;
    await game.world({ type: "select_district", id: child.id });
    await game.commands.placeBuilding(child.id, "miner", {
      x: 1,
      y: 1,
      rotation: 0,
    });
    expect(view.factory?.id).toBe(child.id);
    expect(saved?.save?.factory.id).toBe(headquarters.id);
    expect(
      saved?.save?.factory.districts?.find((f) => f.id === child.id)?.buildings,
    ).toHaveLength(2);
    vi.mocked(uploadSave).mockImplementation(async (_session, base, save) => ({
      version: base + 1,
      saved_at: "now",
      save,
    }));
    await game.backup();
    const uploaded = vi.mocked(uploadSave).mock.calls[0][2];
    expect(uploaded.factory.id).toBe(headquarters.id);
    expect(uploaded.factory.active_district_id).toBe(child.id);
    expect(uploaded.factory.districts).toHaveLength(5);
    expect(uploaded.factory.buildings).toHaveLength(1);
    expect(view.factory?.id).toBe(child.id);
  });
});
