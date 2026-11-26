import { NO_WORMHOLE, type AutoPlay, type AutoPlayElement, type AutoPlayElementOn, type Sound } from './types';
import { PriorityQueue } from './PriorityQueue';
import { chainOrigin, rememberChainOrigin } from './autoPlayChainOrigin';

export interface AutoPlayMapperListener {
  onStart: () => void;
  onGetWorkSize: (size: number) => void;
  onProgress: (progress: number) => void;
  onDone: (mappedAutoPlay: AutoPlay) => void;
  onError: (error: Error) => void;
}

/** Wait placed before the first press, so the track does not start the instant it is played. */
export const AUTO_MAP_LEAD_IN_MS = 1000;

const CHUNK_SIZE = 100;

/**
 * Rewrites an autoPlay so each wait between presses lasts as long as the sound pressed before it.
 *
 * - Consecutive waits before a press count as one wait, replaced by the length of the sound of the
 *   last press before them. Presses with no wait between them stay simultaneous.
 * - The first press is preceded by {@link AUTO_MAP_LEAD_IN_MS}; waits after the last press are dropped.
 * - A wait after a sound whose length is unknown keeps its original length.
 * - Every press becomes a press and an immediate release, so no pad stays held. Chain changes and the
 *   each press's sound queue follow the chain selected at its mapped song time.
 *
 * Runs in chunks so a long autoPlay does not block the page. The input is not changed.
 */
export function autoPlayMap(
  autoPlay: AutoPlay,
  soundTable: (Sound[] | null)[][][],
  listener: AutoPlayMapperListener,
): void {
  listener.onStart();

  const elements = autoPlay.elements;
  const pressCount = elements.reduce((count, e) => (e.type === 'on' ? count + 1 : count), 0);
  listener.onGetWorkSize(pressCount);

  if (pressCount === 0) {
    listener.onDone({ elements: elements.map((e) => ({ ...e })) });
    return;
  }

  const result: AutoPlayElement[] = [];
  let lastPress: AutoPlayElementOn | null = null;
  let progress = 0;
  let index = 0;
  let time = 0;
  let chain = 0;
  const counts = new Map<string, number>();
  const gap: AutoPlayElement[] = [];
  const { generated, cancelled } = findGeneratedChains(elements, soundTable);
  const pending = new PriorityQueue<{ at: number; chain: number; order: number }>(
    (a, b) => a.at - b.at || a.order - b.order,
  );
  const switchChain = (c: number, fromSound: boolean) => {
    chain = c;
    counts.clear();
    const element = { type: 'chain' as const, c };
    rememberChainOrigin(element, fromSound);
    result.push(element);
  };
  const advance = (delay: number) => {
    const end = time + delay;
    while (pending.peek() && pending.peek()!.at <= end) {
      const next = pending.pop()!;
      if (next.at > time) result.push({ type: 'delay', delay: next.at - time });
      time = Math.max(time, next.at);
      switchChain(next.chain, true);
    }
    // Signed waits retain their authored order even if song time moves backwards.
    if (end !== time) result.push({ type: 'delay', delay: end - time });
    time = end;
  };
  const applyGap = (trailing: boolean) => {
    const hasWait = gap.some(e => e.type === 'delay');
    const originalWait = gap.reduce((sum, e) => sum + (e.type === 'delay' ? e.delay : 0), 0);
    const duration = lastPress === null ? AUTO_MAP_LEAD_IN_MS : soundLengthMs(lastPress, soundTable) ?? originalWait;
    let waited = false;
    for (const element of gap) {
      if (element.type === 'delay') {
        if (!trailing && !waited) advance(duration);
        waited = true;
      } else if (element.type === 'chain') {
        pending.clear();
        switchChain(element.c, false);
      }
    }
    if (!trailing && lastPress === null && !hasWait) advance(AUTO_MAP_LEAD_IN_MS);
    gap.length = 0;
  };

  const processNextChunk = () => {
    try {
      const end = Math.min(index + CHUNK_SIZE, elements.length);
      for (; index < end; index++) {
        const element = elements[index];
        if (element.type === 'delay' || (element.type === 'chain' && !generated.has(element))) {
          gap.push(element);
        } else if (element.type === 'on') {
          applyGap(false);
          const { x, y } = element;
          const key = `${x},${y}`;
          const num = counts.get(key) ?? 0;
          const press = { ...element, currChain: chain, num };
          result.push(press, { type: 'off', x, y, currChain: chain });
          counts.set(key, num + 1);
          const sounds = soundTable[chain]?.[x]?.[y];
          const sound = sounds?.[num % sounds.length];
          if (sound && sound.wormhole !== NO_WORMHOLE && !cancelled.has(element)) {
            pending.push({ at: time + 100, chain: sound.wormhole, order: index });
          }
          lastPress = press;
          listener.onProgress(++progress);
        }
      }
      if (index < elements.length) { setTimeout(processNextChunk, 0); return; }
      applyGap(true);
      // Normal EOF flushes scheduled switches without extending the mapped song.
      for (let next = pending.pop(); next; next = pending.pop()) switchChain(next.chain, true);
      listener.onDone({ elements: result });
    } catch (error) {
      listener.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  setTimeout(processNextChunk, 0);
}

/** The pressed sound's length in whole milliseconds (an exact half rounds up), or null when unknown. */
function soundLengthMs(press: AutoPlayElementOn, soundTable: (Sound[] | null)[][][]): number | null {
  const { currChain, x, y, num } = press;
  const sounds = soundTable[currChain]?.[x]?.[y];
  if (!sounds || sounds.length === 0) return null;
  const seconds = sounds[num % sounds.length]?.audioBuffer?.duration;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

/** Recover old serialized timelines conservatively; freshly parsed chains have exact provenance. */
function findGeneratedChains(elements: AutoPlayElement[], soundTable: (Sound[] | null)[][][]): { generated: Set<AutoPlayElement>; cancelled: Set<AutoPlayElement> } {
  const generated = new Set<AutoPlayElement>();
  const cancelled = new Set<AutoPlayElement>();
  const pending = new PriorityQueue<{ at: number; chain: number; order: number; press: AutoPlayElement }>(
    (a, b) => a.at - b.at || a.order - b.order,
  );
  const tailStart = elements.findLastIndex(e => e.type !== 'chain') + 1;
  let time = 0;
  let flushTail = false;
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.type === 'delay') time += element.delay;
    else if (element.type === 'on') {
      const sounds = soundTable[element.currChain]?.[element.x]?.[element.y];
      const sound = sounds?.[element.num % sounds.length];
      if (sound && sound.wormhole !== NO_WORMHOLE) pending.push({ at: time + 100, chain: sound.wormhole, order: i, press: element });
    } else if (element.type === 'chain') {
      // Only a complete matching suffix can represent an unmarked EOF flush. A matching first
      // destination alone must never swallow an explicit selection followed by another one.
      if (i === tailStart) {
        const rest = [];
        for (let next = pending.pop(); next; next = pending.pop()) rest.push(next);
        flushTail = rest.length === elements.length - i && rest.every((next, n) => {
          const tail = elements[i + n];
          return tail.type === 'chain' && tail.c === next.chain && chainOrigin(tail) !== false;
        });
        for (const next of rest) pending.push(next);
      }
      const origin = chainOrigin(element);
      const due = pending.peek();
      const inferred = due && due.chain === element.c && (due.at <= time || flushTail);
      if (origin === true || (origin === undefined && inferred)) {
        generated.add(element);
        pending.pop();
      } else {
        for (let next = pending.pop(); next; next = pending.pop()) cancelled.add(next.press);
      }
    }
  }
  return { generated, cancelled };
}
