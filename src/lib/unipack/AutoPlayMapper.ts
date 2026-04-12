import type { AutoPlay, AutoPlayElement, Sound } from './types';

export interface AutoPlayMapperListener {
  onStart: () => void;
  onGetWorkSize: (size: number) => void;
  onProgress: (progress: number) => void;
  onDone: (mappedAutoPlay: AutoPlay) => void;
  onError: (error: Error) => void;
}

/**
 * 'off' 이벤트를 제거하고 연속된 delay를 병합한 뒤,
 * 각 'on' 이벤트의 실제 사운드 재생 시간으로 delay를 교체한다.
 */
export function autoPlayMap(
  autoPlay: AutoPlay,
  soundTable: (Sound[] | null)[][][],
  listener: AutoPlayMapperListener,
): void {
  listener.onStart();

  // 1. 'off' 이벤트 제거 후 연속 delay 병합
  const filtered = filterAndMergeDelays(autoPlay.elements);

  // 2. 'on' 이벤트 개수를 작업량으로 보고
  const onEvents = filtered.filter((e) => e.type === 'on');
  listener.onGetWorkSize(onEvents.length);

  if (onEvents.length === 0) {
    listener.onDone({ elements: filtered });
    return;
  }

  // 3. 비동기 청크 처리로 UI 블로킹 방지
  processChunked(filtered, soundTable, listener);
}

function filterAndMergeDelays(elements: AutoPlayElement[]): AutoPlayElement[] {
  const withoutOff = elements.filter((e) => e.type !== 'off');

  const merged: AutoPlayElement[] = [];
  for (const element of withoutOff) {
    if (element.type === 'delay') {
      const last = merged[merged.length - 1];
      if (last && last.type === 'delay') {
        last.delay += element.delay;
      } else {
        merged.push({ ...element });
      }
    } else {
      merged.push({ ...element });
    }
  }
  return merged;
}

function getSoundDurationMs(
  element: Extract<AutoPlayElement, { type: 'on' }>,
  soundTable: (Sound[] | null)[][][],
): number {
  const { currChain, x, y, num } = element;
  const sounds = soundTable[currChain]?.[x]?.[y];
  if (!sounds || sounds.length === 0) return 0;
  const sound = sounds[num % sounds.length];
  if (!sound?.audioBuffer) return 0;
  return sound.audioBuffer.duration * 1000;
}

function processChunked(
  elements: AutoPlayElement[],
  soundTable: (Sound[] | null)[][][],
  listener: AutoPlayMapperListener,
): void {
  const result: AutoPlayElement[] = [];
  let progress = 0;
  let elementIndex = 0;

  // delay accumulator: 'on' 이벤트 사이에 쌓인 delay를 추적
  let pendingDelay = 0;

  const CHUNK_SIZE = 100;

  function processNextChunk(): void {
    const end = Math.min(elementIndex + CHUNK_SIZE, elements.length);

    for (; elementIndex < end; elementIndex++) {
      const element = elements[elementIndex];

      if (element.type === 'delay') {
        pendingDelay += element.delay;
      } else if (element.type === 'on') {
        // pending delay를 0ms offset으로 교체 (사운드 duration으로 대체)
        const durationMs = getSoundDurationMs(element, soundTable);
        if (durationMs > 0) {
          // delay 누적분은 버리고 실제 재생 시간으로 대체
          result.push({ type: 'delay', delay: Math.round(durationMs) });
        } else if (pendingDelay > 0) {
          result.push({ type: 'delay', delay: pendingDelay });
        }
        pendingDelay = 0;
        result.push({ ...element });
        progress++;
        listener.onProgress(progress);
      } else {
        // 'chain' 등 나머지 이벤트
        if (pendingDelay > 0) {
          result.push({ type: 'delay', delay: pendingDelay });
          pendingDelay = 0;
        }
        result.push({ ...element });
      }
    }

    if (elementIndex < elements.length) {
      setTimeout(processNextChunk, 0);
    } else {
      if (pendingDelay > 0) {
        result.push({ type: 'delay', delay: pendingDelay });
      }
      listener.onDone({ elements: result });
    }
  }

  setTimeout(processNextChunk, 0);
}
