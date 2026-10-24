/** Exact, structural audio admission. This plan does not certify decoder or device safety. */
export interface AudioFacts {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: bigint;
  readonly format?: string;
}
export type AudioExclusion =
  | 'INVALID_FORMAT'
  | 'READ_FAILURE'
  | 'SAMPLE_RATE'
  | 'CHANNELS'
  | 'DURATION'
  | 'SINGLE_LIMIT'
  | 'PACK_LIMIT';
export type AudioInspection =
  | { readonly exclusion: null; readonly facts: AudioFacts }
  | { readonly exclusion: AudioExclusion };
export interface AudioCost {
  readonly cost: bigint;
  readonly exclusion: AudioExclusion | null;
}
export const SINGLE_AUDIO_LIMIT = BigInt(67_108_864);
export const PACK_AUDIO_LIMIT = BigInt(134_217_728);

export function audioCost(facts: AudioFacts): AudioCost {
  const { sampleRate: rate, channels, frames } = facts;
  const rejected = (exclusion: AudioExclusion): AudioCost => ({
    cost: BigInt(0),
    exclusion,
  });
  if (!Number.isSafeInteger(rate) || rate < 8000 || rate > 384000)
    return rejected('SAMPLE_RATE');
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 8)
    return rejected('CHANNELS');
  if (typeof frames !== 'bigint' || frames < BigInt(0))
    return rejected('INVALID_FORMAT');
  // Bound the operands before multiplication. BigInt never silently wraps or rounds.
  if (frames > BigInt(600) * BigInt(rate)) return rejected('DURATION');
  const r = BigInt(rate);
  const numerator = rate < 48000 ? frames * BigInt(48000) : frames;
  const scaled =
    rate < 48000
      ? numerator / r + (numerator % r === BigInt(0) ? BigInt(0) : BigInt(1))
      : frames;
  const cost = scaled * BigInt(Math.max(channels, 2));
  return cost > SINGLE_AUDIO_LIMIT
    ? rejected('SINGLE_LIMIT')
    : { cost, exclusion: null };
}
/** Zero-based coordinates. Identity is the resolved archive path, not its spelling in keySound. */
export interface AudioReference {
  readonly chain: number;
  readonly x: number;
  readonly y: number;
  readonly line: number;
  readonly identity: string;
}
export interface AudioBounds {
  readonly chains: number;
  readonly width: number;
  readonly height: number;
}
export interface AudioSelection extends AudioCost {
  readonly identity: string;
}
export interface AudioSelectionPlan {
  readonly files: readonly AudioSelection[];
  readonly reservedCost: bigint;
}

/** Finish admission before decoding. Decoder failure must never release a reservation. */
export async function selectAudio(
  references: readonly AudioReference[],
  bounds: AudioBounds,
  inspect: (identity: string) => AudioInspection | Promise<AudioInspection>,
): Promise<AudioSelectionPlan> {
  if (
    ![bounds.chains, bounds.width, bounds.height].every(
      n => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new RangeError('Invalid audio bounds');
  const ordered = references
    .filter(
      r =>
        [r.chain, r.x, r.y, r.line].every(Number.isSafeInteger) &&
        r.chain >= 0 &&
        r.chain < bounds.chains &&
        r.x >= 0 &&
        r.x < bounds.width &&
        r.y >= 0 &&
        r.y < bounds.height,
    )
    .sort(
      (a, b) => a.chain - b.chain || a.x - b.x || a.y - b.y || a.line - b.line,
    );
  const decisions = new Map<string, AudioSelection>();
  let reservedCost = BigInt(0);
  for (const { identity } of ordered) {
    if (decisions.has(identity)) continue;
    let inspection: AudioInspection;
    try {
      inspection = await inspect(identity);
    } catch {
      inspection = { exclusion: 'READ_FAILURE' };
    }
    const result =
      inspection.exclusion === null
        ? audioCost(inspection.facts)
        : { cost: BigInt(0), exclusion: inspection.exclusion };
    const exclusion =
      result.exclusion ??
      (result.cost > PACK_AUDIO_LIMIT - reservedCost ? 'PACK_LIMIT' : null);
    const cost = exclusion === null ? result.cost : BigInt(0);
    reservedCost += cost; // The remaining budget was checked before addition.
    decisions.set(identity, Object.freeze({ identity, cost, exclusion }));
  }
  return Object.freeze({
    files: Object.freeze([...decisions.values()]),
    reservedCost,
  });
}
