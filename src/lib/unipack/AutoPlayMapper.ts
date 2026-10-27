import type { AutoPlay, AutoPlayElement, AutoPlayElementOn, Sound } from './types';

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
        } else if (element.type === 'on') {
          replaceWaits();
          const { x, y, currChain } = element;
          result.push({ ...element }, { type: 'off', x, y, currChain });
          lastPress = element;
          listener.onProgress(++progress);
        } else if (element.type === 'chain') {
          result.push({ ...element });
        }
      }

      if (index < elements.length) {
        setTimeout(processNextChunk, 0);
        return;
      }
      // A trailing wait's placeholder is never filled, so it is dropped here with the others.
      listener.onDone({ elements: result.filter((e): e is AutoPlayElement => e !== null) });
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
