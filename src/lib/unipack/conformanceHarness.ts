// Runs the cross-platform conformance corpus (meta/unipack-conformance) against the web player's real
// parser and runners. Android and iOS run the same corpus through their own parsers and runners; each
// harness turns what its code did into the normalized result the corpus states and never sees the
// expected side. See meta/unipack-conformance/README.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSZip from 'jszip';
import { AutoPlayListener, AutoPlayRunner } from './AutoPlayRunner';
import { changeChain, ledPushToNum } from './chainChange';
import { LedRunner, LedRunnerListener } from './LedRunner';
import { parseUniPack } from './parser';
import { SoundEngine } from './SoundEngine';
import type { Sound, UniPackData } from './types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Files = CorpusFile[];

export interface CorpusFile { path: string; text?: string; base64?: string; asset?: string }
export interface Known {
  status: 'fail' | 'unsupported' | 'intended-difference';
  actual: Json;
  note: string;
  /** The same difference as the platform gives it elsewhere (another file system, say). */
  otherActuals?: { where: string; actual: Json }[];
}
export interface CorpusCase {
  id: string;
  layer: 'parse' | 'palette' | 'run';
  area: string;
  title: string;
  files: Files;
  fingerprint: string;
  expectation: 'determined' | 'undetermined';
  expected?: Json;
  question?: string;
  scenario?: { do: string; x?: number; y?: number; c?: number; ms?: number; toPads?: boolean }[];
  /** The grammar items (meta/unipack-conformance/GRAMMAR.md) the case checks. */
  items?: string[];
  known?: Record<string, Known>;
  /** Per platform, why its harness cannot observe this case; it is unverified there and not run. */
  unobserved?: Record<string, string>;
}
export interface Corpus {
  schema: string;
  assets: Record<string, { base64: string }>;
  palette: { argb: string[] };
  cases: CorpusCase[];
}

export type Status = 'pass' | 'fail' | 'unsupported' | 'intended-difference' | 'unverified';
export interface Outcome {
  status: Status;
  /** True when the result is a failure nothing in the corpus accounts for, or a pinned one that changed. */
  unexpected: boolean;
  detail: string;
}

export const PLATFORM = 'web';

export function corpusPath(): string {
  return process.env.UNIPACK_CONFORMANCE_CORPUS ?? join(process.cwd(), 'meta/unipack-conformance/corpus.json');
}

/**
 * The sha256 of the corpus.json bytes, after checking it against the corpus.sha256 written beside it by
 * build-corpus.mjs. A copy without that file, or one that does not hash to it, is refused.
 */
export function verifyCorpusDigest(bytes: Buffer, digestFile: string | null): string {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (digestFile === null) throw new Error('corpus.sha256 is missing beside corpus.json; copy both with meta/unipack-conformance/sync.mjs');
  const declared = /^([0-9a-f]{64}) {2}corpus\.json\n$/.exec(digestFile)?.[1];
  if (!declared) throw new Error(`corpus.sha256 is not one "<sha256>  corpus.json" line: ${JSON.stringify(digestFile)}`);
  if (declared !== actual) throw new Error(`corpus.json hashes to ${actual}, corpus.sha256 declares ${declared}`);
  return actual;
}

export function loadCorpus(): { corpus: Corpus; sha256: string } {
  const path = corpusPath();
  const bytes = readFileSync(path);
  const digestPath = join(dirname(path), 'corpus.sha256');
  const sha256 = verifyCorpusDigest(bytes, existsSync(digestPath) ? readFileSync(digestPath, 'utf8') : null);
  return { corpus: JSON.parse(bytes.toString('utf8')) as Corpus, sha256 };
}

// ---------------------------------------------------------------------------------------------
// Input files and fingerprint (the same formula as meta/unipack-conformance/lib.mjs)
// ---------------------------------------------------------------------------------------------

export function fileBytes(file: CorpusFile, corpus: Corpus): Buffer {
  if (file.text !== undefined) return Buffer.from(file.text, 'utf8');
  if (file.base64 !== undefined) return Buffer.from(file.base64, 'base64');
  if (file.asset !== undefined) return Buffer.from(corpus.assets[file.asset].base64, 'base64');
  throw new Error(`file ${file.path} has no content`);
}

