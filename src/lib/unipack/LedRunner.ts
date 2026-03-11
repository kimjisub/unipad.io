import { LedAnimation, LedEvent, UniPackData } from './types';

interface Led {
  buttonX: number;
  buttonY: number;
}

interface LedAnimationState {
  buttonX: number;
  buttonY: number;
  index: number;
  delay: number;
  isPlaying: boolean;
  isShutdown: boolean;
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

export class LedRunner {
  private unipack: UniPackData;
  private listener: LedRunnerListener;
  private chainValue: () => number;
  private setChain: (c: number) => void;
  private loopDelay: number;

  private btnLed: (Led | null)[][];
  private cirLed: (Led | null)[];
  private ledAnimationStates: LedAnimationState[] = [];
  private ledAnimationStatesAdd: LedAnimationState[] = [];

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastTime = 0;

  active = false;

  constructor(
    unipack: UniPackData,
    listener: LedRunnerListener,
    chainValue: () => number,
    setChain: (c: number) => void,
    loopDelay = 4,
  ) {
    this.unipack = unipack;
    this.listener = listener;
    this.chainValue = chainValue;
    this.setChain = setChain;
    this.loopDelay = loopDelay;

    this.btnLed = Array.from({ length: unipack.info.buttonX }, () =>
      Array.from({ length: unipack.info.buttonY }, () => null),
    );
    this.cirLed = Array.from({ length: 36 }, () => null);
  }

  private loop = (): void => {
    if (!this.active) return;

    const currTime = performance.now();
    if (currTime - this.lastTime < this.loopDelay) {
      this.timerId = setTimeout(this.loop, this.loopDelay);
      return;
    }
    this.lastTime = currTime;

    for (const state of this.ledAnimationStates) {
      if (state.isPlaying && !state.isShutdown) {
        if (state.delay === 0) state.delay = currTime;

        while (true) {
          const events = state.ledAnimation?.ledEvents;
          if (!events) break;

          if (state.index >= events.length) {
            state.loopProgress++;
            state.index = 0;
          }

          if (state.ledAnimation!.loop !== 0 && state.ledAnimation!.loop <= state.loopProgress) {
            state.isPlaying = false;
            break;
          }

          if (state.delay <= currTime) {
            try {
              const event = events[state.index];
              this.processEvent(event, state);
            } catch {
              // Android: ArrayIndexOutOfBoundsException을 catch하고 계속 진행
            }
          } else {
            break;
          }
          state.index++;
        }
      } else if (state.isShutdown) {
        this.cleanupState(state);
        state.remove = true;
      } else {
        state.remove = true;
      }
    }

    for (const item of this.ledAnimationStatesAdd) {
      this.ledAnimationStates.push(item);
    }
    this.ledAnimationStatesAdd.length = 0;
    this.ledAnimationStates = this.ledAnimationStates.filter((s) => !s.remove);

    this.timerId = setTimeout(this.loop, this.loopDelay);
  };

  private processEvent(event: LedEvent, state: LedAnimationState): void {
    switch (event.type) {
      case 'on': {
        if (event.x !== -1) {
          this.listener.onPadLedTurnOn(event.x, event.y, event.color, event.velocity);
          if (this.btnLed[event.x]?.[event.y] !== undefined) {
            this.btnLed[event.x][event.y] = { buttonX: state.buttonX, buttonY: state.buttonY };
          }
        } else {
          this.listener.onChainLedTurnOn(event.y, event.color, event.velocity);
          this.cirLed[event.y] = { buttonX: state.buttonX, buttonY: state.buttonY };
        }
        break;
      }
      case 'off': {
        if (event.x !== -1) {
          const led = this.btnLed[event.x]?.[event.y];
          if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY) {
            this.listener.onPadLedTurnOff(event.x, event.y);
            this.btnLed[event.x][event.y] = null;
          }
        } else {
          const led = this.cirLed[event.y];
          if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY) {
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
        if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY) {
          this.listener.onPadLedTurnOff(x, y);
          this.btnLed[x][y] = null;
        }
      }
    }
    for (let y = 0; y < this.cirLed.length; y++) {
      const led = this.cirLed[y];
      if (led && led.buttonX === state.buttonX && led.buttonY === state.buttonY) {
        this.listener.onChainLedTurnOff(y);
        this.cirLed[y] = null;
      }
    }
  }

  launch(): void {
    if (!this.active) {
      this.active = true;
      this.lastTime = performance.now();
      this.timerId = setTimeout(this.loop, this.loopDelay);
    }
  }

  stop(): void {
    this.active = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
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

  eventOn(x: number, y: number): void {
    if (!this.active) return;

    // Shutdown existing animation for this pad
    for (const state of this.ledAnimationStates) {
      if (state.buttonX === x && state.buttonY === y) {
        state.isShutdown = true;
      }
    }

    const chain = this.chainValue();
    const animation = this.ledGet(chain, x, y);
    this.ledPush(chain, x, y);

    if (animation) {
      this.ledAnimationStatesAdd.push({
        buttonX: x,
        buttonY: y,
        index: 0,
        delay: 0,
        isPlaying: true,
        isShutdown: false,
        remove: false,
        loopProgress: 0,
        ledAnimation: animation,
      });
    }
  }

  eventOff(x: number, y: number): void {
    if (!this.active) return;
    for (const state of this.ledAnimationStates) {
      if (state.buttonX === x && state.buttonY === y && state.ledAnimation?.loop === 0) {
        state.isShutdown = true;
      }
    }
  }
}
