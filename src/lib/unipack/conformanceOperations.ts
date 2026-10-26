// Observes real pure operations for shared product cases. Expected outputs are never inputs here.
import { autoPlayMap } from './AutoPlayMapper';
import { inspectAudio } from './audioInspection';
import { audioCost, selectAudio, type AudioInspection } from './audioSafety';
import type { AutoPlay, UniPackData } from './types';
import type { Json } from './conformanceHarness';

export type Operation = 'audio-cost' | 'audio-file' | 'audio-wave' | 'audio-selection' | 'auto-map';
interface WaveRecipe { rate: number; channels: number; frames: number; claimedSeconds: number }

/** Same physical PCM recipe as shared audio admission revision 3, one file allocated at a time. */
function wave(c: WaveRecipe): Buffer {
  const size = c.frames * c.channels * 2;
  if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024 * 1024) throw new Error('invalid shared wave recipe');
  const b = Buffer.alloc(56 + size);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(c.channels, 22);
  b.writeUInt32LE(c.rate, 24); b.writeUInt32LE(c.rate * c.channels * 2, 28);
  b.writeUInt16LE(c.channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('fact', 36); b.writeUInt32LE(4, 40); b.writeUInt32LE(c.claimedSeconds * c.rate, 44);
  b.write('data', 48); b.writeUInt32LE(size, 52);
  return b;
}

export async function admissionObservation(operation: Operation, input: Buffer): Promise<Json> {
  if (operation === 'audio-file') {
    const actual = inspectAudio(input);
    return actual.exclusion ? { exclusion: actual.exclusion } : {
      exclusion: null, rate: actual.facts.sampleRate, channels: actual.facts.channels, frames: String(actual.facts.frames),
    };
  }
  const data = JSON.parse(input.toString('utf8'));
  if (operation === 'audio-cost') {
    const result = audioCost({ sampleRate: data.rate, channels: data.channels, frames: BigInt(data.frames) });
    return { cost: String(result.cost), exclusion: result.exclusion };
  }
  if (operation === 'audio-wave') {
    const actual = inspectAudio(wave(data));
    if (actual.exclusion) return { exclusion: actual.exclusion };
    const result = audioCost(actual.facts);
    return { frames: String(actual.facts.frames), cost: String(result.cost), exclusion: result.exclusion };
  }
  if (operation === 'audio-selection') {
    const order: string[] = [];
    const plan = await selectAudio(data.references.map(([chain, x, y, line, identity]: [number, number, number, number, string]) => ({ chain, x, y, line, identity })),
      { chains: data.bounds[0], width: data.bounds[1], height: data.bounds[2] }, (identity: string): AudioInspection => {
        order.push(identity);
        const facts = data.facts[identity];
        return facts ? { exclusion: null, facts: { sampleRate: facts[0], channels: facts[1], frames: BigInt(facts[2]) } } : { exclusion: 'READ_FAILURE' };
      });
    return { order, selected: plan.files.filter(f => !f.exclusion).map(f => f.identity), exclusions: plan.files.map(f => f.exclusion), reservedCost: String(plan.reservedCost) };
  }
  throw new Error(`unknown admission operation ${operation}`);
}

/** Measure the mapper's actual output. Do not synthesize missing releases or remove extra waits. */
export async function mappingObservation(pack: UniPackData, input: Buffer): Promise<Json> {
  if (!pack.autoPlay) throw new Error('mapper case has no parsed autoPlay input');
  const { durations } = JSON.parse(input.toString('utf8')) as { durations: Record<string, number | null> };
  for (const chain of pack.soundTable) for (const column of chain) for (const queue of column) for (const sound of queue ?? []) {
    const name = sound.file.replace(/^(?:.*\/)?sounds\//i, '');
    const length = durations[name];
    sound.audioBuffer = typeof length === 'number' ? { duration: length / 1000 } as AudioBuffer : null;
  }
  const mapped = await new Promise<AutoPlay>((resolve, reject) => autoPlayMap(pack.autoPlay!, pack.soundTable,
    { onStart() {}, onGetWorkSize() {}, onProgress() {}, onDone: resolve, onError: reject }));
  let time = 0;
  const events: Json[] = [];
  for (const e of mapped.elements) {
    if (e.type === 'delay') time += e.delay;
    else if (e.type === 'chain') events.push(['chain', time, e.c]);
    else if (e.type === 'on') events.push(['on', time, e.currChain, e.x, e.y, e.num]);
    else events.push(['off', time, e.currChain, e.x, e.y]);
  }
  // Include an observed tail wait as well: it must not disappear just because no command follows it.
  if (time > Number((events.at(-1) as Json[] | undefined)?.[1] ?? 0)) events.push(['trailingDelay', time]);
  return { events };
}