export function fingerprintOf(files: Files, corpus: Corpus): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const hash = createHash('sha256');
  for (const file of sorted) {
    const bytes = fileBytes(file, corpus);
    hash.update(Buffer.concat([Buffer.from(file.path, 'utf8'), Buffer.from([0]), Buffer.from(String(bytes.length), 'ascii'), Buffer.from([0]), bytes, Buffer.from([10])]));
  }
  return hash.digest('hex');
}

/** Refuses a case whose files no longer hash to the fingerprint it declares. */
export function verifyFingerprint(c: CorpusCase, corpus: Corpus): void {
  const actual = fingerprintOf(c.files, corpus);
  if (actual !== c.fingerprint) throw new Error(`${c.id}: input files hash to ${actual}, the case declares ${c.fingerprint}`);
}

async function zipOf(c: CorpusCase, corpus: Corpus): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const file of c.files) zip.file(file.path, fileBytes(file, corpus));
  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------------------------------------------------------------------------------------------
// Normalized result
// ---------------------------------------------------------------------------------------------

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/** "keySound: [..] format is incorrect" -> "keySound:format"; see README, "Error kinds". */
export function normalizeError(message: string): string {
  const section = /^([A-Za-z.]+)\s*:/.exec(message)?.[1] ?? 'unknown';
  let kind: string;
  if (/format is (incorrect|not found)/.test(message)) kind = 'format';
  else if (/\b(chain|x|y|loop|coordinate|delay) is incorrect\b|out of range/.test(message)) kind = 'range';
  else if (/was not found|directory not found|doesn't exist/.test(message)) kind = 'missing-file';
  else if (/was missing/.test(message)) kind = 'missing-field';
  else kind = `other(${message})`;
  return `${section}:${kind}`;
}

function soundName(sound: Sound): string {
  const match = /(?:^|\/)sounds\/(.*)$/i.exec(sound.file);
  return match ? match[1] : sound.file;
}

export function parseResult(pack: UniPackData): Json {
  const { info } = pack;
  const infoOut: { [key: string]: Json } = {
    title: info.title, producerName: info.producerName, buttonX: info.buttonX, buttonY: info.buttonY, chain: info.chain, squareButton: info.squareButton,
  };
  if (info.website) infoOut.website = info.website;

  const sounds: Json[] = [];
  const leds: Json[] = [];
  for (let c = 0; c < info.chain; c++) {
    for (let x = 0; x < info.buttonX; x++) {
      for (let y = 0; y < info.buttonY; y++) {
        const queue = pack.soundTable[c][x][y];
        if (queue && queue.length > 0) sounds.push({ c, x, y, queue: queue.map((s) => ({ file: soundName(s), loop: s.loop, wormhole: s.wormhole })) });
        const animations = pack.ledAnimationTable?.[c][x][y];
        if (animations && animations.length > 0) {
          leds.push({
            c, x, y,
            queue: animations.map((a) => ({
              loop: a.loop,
              events: a.ledEvents.map((e): Json => {
                switch (e.type) {
                  case 'on': return ['on', e.x, e.y, hex8(e.color), e.velocity];
                  case 'off': return ['off', e.x, e.y];
                  case 'delay': return ['delay', e.delay];
                  case 'chain': return ['chain', e.chain];
                }
              }),
            })),
          });
        }
      }
    }
  }

  const autoPlay: Json = pack.autoPlay
    ? pack.autoPlay.elements.map((e): Json => {
      switch (e.type) {
        case 'on': return ['on', e.x, e.y, e.currChain, e.num];
        case 'off': return ['off', e.x, e.y, e.currChain];
        case 'chain': return ['chain', e.c];
        case 'delay': return ['delay', e.delay];
      }
    })
    : null;

  return {
    loaded: true, info: infoOut, sounds, keyLedExist: pack.keyLedExist, leds, autoPlay, errors: pack.errors.map(normalizeError),
  };
}

// ---------------------------------------------------------------------------------------------
// Running a case. `deps` lets the self-checks replace the code under test with a stand-in to prove
// that a case fails when the call is left out.
// ---------------------------------------------------------------------------------------------

export interface Deps {
  parse: (zip: ArrayBuffer) => Promise<UniPackData>;
  LedRunner: typeof LedRunner;
  AutoPlayRunner: typeof AutoPlayRunner;
  SoundEngine: typeof SoundEngine;
  /** What the play screen (useUniPadEngine setChain) does with every chain change. */
  changeChain: typeof changeChain;
}

export const REAL: Deps = { parse: parseUniPack, LedRunner, AutoPlayRunner, SoundEngine, changeChain };

async function parseOrRefuse(c: CorpusCase, corpus: Corpus, deps: Deps): Promise<{ pack: UniPackData } | { refused: string }> {
  try {
    return { pack: await deps.parse(await zipOf(c, corpus)) };
  } catch (error) {
    // The web parser throws for a pack it refuses; anything else is a bug the case must surface.
    if (error instanceof Error && error.message.startsWith('Invalid UniPack')) return { refused: error.message };
    throw error;
  }
}

/**
 * The parser's warnings exactly as it wrote them, before normalizeError reduces them to `section:kind`,
 * with the pack size they were checked against. A refused pack has no warnings to read (the parser
 * throws), only the refusal. Kept apart from the normalized result, which it never changes; see
 * meta/unipack-conformance/diagnostics/README.md.
 */
export interface WarningCapture {
  warnings: string[] | null;
  pack: { buttonX: number; buttonY: number; chain: number } | null;
  refused: string | null;
}

export interface Observation { actual: Json; capture: WarningCapture | null }

export async function observe(c: CorpusCase, corpus: Corpus, deps: Deps = REAL): Promise<Observation> {
  if (c.layer === 'palette') return { actual: { argb: (await import('./colors')).LAUNCHPAD_ARGB.map(hex8) }, capture: null };
  const parsed = await parseOrRefuse(c, corpus, deps);
  if ('refused' in parsed) return { actual: { loaded: false }, capture: { warnings: null, pack: null, refused: parsed.refused } };
  const { pack } = parsed;
  const capture: WarningCapture = {
    warnings: [...pack.errors], pack: { buttonX: pack.info.buttonX, buttonY: pack.info.buttonY, chain: pack.info.chain }, refused: null,
  };
  const actual = c.layer === 'parse' ? parseResult(pack) : { checkpoints: await runScenario(c, pack, deps) };
  return { actual, capture };
}

export async function actualFor(c: CorpusCase, corpus: Corpus, deps: Deps = REAL): Promise<Json> {
  return (await observe(c, corpus, deps)).actual;
}

export const WARNING_CAPTURE_KIND = 'unipack-conformance-raw-warnings';

/** One case of the raw warning file: its input files as text where they are text, and what the parser wrote. */
export function capturedCase(c: CorpusCase, corpus: Corpus, capture: WarningCapture): Json {
  const inputs = c.files.map((f): Json => (f.text !== undefined ? { path: f.path, text: f.text } : { path: f.path, bytes: fileBytes(f, corpus).length }));
  return { id: c.id, fingerprint: c.fingerprint, layer: c.layer, inputs, warnings: capture.warnings, pack: capture.pack, refused: capture.refused };
}

function sourceRevision(): Json {
  const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0) return { commit: null, uncommittedChanges: null };
  const status = git('status', '--porcelain');
  return { commit: head.stdout.trim(), uncommittedChanges: status.status === 0 ? status.stdout.trim() !== '' : null };
}

