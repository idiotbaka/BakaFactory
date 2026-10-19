export type AnimationFrame = { now: number; phase: number; stepMs: number };
type Listener = (frame: AnimationFrame) => boolean | void;

// One RAF for every visual, without rerendering the React grid each frame.
export class AnimationClock {
  private listeners = new Set<Listener>();
  private handle: number | null = null;
  private key: string | null = null;
  private startedAt = 0;
  private stepMs = 1000;
  private frameInterval = 1000 / 60;
  private lastPaint = -Infinity;
  setPowerSaving(enabled: boolean) {
    this.frameInterval = 1000 / (enabled ? 15 : 60);
    this.lastPaint = -Infinity;
    this.requestFrame();
  }
  frame(now = performance.now()): AnimationFrame {
    return {
      now,
      phase:
        this.key === null
          ? 0
          : Math.min(1, Math.max(0, (now - this.startedAt) / this.stepMs)),
      stepMs: this.stepMs,
    };
  }
  sync(factoryID: string | undefined, tick: number | undefined) {
    if (!factoryID || tick === undefined) {
      this.key = null;
      this.pause();
      return;
    }
    const key = `${factoryID}:${tick}`;
    if (key !== this.key) {
      this.key = key;
      this.startedAt = performance.now();
    }
    // An edit or repeated read of the same tick must not rewind animations.
    this.wake();
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.frame());
    this.schedule();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.pause();
    };
  }
  wake() {
    this.lastPaint = -Infinity;
    this.paint(performance.now());
  }
  requestFrame() {
    this.schedule();
  }
  pause() {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }
  dispose() {
    this.pause();
    this.listeners.clear();
  }
  private schedule() {
    if (
      this.handle !== null ||
      this.key === null ||
      !this.listeners.size ||
      document.hidden ||
      typeof requestAnimationFrame !== "function"
    )
      return;
    this.handle = requestAnimationFrame((now) => {
      this.handle = null;
      this.paint(now);
    });
  }
  private paint(now: number) {
    if (document.hidden) {
      this.pause();
      return;
    }
    // Cap DOM writes even on high-refresh displays. A small tolerance avoids
    // halving the frame rate because of fractional 60 Hz timestamps.
    const elapsed = now - this.lastPaint;
    if (elapsed + 1 < this.frameInterval) {
      this.schedule();
      return;
    }
    this.lastPaint =
      Number.isFinite(elapsed) && elapsed >= this.frameInterval
        ? now - (elapsed % this.frameInterval)
        : now;
    const frame = this.frame(now);
    let moving = false;
    for (const listener of this.listeners) {
      if (listener(frame)) moving = true;
    }
    // Stop at the bounded prediction horizon, or once reconciliation finishes.
    if (moving) this.schedule();
  }
}
