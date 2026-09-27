/**
 * Core usage events shared with the Android and iOS players (analytics standard, T-0009):
 * they tell a visit to the play screen apart from actually loading and playing a pack.
 *
 * Only categorical values leave the browser: pack titles, file names, URLs, store codes,
 * device names and identifiers are never passed as parameters.
 */
export const UsageEvent = {
  packLoad: 'pack_load',
  padPress: 'pad_press',
  autoplayStart: 'autoplay_start',
} as const;

export type UsageEventName = (typeof UsageEvent)[keyof typeof UsageEvent];

export const UsageParam = {
  result: 'result',
} as const;

export type UsageResult = 'success' | 'failure';

export type UsageParams = Partial<Record<(typeof UsageParam)[keyof typeof UsageParam], UsageResult>>;

export type UsageEventSink = (name: UsageEventName, params?: UsageParams) => void;

/**
 * Tracks one loaded pack and emits its events at most once:
 *
 * - `pack_load`: when a pack finished loading (`success`) or failed to load (`failure`).
 * - `pad_press`: on the first pad pressed by the player (touch, keyboard or MIDI) after a load.
 * - `autoplay_start`: the first time autoplay is started after a load.
 *
 * Presses and autoplay before a successful load or after unloading are ignored, so each count is
 * a reach per loaded pack rather than an input volume.
 */
export class PlayUsageTracker {
  private sessionActive = false;
  private padPressLogged = false;
  private autoplayStartLogged = false;
  private readonly sink: UsageEventSink;

  constructor(sink: UsageEventSink) {
    this.sink = sink;
  }

  packLoadSucceeded(): void {
    this.startSession(true);
    this.sink(UsageEvent.packLoad, { [UsageParam.result]: 'success' });
  }

  packLoadFailed(): void {
    this.startSession(false);
    this.sink(UsageEvent.packLoad, { [UsageParam.result]: 'failure' });
  }

  padPressed(): void {
    if (!this.sessionActive || this.padPressLogged) return;
    this.padPressLogged = true;
    this.sink(UsageEvent.padPress);
  }

  autoplayStarted(): void {
    if (!this.sessionActive || this.autoplayStartLogged) return;
    this.autoplayStartLogged = true;
    this.sink(UsageEvent.autoplayStart);
  }

  unloaded(): void {
    this.startSession(false);
  }

  private startSession(active: boolean): void {
    this.sessionActive = active;
    this.padPressLogged = false;
    this.autoplayStartLogged = false;
  }
}