/** The file meta/unipack-conformance/diagnostics/number-warnings.mjs reads. */
export function warningCaptureFile(cases: Json[], corpusSha256: string): Json {
  return {
    kind: WARNING_CAPTURE_KIND,
    platform: PLATFORM,
    corpusSha256,
    generatedAt: new Date().toISOString(),
    source: sourceRevision(),
    method: 'collected at run time: parseUniPack (src/lib/unipack/parser.ts) read a zip of each case\'s files, and UniPackData.errors was copied as written, before normalizeError',
    cases,
  };
}

/** A virtual clock for every timer the runners use: window.setTimeout, setTimeout and performance.now. */
class VirtualClock {
  now = 1000;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;
  private saved: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; now: () => number; window: unknown; hadWindow: boolean } | null = null;

  install(): void {
    this.saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: performance.now.bind(performance), window: (globalThis as { window?: unknown }).window, hadWindow: 'window' in globalThis };
    const set = ((fn: () => void, ms = 0) => {
      const id = this.nextId++;
      this.timers.push({ id, at: this.now + ms, fn });
      return id;
    }) as unknown as typeof setTimeout;
    const clear = ((id: number) => { this.timers = this.timers.filter((t) => t.id !== id); }) as unknown as typeof clearTimeout;
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { setTimeout: set, clearTimeout: clear } });
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
    performance.now = () => this.now;
  }

  uninstall(): void {
    const s = this.saved;
    if (!s) return;
    globalThis.setTimeout = s.setTimeout;
    globalThis.clearTimeout = s.clearTimeout;
    performance.now = s.now;
    if (s.hadWindow) Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: s.window });
    else Reflect.deleteProperty(globalThis, 'window');
    this.saved = null;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      due.fn();
    }
    this.now = target;
  }
}

