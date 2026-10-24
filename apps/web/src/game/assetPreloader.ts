export type GameAsset = Readonly<{ url: string; kind: "font" | "image" }>;
export type AssetProgress = Readonly<{
  phase: "idle" | "loading" | "ready" | "failed";
  completed: number;
  total: number;
  failed: number;
}>;

/** Shared, bounded preload queue. Successful decoded assets survive retries. */
export class AssetPreloader {
  private readonly assets: GameAsset[];
  private readonly loaded = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private running?: Promise<void>;
  private progress: AssetProgress;

  constructor(
    assets: readonly GameAsset[],
    private readonly load: (asset: GameAsset) => Promise<unknown>,
    private readonly concurrency = 8,
  ) {
    this.assets = [
      ...new Map(assets.map((asset) => [asset.url, asset])).values(),
    ];
    this.progress = {
      phase: "idle",
      completed: 0,
      total: this.assets.length,
      failed: 0,
    };
  }
  getSnapshot = (): AssetProgress => this.progress;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(phase: AssetProgress["phase"], failed: number) {
    this.progress = {
      phase,
      completed: this.loaded.size,
      total: this.assets.length,
      failed,
    };
    this.listeners.forEach((listener) => listener());
  }
  start(): Promise<void> {
    if (this.running) return this.running;
    if (this.progress.phase === "ready") return Promise.resolve();
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    const pending = this.assets.filter((asset) => !this.loaded.has(asset.url));
    let index = 0,
      failed = 0;
    this.publish("loading", 0);
    const worker = async () => {
      while (index < pending.length) {
        const asset = pending[index++];
        try {
          // Keep Image / FontFace references, as well as the browser URL cache.
          this.loaded.set(asset.url, await this.load(asset));
        } catch {
          failed++;
        }
        this.publish("loading", failed);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(pending.length, Math.max(1, this.concurrency)) },
        worker,
      ),
    );
    this.publish(failed ? "failed" : "ready", failed);
  }
}
