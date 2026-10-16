import type { UniPackData } from './types';

/** The part of the sound engine a chain change moves: a pad's sound queue, to the sound numbered `num`. */
export interface SoundQueues {
  soundPushToNum(c: number, x: number, y: number, num: number): void;
}

/** Turns the LED animation queue of pad (x, y) in chain `c` until the animation numbered `num` is first. */
export function ledPushToNum(unipack: UniPackData, c: number, x: number, y: number, num: number): void {
  const anims = unipack.ledAnimationTable?.[c]?.[x]?.[y];
  if (!anims || anims.length === 0) return;
  const targetNum = num % anims.length;
  for (let i = 0; i < anims.length; i++) {
    if (anims[0].num === targetNum) break;
    const first = anims.shift()!;
    anims.push(first);
  }
}

/**
 * What the play screen does when the chain changes, whoever changes it (the user, a wormhole, a keyLED
 * `chain` event or autoPlay): the chain is clamped into the pack, as Android's ChainObserver does, and
 * every pad of that chain goes back to its first sound and its first LED animation, as Android's
 * PlayActivityViewModel does. Returns the chain, or null for a value that is not an integer.
 */
export function changeChain(unipack: UniPackData, c: number, sounds: SoundQueues | null): number | null {
  // Math.min/max pass NaN through; a NaN chain made soundTable[NaN] undefined for every pad.
  if (!Number.isInteger(c)) return null;
  const chain = Math.max(0, Math.min(c, unipack.info.chain - 1));
  for (let x = 0; x < unipack.info.buttonX; x++) {
    for (let y = 0; y < unipack.info.buttonY; y++) {
      sounds?.soundPushToNum(chain, x, y, 0);
      ledPushToNum(unipack, chain, x, y, 0);
    }
  }
  return chain;
}
