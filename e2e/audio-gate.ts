import type { Page } from '@playwright/test';

/**
 * Replies to the app's own AudioContext.resume() calls, the request its sound engine makes before a
 * start. 'real' passes them to the browser; the others answer for it: refuse, reply without running,
 * or hold until the test settles them (a held reply that resolves runs the real resume first).
 */
export interface AudioGate {
  mode: 'real' | 'hold' | 'reject' | 'idle';
  /** Resume calls answered by the gate (not 'real'). */
  calls: number;
  held: number;
  settle(outcome: 'resolve' | 'reject' | 'idle'): number;
  /** Stops the pack's audio output behind the app's back, as a device that went away. */
  dropOutput(): Promise<void>;
}

declare global {
  interface Window { audioGate: AudioGate }
}

export async function installAudioGate(page: Page) {
  await page.addInitScript(() => {
    const nativeResume = AudioContext.prototype.resume;
    const nativeSuspend = AudioContext.prototype.suspend;
    const held: ((outcome: 'resolve' | 'reject' | 'idle') => void)[] = [];
    const outputs: AudioContext[] = [];
    const refused = () => new DOMException('The audio output could not start', 'NotAllowedError');
    const gate: AudioGate = {
      mode: 'real', calls: 0, held: 0,
      settle(outcome) {
        const replies = held.splice(0);
        gate.held = 0;
        for (const reply of replies) reply(outcome);
        return replies.length;
      },
      dropOutput: () => nativeSuspend.call(outputs.at(-1)!),
    };
    window.audioGate = gate;
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (gate.mode === 'real') return nativeResume.call(this);
      gate.calls++;
      if (gate.mode === 'reject') return Promise.reject(refused());
      if (gate.mode === 'idle') return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        gate.held++;
        held.push(outcome => {
          if (outcome === 'resolve') nativeResume.call(this).then(resolve, reject);
          else if (outcome === 'reject') reject(refused());
          else resolve();
        });
      });
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (this: AudioContext) {
      outputs.push(this);
      return createGain.call(this);
    };
  });
}

