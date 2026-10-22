import { LedAnimation, LedEvent, UniPackData } from './types';

interface Led {
  buttonX: number;
  buttonY: number;
  chain: number;
}

interface LedAnimationState {
  buttonX: number;
  buttonY: number;
  chainAtCreation: number;
  index: number;
  delay: number;
  isPlaying: boolean;
  startedAt: number;
  order: number;
  shutdownAt: number | null;
  shutdownOrder: number;
  finishedAt: number | null;
  passStart: number;
  processed: number;
  remove: boolean;
  loopProgress: number;
  ledAnimation: LedAnimation | null;
}

export interface LedRunnerListener {
  onPadLedTurnOn(x: number, y: number, color: number, velocity: number): void;
  onPadLedTurnOff(x: number, y: number): void;
  onChainLedTurnOn(c: number, color: number, velocity: number): void;
  onChainLedTurnOff(c: number): void;
}

const LOOP_INTERVAL_MS = 4;
// Autoplay can deliver a scheduled press after the animation's last step already ran.
const LATE_PRESS_MS = 1000;

interface Step {
  state: LedAnimationState;
  at: number;
  rank: number;
  order: number;
  shutdown: boolean;
}

const compareSteps = (a: Step, b: Step) => a.at - b.at || a.rank - b.rank || a.order - b.order;

/** A tick's next steps, earliest first, without repeatedly sorting the whole backlog. */
class DueSteps {
  private heap: Step[] = [];

  push(step: Step | null): void {
    if (!step) return;
    let i = this.heap.length;
    this.heap.push(step);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareSteps(this.heap[parent], step) <= 0) break;
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = step;
  }

  pop(): Step | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (last && this.heap.length > 0) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.heap.length && compareSteps(this.heap[child + 1], this.heap[child]) < 0) child++;
        if (compareSteps(last, this.heap[child]) <= 0) break;
        this.heap[i] = this.heap[child];
        i = child;
      }
      this.heap[i] = last;
    }
    return first;
  }
}

export class LedRunner {
  private unipack: UniPackData;
  private listener: LedRunnerListener;
  private chainValue: () => number;
  private setChain: (c: number) => void;

  private btnLed: (Led | null)[][];
  private cirLed: (Led | null)[];
  private ledAnimationStates: LedAnimationState[] = [];
  private ledAnimationStatesAdd: LedAnimationState[] = [];

  private rafId: number | null = null;
  private requests = 0;

  active = false;

  constructor(
    unipack: UniPackData,
    listener: LedRunnerListener,
    chainValue: () => number,
    setChain: (c: number) => void,
  ) {
    this.unipack = unipack;
    this.listener = listener;
    this.chainValue = chainValue;
    this.setChain = setChain;

    this.btnLed = Array.from({ length: unipack.info.buttonX }, () =>
      Array.from({ length: unipack.info.buttonY }, () => null),
    );
    this.cirLed = Array.from({ length: 36 }, () => null);
  }

  private loop = (): void => {
    if (!this.active) return;

    const currTime = performance.now();

    for (const state of this.ledAnimationStatesAdd) this.ledAnimationStates.push(state);
    this.ledAnimationStatesAdd.length = 0;
    const due = new DueSteps();
    for (const state of this.ledAnimationStates) {
      state.processed = 0;
      due.push(this.nextStep(state, currTime));
    }
    for (let step = due.pop(); step; step = due.pop()) {
      const state = step.state;
      if (step.shutdown) {
        this.cleanupState(state);
        state.remove = true;
      } else {
        state.processed++;
        try {
          this.processEvent(state.ledAnimation!.ledEvents[state.index], state);
        } catch {
          // Invalid event coordinates must not stop the rest of the animation.
        }
        state.index++;
        this.finishIfDone(state);
        if (!state.isPlaying) state.finishedAt = step.at;
      }
      due.push(this.nextStep(state, currTime));
    }
    this.ledAnimationStates = this.ledAnimationStates.filter((s) => !s.remove);

    this.rafId = window.setTimeout(this.loop, LOOP_INTERVAL_MS);
  };

  /** Events already running at a time precede shutdowns there, then new starts, in request order. */
  private nextStep(state: LedAnimationState, currTime: number): Step | null {
    if (state.remove) return null;
    const shutdown: Step | null = state.shutdownAt === null ? null : {
      state, at: state.shutdownAt, rank: 1, order: state.shutdownOrder, shutdown: true,
    };
    if (!state.isPlaying) {
      // A late scheduled press only cleans up if this animation was still running at that time.
      if (shutdown && state.finishedAt !== null && shutdown.at < state.finishedAt && shutdown.at <= currTime) return shutdown;
      if (state.finishedAt === null || currTime - state.finishedAt > LATE_PRESS_MS) state.remove = true;
      return null;
    }
    let event: Step | null = {
      state, at: state.delay, rank: state.delay === state.startedAt ? 2 : 0, order: state.order, shutdown: false,
    };
    // Endless animations keep the existing per-tick budget and drop excess backlog so even a
    // delayless loop yields to input. Finite zero-time repeats finish in finishIfDone instead.
    if (state.ledAnimation!.loop === 0 && state.delay <= currTime && state.processed > state.ledAnimation!.ledEvents.length) {
      state.delay = currTime;
      event = null;
    }
    const next = !event || (shutdown && compareSteps(shutdown, event) < 0) ? shutdown : event;
    return next && next.at <= currTime ? next : null;
  }

