import type { AudioInspection } from './audioSafety';
import { INLINE_AUDIO_INSPECTOR, type AudioInspector } from './soundLoading';

export interface InspectionRequest { id: number; bytes: ArrayBuffer }
/** `inspection` is null when the reader threw. */
export interface InspectionResponse { id: number; inspection: AudioInspection | null }

/** An inspector the pack's open can stop with: its worker ends with it. */
export interface ClosableAudioInspector extends AudioInspector {
  close(): void;
}

interface Pending { bytes: ArrayBuffer; resolve: (inspection: AudioInspection) => void; reject: (error: unknown) => void }

/**
 * Reads sound files on a worker so a long FLAC or Ogg file, which takes seconds to read, does not
 * freeze the page while a pack opens. The worker reads a copy; the pack keeps its bytes for decoding.
 * Without a working worker the files are read in place: a reader that cannot start must not make
 * every sound unreadable.
 */
export function createAudioInspector(): ClosableAudioInspector {
  const inPlace = INLINE_AUDIO_INSPECTOR.inspect;
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== 'undefined')
      worker = new Worker(new URL('./audioInspection.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('Reading sound files on the page; the reader worker did not start.', error);
  }
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closed = false;

  const readPendingInPlace = () => {
    worker?.terminate();
    worker = null;
    for (const { bytes, resolve, reject } of pending.values()) inPlace(bytes).then(resolve, reject);
    pending.clear();
  };
  if (worker) {
    worker.onmessage = ({ data: { id, inspection } }: MessageEvent<InspectionResponse>) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (inspection) request.resolve(inspection);
      else request.reject(new Error('Reading the sound file failed'));
    };
    worker.onerror = event => {
      event.preventDefault();
      console.warn('Reading sound files on the page; the reader worker failed.', event.message);
      readPendingInPlace();
    };
  }

  return {
    inspect(bytes) {
      if (closed) return Promise.reject(new Error('The pack stopped opening'));
      if (!worker) return inPlace(bytes);
      const running = worker;
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { bytes, resolve, reject });
        const request: InspectionRequest = { id, bytes };
        try {
          running.postMessage(request);
        } catch {
          readPendingInPlace();
        }
      });
    },
    close() {
      closed = true;
      worker?.terminate();
      worker = null;
      for (const { reject } of pending.values()) reject(new Error('The pack stopped opening'));
      pending.clear();
    },
  };
}
