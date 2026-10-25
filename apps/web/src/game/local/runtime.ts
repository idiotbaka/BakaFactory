import {
  ApiError,
  downloadSave,
  gameHeartbeat,
  uploadSave,
  type BuildingPlacement,
  type FactoryDetail,
  type User,
} from "../../api/client";
import {
  catalog,
  toSave,
  validateSave,
  type CloudSave,
  type LocalFactory,
} from "./state";
import { readLocal, writeLocal, type LocalRecord } from "./storage";
import type { WorkerCommand, WorkerEvent } from "./workerProtocol";
import type { IndustryAction } from "./industry";
import { previewRobotRoute } from "./robotNavigation";
import { applyWorldFrame } from "./worldFrame";
import { workshopOutputFits } from "./workshop";
import {
  storyIDs,
  validViewedStories,
  newlyClaimedStories,
  retainPendingStories,
  type StoryID,
} from "../stories/progress";
import type { Observation } from "./observations";
import { DEFAULT_TPS, validateTickRate } from "./tickRate";
import {
  districtSummary,
  projectFactory,
  type DistrictSummary,
  type WorldAction,
} from "./world";

export type EditorCommands = {
  placeBuilding: (
    factory: string,
    type: string,
    p: BuildingPlacement,
  ) => Promise<FactoryDetail>;
  updateBuilding: (
    factory: string,
    id: string,
    p: BuildingPlacement,
  ) => Promise<FactoryDetail>;
  deleteBuilding: (factory: string, id: string) => Promise<FactoryDetail>;
  getFactory: (factory: string, signal?: AbortSignal) => Promise<FactoryDetail>;
};
export type GameView = {
  tickRate?: number;
  developerToolsVisible?: boolean;
  viewedStories?: string[];
  pendingStories?: string[];
  questNotices?: { sequence: number; id: string }[];
  workshopBlocked?: boolean;
  observation?: Observation;
  ready: boolean;
  factory: LocalFactory | null;
  districts?: DistrictSummary[];
  error: string;
  message: string;
  online: boolean;
  conflict: boolean;
  uploading: boolean;
  localSavedAt: string | null;
  cloudSavedAt: string | null;
  dirty: boolean;
  paused: boolean;
};
type RequestCommand =
  | Omit<Extract<WorkerCommand, { kind: "create" }>, "request">
  | Omit<Extract<WorkerCommand, { kind: "edit" }>, "request">
  | Omit<Extract<WorkerCommand, { kind: "world" }>, "request">
  | Omit<Extract<WorkerCommand, { kind: "replace" }>, "request">;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";
const AUTO_UPLOAD = 30 * 60 * 1000;