  private finishIfDone(state: LedAnimationState): void {
    const animation = state.ledAnimation!;
    if (state.index >= animation.ledEvents.length) {
      state.loopProgress++;
      state.index = 0;
      if (animation.loop !== 0 && state.delay <= state.passStart) state.loopProgress = animation.loop;
      state.passStart = state.delay;
    }
    if (animation.loop !== 0 && animation.loop <= state.loopProgress) state.isPlaying = false;
  }

  private shutDownAt(state: LedAnimationState, at: number, order: number): void {
    if (state.shutdownAt === null || at < state.shutdownAt) {
      state.shutdownAt = at;
      state.shutdownOrder = order;
    }
  }

  private processEvent(event: LedEvent, state: LedAnimationState): void {
    switch (event.type) {
      case 'on': {
        if (event.x !== -1) {
          // The parser keeps pad events outside the grid as written; they light nothing, as on Android
          // and iOS.
          if (this.btnLed[event.x]?.[event.y] === undefined) break;
          this.listener.onPadLedTurnOn(event.x, event.y, event.color, event.velocity);
          this.btnLed[event.x][event.y] = { buttonX: state.buttonX, buttonY: state.buttonY, chain: state.chainAtCreation };
        } else {
          if (this.cirLed[event.y] === undefined) break;
          this.listener.onChainLedTurnOn(event.y, event.color, event.velocity);
          this.cirLed[event.y] = { buttonX: state.buttonX, buttonY: state.buttonY, chain: state.chainAtCreation };
        }
        break;
      }
      case 'off': {
        if (event.x !== -1) {
          const led = this.btnLed[event.x]?.[event.y];
          if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY && led.chain === state.chainAtCreation) {
            this.listener.onPadLedTurnOff(event.x, event.y);
            this.btnLed[event.x][event.y] = null;
          }
        } else {
          const led = this.cirLed[event.y];
          if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY && led.chain === state.chainAtCreation) {
            this.listener.onChainLedTurnOff(event.y);
            this.cirLed[event.y] = null;
          }
        }
        break;
      }
      case 'delay':
        state.delay += event.delay;
        break;
      case 'chain':
        this.setChain(event.chain);
        break;
    }
  }

  private cleanupState(state: LedAnimationState): void {
    for (let x = 0; x < this.unipack.info.buttonX; x++) {
      for (let y = 0; y < this.unipack.info.buttonY; y++) {
        const led = this.btnLed[x][y];
        if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY && led.chain === state.chainAtCreation) {
          this.listener.onPadLedTurnOff(x, y);
          this.btnLed[x][y] = null;
        }
      }
    }
    for (let y = 0; y < this.cirLed.length; y++) {
      const led = this.cirLed[y];
      if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY && led.chain === state.chainAtCreation) {
        this.listener.onChainLedTurnOff(y);
        this.cirLed[y] = null;
      }
    }
  }

  launch(): void {
    if (!this.active) {
      this.active = true;
      // 4 ms timer, matching Android's LED tick. rAF ran at ~17 ms and froze in a hidden tab,
      // where the returning frame's time jump killed every running animation.
      this.rafId = window.setTimeout(this.loop, LOOP_INTERVAL_MS);
    }
  }

  stop(): void {
    this.active = false;
    if (this.rafId !== null) {
      window.clearTimeout(this.rafId);
      this.rafId = null;
    }
    for (const state of this.ledAnimationStates) {
      if (state.isPlaying) this.cleanupState(state);
    }
    this.ledAnimationStates.length = 0;
    this.ledAnimationStatesAdd.length = 0;
  }

  private ledGet(c: number, x: number, y: number): LedAnimation | null {
    const table = this.unipack.ledAnimationTable;
    if (!table) return null;
    const anims = table[c]?.[x]?.[y];
    if (!anims || anims.length === 0) return null;
    return anims[0];
  }

  private ledPush(c: number, x: number, y: number): void {
    const table = this.unipack.ledAnimationTable;
    if (!table) return;
    const anims = table[c]?.[x]?.[y];
    if (!anims || anims.length <= 1) return;
    const first = anims.shift()!;
    anims.push(first);
  }

  eventOn(x: number, y: number, pressedAt = performance.now()): void {
    if (!this.active) return;

    const chain = this.chainValue();
    const order = ++this.requests;

    for (const state of [...this.ledAnimationStates, ...this.ledAnimationStatesAdd]) {
      if (state.buttonX === x && state.buttonY === y && state.chainAtCreation === chain) {
        this.shutDownAt(state, pressedAt, order);
      }
    }

    const animation = this.ledGet(chain, x, y);
    this.ledPush(chain, x, y);

    if (animation) {
      this.ledAnimationStatesAdd.push({
        buttonX: x,
        buttonY: y,
        chainAtCreation: chain,
        index: 0,
        delay: pressedAt,
        isPlaying: animation.ledEvents.length > 0,
        startedAt: pressedAt,
        order,
        shutdownAt: null,
        shutdownOrder: 0,
        finishedAt: null,
        passStart: pressedAt,
        processed: 0,
        remove: false,
        loopProgress: 0,
        ledAnimation: animation,
      });
    }
  }

  eventOff(x: number, y: number, releasedAt = performance.now()): void {
    if (!this.active) return;
    const order = ++this.requests;
    for (const state of [...this.ledAnimationStates, ...this.ledAnimationStatesAdd]) {
      if (state.buttonX === x && state.buttonY === y && state.chainAtCreation === this.chainValue() && state.ledAnimation?.loop === 0) {
        this.shutDownAt(state, releasedAt, order);
      }
    }
  }
}