/** A WAV (RIFF), or MP3 with an ID3 tag or starting at a frame; what the decoder stand-in accepts. */
function looksLikeAudio(bytes: Uint8Array): boolean {
  const ascii = (at: number, text: string) => [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
  return (ascii(0, 'RIFF') && ascii(8, 'WAVE')) || ascii(0, 'ID3') || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

interface StartedSource { name: string; loop: boolean; stopAt: number | null; stopped: boolean; pad: Json[] | null }

/**
 * The part of the Web Audio API SoundEngine touches, recording every started source. It decodes no
 * audio: a buffer stands for any bytes that start like a WAV or an MP3, and other bytes fail to decode
 * as they would in a browser.
 */
class FakeAudioContext {
  static decodeNames: string[] = [];
  static started: StartedSource[] = [];
  /** Called when a started source is stopped at once, the first time only (a scheduled stop is not). */
  static onStopped: (source: StartedSource) => void = () => {};
  state = 'running';
  currentTime = 0;
  destination = {};
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  async resume() {}
  async close() {}
  async decodeAudioData(data: ArrayBuffer) {
    const name = FakeAudioContext.decodeNames.shift() ?? '?';
    if (!looksLikeAudio(new Uint8Array(data))) throw new Error(`EncodingError: ${name} is not audio`);
    return { name, duration: 0.01 };
  }
  createBufferSource() {
    const record: StartedSource = { name: '', loop: false, stopAt: null, stopped: false, pad: null };
    const node = {
      buffer: null as { name: string } | null,
      get loop() { return record.loop; },
      set loop(v: boolean) { record.loop = v; },
      connect() {},
      onended: null as (() => void) | null,
      start() { record.name = node.buffer?.name ?? '?'; FakeAudioContext.started.push(record); },
      stop(when?: number) {
        if (when !== undefined) record.stopAt = when;
        else if (!record.stopped) { record.stopped = true; FakeAudioContext.onStopped(record); }
      },
    };
    return node;
  }
}

async function runScenario(c: CorpusCase, pack: UniPackData, deps: Deps): Promise<Json[]> {
  const clock = new VirtualClock();
  const g = globalThis as { AudioContext?: unknown };
  const savedAudioContext = g.AudioContext;
  clock.install();
  g.AudioContext = FakeAudioContext;
  FakeAudioContext.started = [];
  FakeAudioContext.decodeNames = Array.from(pack.soundFiles.keys());

  let chain = 0;
  let events: Json[] = [];
  let watchStops = false;
  const checkpoints: Json[] = [];
  const chainValue = () => chain;
  // Every chain change goes through what the play screen does with it; `tag` names the event it records.
  let sound: SoundEngine | null = null;
  const switchChain = (next: number, tag: 'chain' | 'autoChain' | null) => {
    const changed = deps.changeChain(pack, next, sound);
    if (changed === null) return;
    chain = changed;
    if (tag) events.push([tag, changed]);
  };
  FakeAudioContext.onStopped = (source) => { if (watchStops && source.pad) events.push(['soundStop', ...source.pad]); };

  const ledListener: LedRunnerListener = {
    onPadLedTurnOn: (x, y, color, velocity) => { events.push(['ledOn', x, y, hex8(color), velocity]); },
    onPadLedTurnOff: (x, y) => { events.push(['ledOff', x, y]); },
    onChainLedTurnOn: (i, color, velocity) => { events.push(['ledOn', -1, i, hex8(color), velocity]); },
    onChainLedTurnOff: (i) => { events.push(['ledOff', -1, i]); },
  };
  const led = new deps.LedRunner(pack, ledListener, chainValue, (next) => switchChain(next, 'chain'));
  const engine = new deps.SoundEngine(pack, chainValue, (next) => switchChain(next, 'chain'));
  sound = engine;
  await engine.load();
  led.launch();
  let autoPlay: AutoPlayRunner | null = null;

  // A pad press and release as the play screen sends them to the sound engine and the LED runner.
  const pressPad = (x: number, y: number) => {
    const before = FakeAudioContext.started.length;
    const at = chain;
    engine.soundOn(x, y);
    for (const started of FakeAudioContext.started.slice(before)) {
      // Once: no loop. Endless: loop with no stop time. N repeats: stop scheduled after N+1 plays of 10 ms.
      const loop = started.stopAt === null ? (started.loop ? -1 : 0) : Math.round(started.stopAt / 0.01) - 1;
      const file = started.name.replace(/^(?:.*\/)?sounds\//i, '');
      started.pad = [at, x, y, file];
      events.push(['sound', at, x, y, file, loop]);
    }
    led.eventOn(x, y);
  };
  const releasePad = (x: number, y: number) => {
    engine.soundOff(x, y);
    led.eventOff(x, y);
  };

  try {
    for (const step of c.scenario ?? []) {
      switch (step.do) {
        case 'press':
          pressPad(step.x!, step.y!);
          break;
        case 'release':
          releasePad(step.x!, step.y!);
          break;
        case 'chain':
          switchChain(step.c!, null);
          break;
        case 'watchStops':
          watchStops = true;
          break;
        case 'advance':
          clock.advance(step.ms!);
          break;
        case 'observe':
          checkpoints.push(events);
          events = [];
          break;
        case 'autoplay': {
          // toPads: the presses also reach the pads, as useUniPadEngine forwards them to padTouchOn/Off.
          const toPads = step.toPads === true;
          const listener: AutoPlayListener = {
            onStart() {}, onEnd() {}, onProgressUpdate() {},
            onPadTouchOn: (x, y) => { events.push(['autoOn', x, y]); if (toPads) pressPad(x, y); },
            onPadTouchOff: (x, y) => { events.push(['autoOff', x, y]); if (toPads) releasePad(x, y); },
            onChainChange: (next) => switchChain(next, 'autoChain'),
            onGuidePadOn() {}, onGuidePadOff() {}, onGuideLedUpdate() {}, onGuideChainOn() {}, onRemoveGuide() {},
          };
          // The queue callbacks the play screen hands the runner (useUniPadEngine).
          autoPlay = new deps.AutoPlayRunner(pack, listener, chainValue, () => {},
            (c, x, y, num) => engine.soundPushToNum(c, x, y, num), (c, x, y, num) => ledPushToNum(pack, c, x, y, num));
          autoPlay.launch();
          break;
        }
        case 'stop':
          autoPlay?.stop();
          led.stop();
          engine.destroy();
          break;
        default:
          throw new Error(`${c.id}: unknown scenario step ${step.do}`);
      }
    }
  } finally {
    autoPlay?.stop();
    led.stop();
    FakeAudioContext.onStopped = () => {};
    clock.uninstall();
    g.AudioContext = savedAudioContext;
  }
  return checkpoints;
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

/** What this platform reports for a case: its result and status, or why the case is not observed here. */
export async function resultFor(c: CorpusCase, corpus: Corpus, deps: Deps = REAL): Promise<Observation & { outcome: Outcome }> {
  const unobserved = c.unobserved?.[PLATFORM];
  if (unobserved) return { actual: null, capture: null, outcome: { status: 'unverified', unexpected: false, detail: unobserved } };
  const { actual, capture } = await observe(c, corpus, deps);
  return { actual, capture, outcome: classify(c, actual) };
}

export function classify(c: CorpusCase, actual: Json, platform: string = PLATFORM): Outcome {
  if (c.expectation === 'undetermined') {
    return { status: 'unverified', unexpected: false, detail: `no doc or stated intent decides this: ${c.question}` };
  }
  const known = c.known?.[platform];
  if (isDeepStrictEqual(actual, c.expected)) {
    return known
      ? { status: 'pass', unexpected: true, detail: 'a pinned difference no longer occurs; update divergences.json' }
      : { status: 'pass', unexpected: false, detail: '' };
  }
  if (known) {
    return isDeepStrictEqual(actual, known.actual) || (known.otherActuals ?? []).some((o) => isDeepStrictEqual(actual, o.actual))
      ? { status: known.status, unexpected: false, detail: known.note }
      : { status: 'fail', unexpected: true, detail: 'the result changed from the pinned difference' };
  }
  return { status: 'fail', unexpected: true, detail: 'differs from the expected result and nothing in the corpus accounts for it' };
}
