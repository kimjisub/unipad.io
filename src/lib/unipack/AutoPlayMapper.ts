import { NO_WORMHOLE, type AutoPlay, type AutoPlayElement, type AutoPlayElementOn, type Sound } from './types';
import { PriorityQueue } from './PriorityQueue';

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
 *   order of each pad's sounds stay as they were.
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

  const result: (AutoPlayElement | null)[] = [];
  let lastPress: AutoPlayElementOn | null = null;
  // The waits since the last press: where the replacement goes and their original total.
  let waitIndex = -1;
  let waitTotal = 0;
  let progress = 0;
  let index = 0;
  let sourceTime = 0;
  const lastTimedIndex = elements.findLastIndex(e => e.type !== 'chain');
  const pending = new PriorityQueue<{ at: number; chain: number; press: AutoPlayElementOn; order: number }>(
    (a, b) => a.at - b.at || a.order - b.order,
  );
  const wormholes = new Map<AutoPlayElement, AutoPlayElementOn>();

  const replaceWaits = () => {
    if (lastPress === null) {
      const leadIn = { type: 'delay' as const, delay: AUTO_MAP_LEAD_IN_MS };
      if (waitIndex >= 0) result[waitIndex] = leadIn;
      else result.push(leadIn);
    } else if (waitIndex >= 0) {
      const lengthMs = soundLengthMs(lastPress, soundTable);
      result[waitIndex] = { type: 'delay', delay: lengthMs ?? waitTotal };
    }
    waitIndex = -1;
    waitTotal = 0;
  };

  const processNextChunk = () => {
    try {
      const end = Math.min(index + CHUNK_SIZE, elements.length);
      for (; index < end; index++) {
        const element = elements[index];
        if (element.type === 'delay') {
          if (waitIndex < 0) {
            waitIndex = result.length;
            result.push(null);
          }
          waitTotal += element.delay;
          sourceTime += element.delay;
        } else if (element.type === 'on') {
          replaceWaits();
          const { x, y, currChain } = element;
          const press = { ...element };
          result.push(press, { type: 'off', x, y, currChain });
          const sounds = soundTable[currChain]?.[x]?.[y];
          const sound = sounds?.[element.num % sounds.length];
          if (sound && sound.wormhole !== NO_WORMHOLE) {
            pending.push({ at: sourceTime + 100, chain: sound.wormhole, press, order: index });
          }
          lastPress = element;
          listener.onProgress(++progress);
        } else if (element.type === 'chain') {
          const chain = { ...element };
          result.push(chain);
          const due = pending.peek();
          // Parsed wormholes occur at their deadline, or are flushed in order at EOF.
          // Keep authored chain selections in their existing position.
          if (due && due.chain === element.c && (due.at <= sourceTime || index > lastTimedIndex)) {
            wormholes.set(chain, pending.pop()!.press);
          } else {
            pending.clear();
          }
        }
      }

      if (index < elements.length) {
        setTimeout(processNextChunk, 0);
        return;
      }
      // A trailing wait's placeholder is never filled, so it is dropped here with the others.
      const mapped = result.filter((e): e is AutoPlayElement => e !== null);
      listener.onDone({ elements: retimeWormholes(mapped, wormholes) });
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

/** Reinsert parsed sound switches relative to the mapped press, retaining authored order and EOF. */
function retimeWormholes(elements: AutoPlayElement[], wormholes: Map<AutoPlayElement, AutoPlayElementOn>): AutoPlayElement[] {
  if (wormholes.size === 0) return elements;
  let end = 0;
  const switches = new Map<AutoPlayElementOn, AutoPlayElement>();
  for (const [element, press] of wormholes) switches.set(press, element);
  const events = elements.flatMap((element, order) => {
    if (element.type === 'delay') { end += element.delay; return []; }
    return [{ element, at: end, order }];
  });
  const pending = new PriorityQueue<{ at: number; element: AutoPlayElement; order: number }>(
    (a, b) => a.at - b.at || a.order - b.order,
  );
  const result: AutoPlayElement[] = [];
  let time = 0;
  const advanceTo = (at: number) => {
    while (pending.peek() && pending.peek()!.at <= at) {
      const due = pending.pop()!;
      if (due.at > time) {
        result.push({ type: 'delay', delay: due.at - time });
        time = due.at;
      }
      result.push(due.element);
    }
    // Authored negative waits keep their signed duration and never reorder presses.
    if (at !== time) result.push({ type: 'delay', delay: at - time });
    time = at;
  };
  for (const event of events) {
    if (wormholes.has(event.element)) continue;
    advanceTo(event.at);
    // A shorter mapped wait may put an explicit selection before a sound's deadline.
    if (event.element.type === 'chain') pending.clear();
    result.push(event.element);
    if (event.element.type === 'on') {
      const element = switches.get(event.element);
      if (element) pending.push({ at: event.at + 100, element, order: event.order });
    }
  }
  advanceTo(end);
  for (let due = pending.pop(); due; due = pending.pop()) result.push(due.element);
  return result;
}
