import { AutoPlay, UniPackData } from './types';

export interface AutoPlayListener {
  onStart(): void;
  onPadTouchOn(x: number, y: number): void;
  onPadTouchOff(x: number, y: number): void;
  onChainChange(c: number): void;
  onGuidePadOn(x: number, y: number, targetWallTimeMs: number): void;
  onGuidePadOff(x: number, y: number): void;
  onGuideLedUpdate(x: number, y: number, velocity: number): void;
  onGuideChainOn(c: number): void;
  onRemoveGuide(): void;
  onProgressUpdate(progress: number): void;
  onEnd(): void;
}

interface GuideEvent {
  timeMs: number;
  x: number;
  y: number;
  chain: number;
}

const GUIDE_LOOKAHEAD_MS = 800;
const GUIDE_LED_UPDATE_INTERVAL_MS = 50;
const GUIDE_VELOCITIES = [1, 2, 3, 21];

export class AutoPlayRunner {
  private unipack: UniPackData;
  private listener: AutoPlayListener;
  private chainValue: () => number;
  private soundPushToNum: (c: number, x: number, y: number, num: number) => void;
  private ledPushToNum: (c: number, x: number, y: number, num: number) => void;

  playmode = true;
  beforeStartPlaying = true;
  practiceGuide = false;
  progress = 0;

  private rafId: number | null = null;
  active = false;

  private guideTimeline: GuideEvent[] = [];
  private guideIndex = 0;
  private waitingForChain = -1;
  private waitStartTime = 0;
  private activeGuides = new Map<number, number>();
  private lastGuideUpdateMs = 0;

  private delayAccum = 0;
  private startTime = 0;

  constructor(
    unipack: UniPackData,
    listener: AutoPlayListener,
    chainValue: () => number,
    _setChain: (c: number) => void,
    soundPushToNum: (c: number, x: number, y: number, num: number) => void,
    ledPushToNum: (c: number, x: number, y: number, num: number) => void,
  ) {
    this.unipack = unipack;
    this.listener = listener;
    this.chainValue = chainValue;
    this.soundPushToNum = soundPushToNum;
    this.ledPushToNum = ledPushToNum;
  }

  private guideKey(x: number, y: number): number {
    return x * 256 + y;
  }

  private buildGuideTimeline(autoPlay: AutoPlay): GuideEvent[] {
    const events: GuideEvent[] = [];
    let time = 0;
    for (const element of autoPlay.elements) {
      if (element.type === 'delay') {
        time += element.delay;
      } else if (element.type === 'on') {
        events.push({ timeMs: time, x: element.x, y: element.y, chain: element.currChain });
      }
    }
    return events;
  }