// One runtime owns the worker, complete IndexedDB records and cloud lineage.
// Server responses may acknowledge a backup but never replace live state.
export class GameRuntime {
  readonly catalog = catalog;
  private view: GameView = {
    tickRate: DEFAULT_TPS,
    ready: false,
    factory: null,
    error: "",
    message: "正在读取本地存档并校验登录…",
    online: false,
    conflict: false,
    uploading: false,
    localSavedAt: null,
    cloudSavedAt: null,
    dirty: false,
    paused: true,
  };
  private record: LocalRecord;
  private sessionID = "";
  private deadline = 0;
  private disposed = false;
  private storageFailed = false;
  private fatal = false;
  private worker?: Worker;
  private releaseLock?: () => void;
  private writeTail: Promise<void> = Promise.resolve();
  private developerWriteTail: Promise<unknown> = Promise.resolve();
  private autoSaving = false;
  private autoRequested = false;
  private requestID = 0;
  private questNoticeSequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (factory: LocalFactory) => void;
      reject: (error: Error) => void;
      cloud?: CloudSave;
    }
  >();
  private timer?: ReturnType<typeof setTimeout>;
  private uploadTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTask?: Promise<void>;
  private controller = new AbortController();
  private cloud: CloudSave | null = null;
  private lastUpload = Date.now();
  private backupRetry = false;
  private changingSave = false;
  constructor(
    private user: User,
    private changed: (view: GameView) => void,
    private expired: () => void,
  ) {
    this.record = {
      owner: user.id,
      version: 1,
      save: null,
      cloudVersion: 0,
      cloudSavedAt: null,
      uploadedRevision: null,
      savedAt: new Date().toISOString(),
    };
  }
  private publish(patch: Partial<GameView> = {}) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    this.view.paused = !this.allowed();
    this.changed(this.view);
  }
  private signal() {
    return AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]);
  }
  private allowed() {
    return (
      !this.disposed &&
      this.view.ready &&
      this.view.online &&
      !document.hidden &&
      navigator.onLine &&
      !this.view.conflict &&
      !this.storageFailed &&
      !this.fatal &&
      !this.changingSave &&
      performance.now() < this.deadline
    );
  }
  private permit() {
    this.worker?.postMessage({
      kind: "permit",
      enabled: this.allowed(),
      validFor: Math.max(0, this.deadline - performance.now()),
      tickRate: this.view.tickRate ?? DEFAULT_TPS,
    } satisfies WorkerCommand);
  }
  private async lock() {
    if (!navigator.locks)
      throw new Error(
        "浏览器不支持安全的多标签页存档锁，请使用支持 Web Locks 的浏览器",
      );
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request(
          `bakafactory:game:${this.user.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (this.disposed) {
              resolve();
              return;
            }
            if (!lock) {
              reject(new Error("工厂已在另一个标签页运行，请关闭该页面后重试"));
              return;
            }
            await new Promise<void>((release) => {
              this.releaseLock = release;
              resolve();
            });
          },
        )
        .catch(reject);
    });
  }
  async start() {
    try {
      await this.lock();
      if (this.disposed) return;
      const local = await readLocal(this.user.id);
      if (this.disposed) return;
      if (local) {
        if (
          local.version !== 1 ||
          local.owner !== this.user.id ||
          (local.developerToolsVisible !== undefined &&
            typeof local.developerToolsVisible !== "boolean") ||
          !validViewedStories(local.viewedStories) ||
          !validViewedStories(local.pendingStories) ||
          !Number.isSafeInteger(local.cloudVersion) ||
          local.cloudVersion < 0 ||
          (local.uploadedRevision !== null &&
            (!Number.isSafeInteger(local.uploadedRevision) ||
              local.uploadedRevision < 0))
        )
          throw new Error("本地存档元数据无效，原数据已保留");
        if (local.save !== null) validateSave(local.save, this.user.id);
        this.record = local;
      }
      await this.heartbeat();
      if (this.disposed) return;
      if (!this.view.online)
        throw new Error("无法校验在线状态，请恢复网络后重试；本地存档已保留");
      this.cloud = await downloadSave(this.sessionID, this.signal());
      if (this.disposed) return;
      if (this.cloud) validateSave(this.cloud.save, this.user.id);
      const hasLocalSave = !!local?.save;
      if (!hasLocalSave && this.cloud) this.adoptCloud(this.cloud);
      const factory = this.record.save
        ? validateSave(this.record.save, this.user.id)
        : null;
      const conflict =
        hasLocalSave && (this.cloud?.version ?? 0) !== local!.cloudVersion;
      // Normalize historical acquisitions before the first Worker response so
      // loading an older save cannot announce recovered tasks as new events.
      if (factory) this.record.save = toSave(factory);
      this.record.pendingStories = retainPendingStories(
        this.record.pendingStories,
        this.record.viewedStories,
        factory?.simulation.industry?.quests?.claimed,
      );
      this.worker = new Worker(
        new URL("./simulation.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<WorkerEvent>) =>
        this.workerEvent(event.data);
      this.worker.onerror = () =>
        this.fail(new Error("本地模拟线程中断，请刷新页面恢复最近本地存档"));
      this.worker.postMessage({
        kind: "init",
        factory,
      } satisfies WorkerCommand);
      this.publish({
        ready: true,
        developerToolsVisible: this.record.developerToolsVisible === true,
        viewedStories: [...(this.record.viewedStories ?? [])],
        pendingStories: [...(this.record.pendingStories ?? [])],
        workshopBlocked: factory
          ? !workshopOutputFits(
              factory.simulation.industry,
              factory.simulation.warehouse,
            )
          : false,
        factory: factory ? projectFactory(factory) : null,
        districts: factory ? districtSummary(factory) : [],
        conflict,
        error: "",
        localSavedAt: local?.savedAt ?? null,
        cloudSavedAt: this.record.cloudSavedAt,
        dirty: !!factory && factory.revision !== this.record.uploadedRevision,
        message: conflict ? "发现另一设备上传的云存档，请选择保留的进度" : "",
      });
      await this.persist().catch(() => {});
      if (this.disposed) return;
      document.addEventListener("visibilitychange", this.visibility);
      window.addEventListener("offline", this.offline);
      window.addEventListener("online", this.online);
      window.addEventListener("pagehide", this.pagehide);
      this.permit();
      this.scheduleUpload();
      void navigator.storage?.persist?.().catch(() => false);
    } catch (error) {
      if (!this.disposed) {
        if (error instanceof ApiError && error.status === 401)
          this.sessionExpired();
        else this.publish({ error: messageOf(error) });
      }
    }
  }
  private adoptCloud(cloud: CloudSave) {
    const f = validateSave(cloud.save, this.user.id);
    this.record = {
      ...this.record,
      save: toSave(f),
      cloudVersion: cloud.version,
      cloudSavedAt: cloud.saved_at,
      uploadedRevision: f.revision,
    };
  }
  private fail(error: Error) {
    this.fatal = true;
    this.publish({ message: error.message });
    this.permit();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
  private sessionExpired() {
    this.publish({
      online: false,
      message: "账号已在另一端登录或会话已过期，工厂已暂停",
    });
    this.deadline = 0;
    this.permit();
    this.expired();
  }
  private workerEvent(event: WorkerEvent) {
    if (this.disposed) return;
    if (event.kind === "delta") {
      try {
        if (!this.record.save) throw new Error("本地完整快照尚未就绪");
        const root = applyWorldFrame(
          this.record.save.factory as LocalFactory,
          event.frame,
        );
        this.workerEvent({
          kind: "state",
          factory: projectFactory(root),
          root,
          districts: districtSummary(root),
          observation: event.observation,
        });
      } catch (error) {
        this.fail(
          error instanceof Error ? error : new Error("本地快照合并失败"),
        );
      }
      return;
    }
    const request =
      event.request === undefined ? undefined : this.pending.get(event.request);
    if (event.request !== undefined) this.pending.delete(event.request);
    if (event.kind === "error") {
      if (request) request.reject(new Error(event.message));
      else this.fail(new Error(event.message));
      return;
    }
    if (request?.cloud) this.adoptCloud(request.cloud);
    const claimed = event.factory.simulation?.industry?.quests?.claimed ?? [];
    const previousClaims =
      this.record.save?.factory.simulation?.industry?.quests?.claimed ?? [];
    this.record.pendingStories = request?.cloud
      ? retainPendingStories(
          this.record.pendingStories,
          this.record.viewedStories,
          claimed,
        )
      : [
          ...new Set([
            ...(this.record.pendingStories ?? []),
            ...(this.record.save
              ? newlyClaimedStories(
                  previousClaims,
                  claimed,
                  this.record.viewedStories,
                )
              : []),
          ]),
        ].slice(-1000);
    const previousQuests = new Set(
      this.record.save?.factory.simulation?.industry?.quests?.completed ?? [],
    );
    const newQuests =
      this.record.save && !request?.cloud
        ? (event.factory.simulation?.industry?.quests?.completed ?? []).filter(
            (id) => !previousQuests.has(id),
          )
        : [];
    const questNotices = request?.cloud
      ? []
      : [
          ...(this.view.questNotices ?? []),
          ...newQuests.map((id) => ({
            id,
            sequence: ++this.questNoticeSequence,
          })),
        ].slice(-20);
    this.record.save = toSave(event.root ?? event.factory);
    this.publish({
      questNotices,
      pendingStories: [...this.record.pendingStories],
      workshopBlocked: !workshopOutputFits(
        this.record.save.factory.simulation!.industry,
        this.record.save.factory.simulation!.warehouse,
      ),
      factory: event.factory,
      districts: event.districts,
      observation: event.observation,
      dirty: event.factory.revision !== this.record.uploadedRevision,
    });
    if (request)
      void this.persist().then(
        () => request.resolve(event.factory),
        (error) => request.reject(error),
      );
    else if (event.factory.simulation.tick % 5 === 0) this.persistAutomatic();
  }
  private persistAutomatic() {
    if (this.autoSaving) {
      this.autoRequested = true;
      return;
    }
    this.autoSaving = true;
    void this.persist()
      .catch(() => {})
      .finally(() => {
        this.autoSaving = false;
        const again = this.autoRequested;
        this.autoRequested = false;
        if (again && !this.disposed && !this.storageFailed)
          this.persistAutomatic();
      });
  }
  private command(
    command: RequestCommand,
    cloud?: CloudSave,
  ): Promise<LocalFactory> {
    if (!this.worker || this.disposed)
      return Promise.reject(new Error("本地工厂尚未就绪"));
    if (command.kind !== "replace" && !this.allowed())
      return Promise.reject(
        new Error("工厂已暂停，请先恢复连接或处理存档提示"),
      );
    return new Promise((resolve, reject) => {
      const request = ++this.requestID;
      this.pending.set(request, { resolve, reject, cloud });
      this.worker!.postMessage({ ...command, request } satisfies WorkerCommand);
    });
  }
  readonly act = (action: IndustryAction) =>
    this.command({
      kind: "edit",
      factoryID: this.view.factory?.id,
      edit: { kind: "industry", action },
    });
  readonly world = (action: WorldAction) =>
    this.command({ kind: "world", action });
  async markStoryViewed(id: StoryID) {
    if (this.disposed || !this.view.ready)
      throw new Error("游戏尚未就绪，请稍后重试");
    if (!storyIDs.includes(id)) throw new Error("未知剧情");
    const viewed = [...new Set([...(this.record.viewedStories ?? []), id])];
    if (!validViewedStories(viewed)) throw new Error("剧情观看记录已达到上限");
    this.record.viewedStories = viewed;
    // This can be committed before a factory exists, using the same owner key
    // and write queue as all later local saves. It never changes the world.
    await this.persist({
      pendingStories: (this.record.pendingStories ?? []).filter(
        (pending) => !viewed.includes(pending),
      ),
    });
    this.record.pendingStories = (this.record.pendingStories ?? []).filter(
      (pending) => !this.record.viewedStories!.includes(pending),
    );
    this.storageFailed = false;
    this.publish({
      viewedStories: [...this.record.viewedStories],
      pendingStories: [...this.record.pendingStories],
      ...(this.view.message.startsWith("本地保存失败") ? { message: "" } : {}),
    });
    this.permit();
  }
  get developerToolsVisible() {
    return !this.disposed && this.view.developerToolsVisible === true;
  }
  readonly setTickRate = (value: number) => {
    const tickRate = validateTickRate(value);
    if (!this.developerToolsVisible || !this.allowed() || !this.view.factory)
      throw new Error("请在工厂在线运行时打开开发者工具后调整 TPS");
    this.publish({ tickRate });
    this.permit();
  };
  setDeveloperToolsVisible(enabled: boolean): Promise<boolean> {
    const task = this.developerWriteTail
      .catch(() => {})
      .then(async () => {
        if (this.disposed || !this.view.ready)
          throw new Error("游戏尚未就绪，请登录并等待本地存档加载完成");
        if (typeof enabled !== "boolean")
          throw new Error(
            "请使用 bakaFactory.devTools(true) 或 bakaFactory.devTools(false)",
          );
        // Set before enqueueing the snapshot so later tick saves retain it.
        this.record.developerToolsVisible = enabled;
        await this.persist();
        this.storageFailed = false;
        this.publish({
          developerToolsVisible: enabled,
          ...(!enabled ? { tickRate: DEFAULT_TPS } : {}),
          ...(this.view.message.startsWith("本地保存失败")
            ? { message: "" }
            : {}),
        });
        this.permit();
        return enabled;
      });
    this.developerWriteTail = task;
    return task;
  }
  readonly robotRoute = (id: string) =>
    this.record.save
      ? previewRobotRoute(this.record.save.factory as LocalFactory, id)
      : undefined;
  private persist(
    storyPatch: Pick<Partial<LocalRecord>, "pendingStories"> = {},
  ): Promise<void> {
    const record = structuredClone({
      ...this.record,
      ...storyPatch,
      savedAt: new Date().toISOString(),
    });
    const task = this.writeTail.catch(() => {}).then(() => writeLocal(record));
    this.writeTail = task;
    return task.then(
      () => {
        this.record.savedAt = record.savedAt;
        this.publish({ localSavedAt: record.savedAt });
      },
      (error) => {
        this.storageFailed = true;
        this.publish({
          message: `本地保存失败，工厂已暂停：${messageOf(error)}`,
        });
        this.permit();
        throw error instanceof Error ? error : new Error(messageOf(error));
      },
    );
  }
  async retryStorage() {
    if (this.fatal)
      throw new Error("本地模拟已中断，请刷新页面恢复最近本地存档");
    await this.persist();
    this.storageFailed = false;
    this.publish({
      message: "",
      developerToolsVisible: this.record.developerToolsVisible === true,
    });
    this.permit();
  }
  private async heartbeat() {
    if (this.heartbeatTask) return this.heartbeatTask;
    this.heartbeatTask = this.performHeartbeat();
    try {
      await this.heartbeatTask;
    } finally {
      this.heartbeatTask = undefined;
    }
  }
  private async performHeartbeat() {
    const started = performance.now();
    try {
      const response = await gameHeartbeat(this.sessionID, this.signal());
      if (this.disposed) return;
      if (response.user.id !== this.user.id) {
        this.sessionExpired();
        return;
      }
      this.sessionID = response.session_id;
      this.deadline = started + Math.min(30, response.lease_seconds) * 1000;
      this.publish({
        online: true,
        message:
          this.storageFailed || this.fatal || this.view.conflict
            ? this.view.message
            : document.hidden
              ? "后台暂停，返回游戏后继续"
              : "",
      });
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && error.status === 401) {
        this.sessionExpired();
        return;
      }
      this.deadline = 0;
      this.publish({
        online: false,
        message: "连接中断，工厂已暂停；恢复联网后继续，不补算暂停时间",
      });
    } finally {
      this.permit();
      clearTimeout(this.timer);
      if (!this.disposed)
        this.timer = setTimeout(() => void this.heartbeat(), 10000);
    }
  }
  private visibility = () => {
    if (document.hidden) {
      this.publish({ message: "后台暂停，返回游戏后继续" });
      this.permit();
      void this.persist().catch(() => {});
    } else {
      this.deadline = 0;
      this.publish({ online: false });
      this.permit();
      void this.heartbeat();
    }
  };
  private offline = () => {
    this.deadline = 0;
    this.publish({ online: false, message: "网络已断开，工厂已暂停" });
    this.permit();
  };
  private online = () => {
    void this.heartbeat();
  };
  private pagehide = () => {
    this.deadline = 0;
    this.permit();
    void this.persist().catch(() => {});
  };
  private scheduleUpload() {
    clearTimeout(this.uploadTimer);
    if (this.disposed) return;
    this.uploadTimer = setTimeout(async () => {
      if (
        (this.backupRetry || Date.now() - this.lastUpload >= AUTO_UPLOAD) &&
        this.view.dirty &&
        this.allowed()
      ) {
        try {
          await this.backup();
        } catch {
          /* Status is shown; retry in one minute. */
        }
      }
      this.scheduleUpload();
    }, 60000);
  }
  async backup() {
    if (this.view.uploading) return;
    if (!this.allowed() || !this.view.factory)
      throw new Error("请恢复在线连接并处理存档提示后再上传");
    this.publish({ uploading: true });
    const save = structuredClone(this.record.save!);
    try {
      await this.persist();
      const cloud = await uploadSave(
        this.sessionID,
        this.record.cloudVersion,
        save,
        this.signal(),
      );
      if (this.disposed) return;
      this.cloud = cloud;
      this.lastUpload = Date.now();
      this.backupRetry = false;
      this.record.cloudVersion = cloud.version;
      this.record.cloudSavedAt = cloud.saved_at;
      this.record.uploadedRevision = save.factory.revision!;
      await this.persist();
      this.publish({
        cloudSavedAt: cloud.saved_at,
        dirty: this.view.factory?.revision !== save.factory.revision,
        message: "云存档已覆盖保存",
      });
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && error.status === 401)
        this.sessionExpired();
      else if (error instanceof ApiError && error.status === 409) {
        this.publish({
          conflict: true,
          message: "云存档已更新，请选择要保留的进度",
        });
        this.permit();
      } else {
        this.backupRetry = true;
        this.publish({
          message: `云备份失败，本地进度已保留：${messageOf(error)}`,
        });
      }
      throw error;
    } finally {
      this.publish({ uploading: false });
    }
  }
  async chooseLocal() {
    if (
      !this.view.online ||
      this.view.uploading ||
      this.changingSave ||
      this.disposed
    )
      throw new Error("请等待当前存档操作完成并保持联网");
    this.changingSave = true;
    this.publish({ uploading: true });
    this.permit();
    try {
      this.cloud = await downloadSave(this.sessionID, this.signal());
      if (this.disposed) return;
      this.record.cloudVersion = this.cloud?.version ?? 0;
      await this.persist();
      this.publish({ conflict: false, message: "保留本机进度" });
    } finally {
      this.changingSave = false;
      this.publish({ uploading: false });
      this.permit();
    }
    if (this.view.factory) await this.backup();
  }
  async restoreCloud() {
    if (
      !this.view.online ||
      this.view.uploading ||
      this.changingSave ||
      this.disposed
    )
      throw new Error("请等待当前存档操作完成并保持联网");
    this.changingSave = true;
    this.publish({ uploading: true });
    this.permit();
    try {
      const cloud = await downloadSave(this.sessionID, this.signal());
      if (this.disposed) return;
      if (!cloud) throw new Error("该账号尚未上传云存档，请保留本机进度");
      this.cloud = cloud;
      const factory = await this.command(
        {
          kind: "replace",
          factory: validateSave(cloud.save, this.user.id),
        },
        cloud,
      );
      this.publish({
        factory,
        conflict: false,
        dirty: false,
        cloudSavedAt: cloud.saved_at,
        message: "已恢复云存档，暂停期间没有补算",
      });
    } finally {
      this.changingSave = false;
      this.publish({ uploading: false });
      this.permit();
    }
  }
  create = (name: string) =>
    this.command({ kind: "create", user: this.user, name });
  readonly commands: EditorCommands = {
    placeBuilding: (factoryID, type, placement) =>
      this.command({
        kind: "edit",
        factoryID,
        edit: {
          kind: "place",
          building_type: type,
          placement,
          id: crypto.randomUUID(),
        },
      }),
    updateBuilding: (factoryID, id, placement) =>
      this.command({
        kind: "edit",
        factoryID,
        edit: { kind: "move", id, placement },
      }),
    deleteBuilding: (factoryID, id) =>
      this.command({ kind: "edit", factoryID, edit: { kind: "delete", id } }),
    getFactory: async () => {
      if (!this.view.factory) throw new Error("请先创建工厂");
      return structuredClone(this.view.factory);
    },
  };
  close(): Promise<void> {
    if (this.disposed) return this.writeTail.catch(() => {});
    this.worker?.terminate();
    if (this.view.ready) void this.persist().catch(() => {});
    this.disposed = true;
    this.controller.abort();
    clearTimeout(this.timer);
    clearTimeout(this.uploadTimer);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
    window.removeEventListener("pagehide", this.pagehide);
    for (const request of this.pending.values())
      request.reject(new Error("游戏已关闭"));
    this.pending.clear();
    // Don't let a new tab read before the old tab's final queued write settles.
    return this.writeTail
      .catch(() => {})
      .finally(() => {
        this.releaseLock?.();
        this.releaseLock = undefined;
      });
  }
}
