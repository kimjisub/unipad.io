// Adopted product behavior inputs. Actual operations, app UI and device verification stay distinct.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decision, pack } from './lib.mjs';

const source = new URL('../../src/lib/unipack/__fixtures__/audio-safety/', import.meta.url);
const manifest = readFileSync(new URL('cases.json', source));
const MANIFEST_SHA256 = '08e51f9cf9ae53de55080e9bd560d1a3395f76fb544d7e24bd83ab6b6d3e1d76';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonInput = input => ({ path: 'operation.json', text: JSON.stringify(input) });
export function productCases() {
  if (digest(manifest) !== MANIFEST_SHA256) throw new Error('shared audio admission revision 4 changed');
  const audio = JSON.parse(manifest);
  const cases = [];
  const add = (id, item, observation, title, files, expected, extra = {}) => cases.push({
    id, area: observation, layer: 'parse', title, productBehavior: true, observation,
    items: [item], expectation: 'determined', basis: [decision(`meta/unipack-conformance/GRAMMAR.md G6 ${item}`, title)],
    files, expected, ...extra,
  });
  audio.costs.forEach((c, i) => add(`SAFE-C${String(i + 1).padStart(3, '0')}`, 'PB-07', 'audio-cost',
    `exact integer admission: ${c.id}`, [jsonInput({ rate: c.rate, channels: c.channels, frames: String(c.frames) })],
    { cost: String(c.exclusion ? 0 : c.cost), exclusion: c.exclusion ?? null }));
  audio.files.forEach((c, i) => {
    const bytes = readFileSync(new URL(c.file, source));
    if (digest(bytes) !== c.sha256) throw new Error(`${c.file}: shared audio input changed`);
    add(`SAFE-F${String(i + 1).padStart(3, '0')}`, 'PB-07', 'audio-file', `structural file facts: ${c.file}`,
      [{ path: c.file, base64: bytes.toString('base64') }], c.exclusion ? { exclusion: c.exclusion }
        : { exclusion: null, rate: c.rate, channels: c.channels, frames: String(c.frames) });
  });
  audio.wavRecipes.forEach((c, i) => add(`SAFE-W${String(i + 1).padStart(3, '0')}`, 'PB-07', 'audio-wave',
    `physical PCM frames rather than a false time claim: ${c.id}`, [jsonInput({ rate: c.rate, channels: c.channels, frames: c.frames, claimedSeconds: c.claimedSeconds })],
    { frames: String(c.frames), cost: String(c.expectedCost), exclusion: c.exclusion ?? null }));
  audio.selections.forEach((c, i) => add(`SAFE-S${String(i + 1).padStart(3, '0')}`, 'PB-07', 'audio-selection',
    `immutable ordered admission: ${c.id}`, [jsonInput({ references: c.references, bounds: c.bounds, facts: c.facts })],
    { order: c.order, selected: c.selected, exclusions: c.exclusions, reservedCost: String(c.reservedCost) }));

  // All times are milliseconds. Durations are explicit mapper inputs, not claims of real decoding.
  const on = (t, x = 0, chain = 0, num = 0) => [['on', t, chain, x, 0, num], ['off', t, chain, x, 0]];
  const mapping = (id, script, durations, events) => add(id, 'PB-08', 'auto-map',
    'explicit auto-map preserves waits, simultaneous presses and paired releases',
    [...pack({ keySound: '1 1 1 a.wav\n1 2 1 b.wav\n2 1 1 b.wav', autoPlay: script }), jsonInput({ durations })],
    { events }, { layer: 'run', expectedFailing: ['web'] });
  mapping('MAP-P001', 'd 80\non 1 1\non 2 1\nd 20\nd 30\non 1 1\nd 999', { 'a.wav': 400.4, 'b.wav': 400.5 },
    [...on(1000), ...on(1000, 1), ...on(1401, 0, 0, 1)]);
  mapping('MAP-P002', 'on 1 1\nd 30\nd 40\non 2 1\nd 999', { 'a.wav': null, 'b.wav': 900 },
    [...on(1000), ...on(1070, 1)]);
  mapping('MAP-P003', 'on 1 1\nd 80\non 2 1', { 'a.wav': 400.4, 'b.wav': 900 }, [...on(1000), ...on(1400, 1)]);
  mapping('MAP-P004', 'on 1 1\nd 80\non 2 1', { 'a.wav': 400.5, 'b.wav': 900 }, [...on(1000), ...on(1401, 1)]);
  mapping('MAP-P005', 'on 1 1\nd 50\nc 2\non 1 1\nd 50\non 1 1', { 'a.wav': 300, 'b.wav': 500 },
    [...on(1000), ['chain', 1300, 1], ...on(1300, 0, 1), ...on(1800, 0, 1, 1)]);
  const run = (id, title, scenario, checkpoints) => add(id, 'PB-04', 'runner', title,
    pack({ keySound: '', autoPlay: 'touch 1 1\nd 2000' }), { checkpoints }, { layer: 'run', scenario, expectedFailing: ['android', 'ios', 'web'] });
  const start = [{ do: 'watchAutoEnd' }, { do: 'autoplay' }, { do: 'advance', ms: 1 }, { do: 'observe' }];
  run('RUN-P001', 'autoPlay stays active through its trailing delay and ends only at song time 2000',
    [...start, { do: 'advance', ms: 1998 }, { do: 'autoplayState' }, { do: 'observe' }, { do: 'advance', ms: 1 }, { do: 'autoplayState' }, { do: 'observe' }],
    [[['autoOn', 0, 0], ['autoOff', 0, 0]], [['autoActive', true]], [['autoEnd'], ['autoActive', false]]]);
  run('RUN-P002', 'suspending a trailing delay freezes its remaining song time',
    [...start, { do: 'advance', ms: 499 }, { do: 'suspendAuto' }, { do: 'advance', ms: 3000 }, { do: 'autoplayState' }, { do: 'observe' },
      { do: 'resumeAuto' }, { do: 'advance', ms: 1499 }, { do: 'autoplayState' }, { do: 'observe' }, { do: 'advance', ms: 1 }, { do: 'autoplayState' }, { do: 'observe' }],
    [[['autoOn', 0, 0], ['autoOff', 0, 0]], [['autoActive', true]], [['autoActive', true]], [['autoEnd'], ['autoActive', false]]]);
  return cases;
}