  launch(): void {
    if (this.active) return;
    this.active = true;
    this.progress = 0;
    this.listener.onProgressUpdate(this.progress);
    this.listener.onStart();

    const autoPlay = this.unipack.autoPlay;
    if (!autoPlay) {
      this.active = false;
      return;
    }

    if (this.practiceGuide) {
      this.guideTimeline = this.buildGuideTimeline(autoPlay);
      this.guideIndex = 0;
      this.waitingForChain = -1;
      this.activeGuides.clear();
    }

    this.delayAccum = 0;
    this.startTime = performance.now();
    let prevPracticeGuide = this.practiceGuide;

    const loop = (): void => {
      if (!this.active) return;

      const currTime = performance.now();

      // Detect practice mode toggle
      if (this.practiceGuide !== prevPracticeGuide) {
        if (this.practiceGuide) {
          this.guideTimeline = this.buildGuideTimeline(autoPlay);
          const elapsed = currTime - this.startTime;
          const idx = this.guideTimeline.findIndex((e) => e.timeMs > elapsed - GUIDE_LOOKAHEAD_MS);
          this.guideIndex = idx < 0 ? this.guideTimeline.length : idx;
          this.waitingForChain = -1;
          this.activeGuides.clear();
        } else {
          this.activeGuides.forEach((_val, key) => {
            this.listener.onGuideLedUpdate(Math.floor(key / 256), key % 256, 0);
          });
          this.activeGuides.clear();
          this.guideTimeline = [];
          this.waitingForChain = -1;
          this.listener.onRemoveGuide();
        }
        prevPracticeGuide = this.practiceGuide;
      }

      if (this.playmode) {
        if (this.practiceGuide && this.waitingForChain >= 0) {
          if (this.chainValue() === this.waitingForChain) {
            this.startTime += currTime - this.waitStartTime;
            this.waitingForChain = -1;
            this.listener.onRemoveGuide();
          } else {
            if (this.delayAccum <= currTime - this.startTime) {
              this.delayAccum = currTime - this.startTime;
            }
          }
        } else {
          this.doBeforeStartPlaying();

          // Guide lookahead
          if (this.practiceGuide) {
            const elapsed = currTime - this.startTime;
            while (this.guideIndex < this.guideTimeline.length) {
              const event = this.guideTimeline[this.guideIndex];
              if (event.timeMs <= elapsed + GUIDE_LOOKAHEAD_MS) {
                if (event.chain !== this.chainValue()) {
                  this.waitingForChain = event.chain;
                  this.waitStartTime = currTime;
                  this.activeGuides.forEach((_val, key) => {
                    this.listener.onGuideLedUpdate(Math.floor(key / 256), key % 256, 0);
                  });
                  this.activeGuides.clear();
                  this.listener.onRemoveGuide();
                  this.listener.onGuideChainOn(event.chain);
                  break;
                }
                const targetWallTimeMs = this.startTime + event.timeMs;
                this.activeGuides.set(this.guideKey(event.x, event.y), targetWallTimeMs);
                this.listener.onGuidePadOn(event.x, event.y, targetWallTimeMs);
                this.guideIndex++;
              } else {
                break;
              }
            }

            // Guide expiration + LED brightness
            if (this.activeGuides.size > 0) {
              const throttle = currTime - this.lastGuideUpdateMs >= GUIDE_LED_UPDATE_INTERVAL_MS;
              const toRemove: number[] = [];
              this.activeGuides.forEach((targetMs, key) => {
                const gx = Math.floor(key / 256);
                const gy = key % 256;
                if (currTime >= targetMs) {
                  toRemove.push(key);
                  this.listener.onGuideLedUpdate(gx, gy, 0);
                  this.listener.onGuidePadOff(gx, gy);
                } else if (throttle) {
                  const remaining = targetMs - currTime;
                  const p = Math.min(1, Math.max(0, 1 - remaining / GUIDE_LOOKAHEAD_MS));
                  const idx = Math.min(GUIDE_VELOCITIES.length - 1, Math.max(0, Math.floor(p * GUIDE_VELOCITIES.length)));
                  this.listener.onGuideLedUpdate(gx, gy, GUIDE_VELOCITIES[idx]);
                }
              });
              for (const key of toRemove) {
                this.activeGuides.delete(key);
              }
              if (throttle) this.lastGuideUpdateMs = currTime;
            }
          }

          while (
            this.waitingForChain < 0 &&
            this.delayAccum <= currTime - this.startTime &&
            this.progress < autoPlay.elements.length
          ) {
            const element = autoPlay.elements[this.progress];
            switch (element.type) {
              case 'on':
                if (!this.practiceGuide) {
                  if (this.chainValue() !== element.currChain) {
                    this.listener.onChainChange(element.currChain);
                  }
                  this.soundPushToNum(element.currChain, element.x, element.y, element.num);
                  this.ledPushToNum(element.currChain, element.x, element.y, element.num);
                  this.listener.onPadTouchOn(element.x, element.y);
                }
                break;
              case 'off':
                if (!this.practiceGuide) {
                  if (this.chainValue() !== element.currChain) {
                    this.listener.onChainChange(element.currChain);
                  }
                  this.listener.onPadTouchOff(element.x, element.y);
                }
                break;
              case 'delay':
                this.delayAccum += element.delay;
                break;
              case 'chain':
                if (!this.practiceGuide) {
                  this.listener.onChainChange(element.c);
                }
                break;
            }
            this.progress++;
            this.listener.onProgressUpdate(this.progress);
          }
        }
      } else {
        this.beforeStartPlaying = true;
        if (this.delayAccum <= currTime - this.startTime) {
          this.delayAccum = currTime - this.startTime;
        }
      }

      if (this.progress < autoPlay.elements.length) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.active = false;
        this.rafId = null;
        this.listener.onEnd();
      }
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.activeGuides.clear();
  }

  play(): void {
    this.playmode = true;
  }

  pause(): void {
    this.playmode = false;
  }

  get isPlaying(): boolean {
    return this.playmode;
  }

  progressOffset(offset: number): void {
    const autoPlay = this.unipack.autoPlay;
    const max = autoPlay ? autoPlay.elements.length : 0;
    const target = this.progress + offset;
    this.progress = Math.max(0, Math.min(max, target));
    this.listener.onProgressUpdate(this.progress);
  }

  private doBeforeStartPlaying(): void {
    if (this.beforeStartPlaying) {
      this.beforeStartPlaying = false;
      this.listener.onRemoveGuide();
    }
  }
}
