import { inspectAudio } from './audioInspection';
import type { AudioExclusion, AudioInspection, AudioReference } from './audioSafety';
import type { UniPackData } from './types';

/** Why a used sound file stays silent, in the order a notice lists them. */
export const SOUND_FAILURE_REASONS = ['limit', 'unreadable', 'decode', 'memory'] as const;
export type SoundFailureReason = (typeof SOUND_FAILURE_REASONS)[number];

export interface SoundFailure {
  /** The archive path of the file. */
  readonly file: string;
  readonly reason: SoundFailureReason;
  /** The admission rule that left the file out; null when it failed after being admitted. */
  readonly exclusion: AudioExclusion | null;
}

/**
 * What opening a pack's sounds came to. `usedFiles` counts each sound file keySound uses once;
 * `decode` and `memory` failures mean the pack did not play as written, unlike rule exclusions.
 */
export interface SoundLoadReport {
  readonly usedFiles: number;
  readonly loadedFiles: number;
  readonly failures: readonly SoundFailure[];
  readonly reservedCost: bigint;
}

export const EMPTY_SOUND_LOAD_REPORT: SoundLoadReport = Object.freeze({
  usedFiles: 0,
  loadedFiles: 0,
  failures: Object.freeze([]),
  reservedCost: BigInt(0),
});

/** A pack that uses sounds and could load none of them. A pack of lights only has none to lose. */
export function allSoundsFailed(report: SoundLoadReport): boolean {
  return report.usedFiles > 0 && report.loadedFiles === 0;
}

/** Sounds that were admitted and still did not load: the pack did not play as written. */
export function soundsFailedToLoad(report: SoundLoadReport): boolean {
  return report.failures.some(({ reason }) => reason === 'decode' || reason === 'memory');
}

export function soundFailureCounts(report: SoundLoadReport): Record<SoundFailureReason, number> {
  const counts = { limit: 0, unreadable: 0, decode: 0, memory: 0 };
  for (const failure of report.failures) counts[failure.reason]++;
  return counts;
}

export function exclusionReason(exclusion: AudioExclusion): SoundFailureReason {
  return exclusion === 'INVALID_FORMAT' || exclusion === 'READ_FAILURE' ? 'unreadable' : 'limit';
}

/**
 * A rejected decode is the browser running out of memory when it says so: an allocation RangeError
 * (copying or growing a buffer) or a quota or memory error. Any other rejection is the file's.
 */
export function isMemoryFailure(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  return name === 'QuotaExceededError' || (typeof message === 'string' && /memory|allocation failed/i.test(message));
}

/** Every keySound use of a sound file, by pad and line, before playback can rotate a pad's queue. */
export function audioReferences(pack: UniPackData): AudioReference[] {
  const { soundTable, info } = pack;
  const references: AudioReference[] = [];
  for (let chain = 0; chain < info.chain; chain++)
    for (let x = 0; x < info.buttonX; x++)
      for (let y = 0; y < info.buttonY; y++)
        soundTable[chain][x][y]?.forEach((sound, line) => references.push({ chain, x, y, line, identity: sound.file }));
  return references;
}

/** Reads a sound file's audio facts before anything decodes it. */
export interface AudioInspector {
  inspect(bytes: ArrayBuffer): Promise<AudioInspection>;
  /** Release inspection resources as soon as selection finishes, before audio decoding. */
  close?(): void;
}

/** Reads on the calling thread; a long FLAC or Ogg file holds it for seconds (see audioInspectionWorker). */
export const INLINE_AUDIO_INSPECTOR: AudioInspector = {
  inspect: async bytes => inspectAudio(bytes),
};
