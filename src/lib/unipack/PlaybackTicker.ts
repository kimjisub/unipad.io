/** Runs queued playback callbacks in one browser task, with sound before its lights. Each runner
 *  still owns its clock, visibility and lifecycle. Manual lights also work without autoplay. */
export class PlaybackTicker {
  private callbacks = new Map<number, { run: () => void; priority: number }>();
  private nextId = 0;
  private timer: number | null = null;
  private timerAt = Infinity;
  private dispatching = false;
  private nextDelay = Infinity;

  request(run: () => void, delay: number, priority: number): number {
    const id = ++this.nextId;
    this.callbacks.set(id, { run, priority });
    if (this.dispatching) this.nextDelay = Math.min(this.nextDelay, delay);
    else this.arm(delay);
    return id;
  }

  cancel(id: number): void {
    this.callbacks.delete(id);
    if (this.callbacks.size === 0 && this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = Infinity;
    }
  }

  private arm(delay: number): void {
    const at = performance.now() + delay;
    if (this.timer !== null && this.timerAt <= at) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = window.setTimeout(this.tick, delay);
  }

  private tick = (): void => {
    this.timer = null;
    this.timerAt = Infinity;
    this.dispatching = true;
    this.nextDelay = Infinity;
    try {
      const ready = [...this.callbacks].sort((a, b) => a[1].priority - b[1].priority);
      for (const [id, callback] of ready) {
        if (!this.callbacks.delete(id)) continue;
        try {
          callback.run();
        } catch (error) {
          // Preserve independent-runner error reporting without starving the other runner.
          queueMicrotask(() => { throw error; });
        }
      }
    } finally {
      this.dispatching = false;
      if (this.callbacks.size > 0) this.arm(this.nextDelay);
    }
  };
}
