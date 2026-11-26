import type { StoredAutoPlay } from './storage';
import type { AutoPlayElement } from './types';
import { chainOrigin, rememberChainOrigin } from './autoPlayChainOrigin';

function sameElements(a: AutoPlayElement[], b: AutoPlayElement[]): boolean {
  return a.length === b.length && a.every((element, i) => {
    const other = b[i];
    if (element.type !== other.type) return false;
    switch (element.type) {
      case 'delay': return other.type === 'delay' && element.delay === other.delay;
      case 'chain': return other.type === 'chain' && element.c === other.c;
      case 'off': return other.type === 'off' && element.x === other.x && element.y === other.y && element.currChain === other.currChain;
      case 'on': return other.type === 'on' && element.x === other.x && element.y === other.y && element.currChain === other.currChain && element.num === other.num && element.wormholeCancelled === other.wormholeCancelled;
    }
  });
}

/** Refresh only a recognized original snapshot, on either side of a saved restore swap.
 * Unknown arrays are the player's work: never reinterpret or discard them. */
export function refreshOriginalAutoPlay(saved: StoredAutoPlay, original: AutoPlayElement[], legacy: AutoPlayElement[]): StoredAutoPlay {
  if (saved.timingVersion === 1) return saved;
  return {
    current: sameElements(saved.current, legacy) ? original : saved.current,
    backup: sameElements(saved.backup, legacy) ? original : saved.backup,
    timingVersion: 1,
  };
}

/** Recover only an exact archive-original identity, never infer origins in a custom timeline. */
export function restoreOriginalChainOrigins(elements: AutoPlayElement[], original: AutoPlayElement[]): void {
  if (!sameElements(elements, original)) return;
  elements.forEach((element, i) => {
    const source = original[i];
    if (element.type !== 'chain' || source.type !== 'chain' || chainOrigin(element) !== undefined) return;
    const fromSound = chainOrigin(source);
    if (fromSound !== undefined) rememberChainOrigin(element, fromSound);
  });
}
