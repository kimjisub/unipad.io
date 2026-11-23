/** Shorter preparations start without a notice, so a quick start does not flash one. */
export const AUDIO_START_NOTICE_DELAY_MS = 300;
/** A preparation that has not finished by then no longer starts playback. */
export const AUDIO_START_LIMIT_MS = 5000;

/** What the player asked to start: a play mode, or Play on the paused or interrupted song. */
export type AudioStartIntent = { kind: 'mode'; mode: 'autoPlay' | 'guidePlay' | 'stepPractice' } | { kind: 'resume' };

export type AudioStartPhase = 'preparing' | 'failed' | 'delayed';

export interface AudioStartNotice {
  phase: AudioStartPhase;
  /** A preparation started by Try again from the notice. */
  retry: boolean;
  /** The notice is on screen and holds the player's input. */
  visible: boolean;
  intent: AudioStartIntent;
}

export function sameIntent(a: AudioStartIntent, b: AudioStartIntent): boolean {
  return a.kind === b.kind && (a.kind === 'resume' || a.mode === (b as typeof a).mode);
}

export interface AudioStartHost {
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  /** Asks the browser to run the audio output; true once it runs for this request. */
  activate(): Promise<boolean>;
  /** Starts what the player asked for. Called once per preparation that finished in time. */
  commit(intent: AudioStartIntent): void;
  /** The notice is about to appear: hold the player's input and release what it holds. */
  shown(): void;
  /** Stops output after a preparation that failed, expired or was cancelled. */
  halt(): void;
  update(notice: AudioStartNotice | null): void;
}

/**
 * One audio preparation per start the player asks for. Only the newest request may start playback,
 * and only before its limit: replies to cancelled, expired or replaced requests change nothing.
 */
export class AudioStartRequests {
  private serial = 0;
  /** The request whose reply may still start playback. */
  private current: number | null = null;
  private startedAt = 0;
  private notice: AudioStartNotice | null = null;
  private timers: unknown[] = [];

  constructor(private readonly host: AudioStartHost) {}

  /** The notice is on screen. */
  get blocking(): boolean {
    return this.notice?.visible ?? false;
  }

  /** A start was asked for and has not finished, failed or been dismissed. */
  get active(): boolean {
    return this.notice !== null;
  }

  request(intent: AudioStartIntent): void {
    const notice = this.notice;
    if (notice) {
      // Only the notice's own buttons act while it is shown; a repeated start keeps the waiting request.
      if (notice.visible || sameIntent(notice.intent, intent)) return;
      this.end();
    }
    this.begin(intent, false);
  }

  /** Try again from a failed or expired notice. */
  retry(): void {
    const notice = this.notice;
    if (!notice || notice.phase === 'preparing') return;
    this.begin(notice.intent, true);
  }

  /** Cancel, Dismiss or Escape: nothing the request asked for starts. */
  cancel(): void {
    if (!this.notice) return;
    this.end();
    this.host.halt();
    this.host.update(null);
  }

  /** Something else (a hidden page, another dialog, leaving the pack) already stopped playback. */
  abandon(): void {
    if (!this.notice) return;
    this.end();
    this.host.update(null);
  }

  private begin(intent: AudioStartIntent, retry: boolean): void {
    this.clearTimers();
    const id = ++this.serial;
    this.current = id;
    this.startedAt = this.host.now();
    this.notice = { phase: 'preparing', retry, visible: retry, intent };
    if (!retry) {
      this.timers.push(this.host.setTimer(() => {
        if (this.current !== id || !this.notice || this.notice.visible) return;
        this.show({ ...this.notice, visible: true });
      }, AUDIO_START_NOTICE_DELAY_MS));
    }
    this.timers.push(this.host.setTimer(() => this.expire(id), AUDIO_START_LIMIT_MS));
    this.host.update(this.notice);
    this.host.activate().then(ready => this.settle(id, ready), () => this.settle(id, false));
  }

  private settle(id: number, ready: boolean): void {
    if (this.current !== id || !this.notice) return;
    // A reply after the limit (a stalled tab included) is late even if its timer has not run yet.
    if (this.host.now() - this.startedAt >= AUDIO_START_LIMIT_MS) {
      this.expire(id);
      return;
    }
    if (!ready) {
      this.stop({ ...this.notice, phase: 'failed', retry: false, visible: true });
      return;
    }
    const { intent } = this.notice;
    this.end();
    this.host.update(null);
    this.host.commit(intent);
  }

  private expire(id: number): void {
    if (this.current !== id || !this.notice) return;
    this.stop({ ...this.notice, phase: 'delayed', retry: false, visible: true });
  }

  /** Ends the request with a notice that offers Try again. */
  private stop(notice: AudioStartNotice): void {
    const wasVisible = this.notice?.visible ?? false;
    this.current = null;
    this.clearTimers();
    this.notice = notice;
    if (!wasVisible) this.host.shown();
    this.host.halt();
    this.host.update(notice);
  }

  private show(notice: AudioStartNotice): void {
    this.notice = notice;
    this.host.shown();
    this.host.update(notice);
  }

  private end(): void {
    this.current = null;
    this.notice = null;
    this.clearTimers();
  }

  private clearTimers(): void {
    for (const timer of this.timers) this.host.clearTimer(timer);
    this.timers = [];
  }
}
