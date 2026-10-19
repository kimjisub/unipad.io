// Run with: pnpm test:unipack
// Unlike the other *.test.mjs files these are compiled by tsc first: unipack imports its modules
// without extensions and names interfaces in value imports, which node's type stripping cannot load.
import JSZip from 'jszip';
import { mock } from 'node:test';
import { Worker } from 'node:worker_threads';
import { parseUniPack } from './parser';
import type { LedRunnerListener } from './LedRunner';
import type { UniPackData } from './types';

export const INFO_2X2_2CHAIN = 'title=Test\nproducerName=Tester\nbuttonX=2\nbuttonY=2\nchain=2\nsquareButton=true';
export const KEYSOUND_1_1_1 = '1 1 1 a.wav';
export const SILENT_WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

/** Builds a pack in memory with the given `path -> content` entries, the way a .zip upload reaches parseUniPack. */
export async function packZip(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

/**
 * A stored ZIP with literal name bytes and an optional UTF-8 mark. The default models older Korean
 * Windows archives. JSZip always marks or annotates non-ASCII names as UTF-8, so raw headers let us
 * test the unmarked path too. CRC is left 0; JSZip does not check it unless asked to.
 */
export function rawNameZip(entries: [name: Uint8Array, data: Uint8Array | string][], utf8 = false): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (fields: [number, 2 | 4][], name: Uint8Array) => {
    const bytes = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0) + name.length);
    const view = new DataView(bytes.buffer);
    let at = 0;
    for (const [value, size] of fields) {
      if (size === 2) view.setUint16(at, value, true); else view.setUint32(at, value, true);
      at += size;
    }
    bytes.set(name, at);
    return bytes;
  };
  for (const [name, content] of entries) {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    // version, flags (optional UTF-8 bit), method (stored), time, date, crc, sizes, name length, extra length
    const common: [number, 2 | 4][] = [[10, 2], [utf8 ? 0x800 : 0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2]];
    const local = header([[0x04034b50, 4], ...common], name);
    central.push(header([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]], name));
    chunks.push(local, data);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = header([[0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [centralSize, 4], [offset, 4], [0, 2]], new Uint8Array());
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out.buffer;
}

/** A 2x2, two-chain pack with one sound, plus the given keyLed files (`name -> content`). */
export async function parseWithLeds(leds: Record<string, string>): Promise<UniPackData> {
  const files: Record<string, string | Uint8Array> = {
    info: INFO_2X2_2CHAIN,
    keySound: KEYSOUND_1_1_1,
    'sounds/a.wav': SILENT_WAV,
  };
  for (const [name, content] of Object.entries(leds)) files[`keyLed/${name}`] = content;
  return parseUniPack(await packZip(files));
}

export type LedOutput =
  | ['padOn', number, number, number, number]
  | ['padOff', number, number]
  | ['chainOn', number, number, number]
  | ['chainOff', number];

export function recordingListener(): { listener: LedRunnerListener; outputs: LedOutput[] } {
  const outputs: LedOutput[] = [];
  return {
    outputs,
    listener: {
      onPadLedTurnOn: (x, y, color, velocity) => { outputs.push(['padOn', x, y, color, velocity]); },
      onPadLedTurnOff: (x, y) => { outputs.push(['padOff', x, y]); },
      onChainLedTurnOn: (c, color, velocity) => { outputs.push(['chainOn', c, color, velocity]); },
      onChainLedTurnOff: (c) => { outputs.push(['chainOff', c]); },
    },
  };
}

/**
 * Drives LedRunner's `window.setTimeout` loop and `performance.now()` by hand, so a test decides
 * exactly when each tick runs and how much time passed before it.
 */
export class ManualClock {
  now = 1000;
  private pending: (() => void) | null = null;

  install(): void {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: (fn: () => void) => { this.pending = fn; return 1; },
        clearTimeout: () => { this.pending = null; },
      },
    });
    mock.method(performance, 'now', () => this.now);
  }

  uninstall(): void {
    mock.restoreAll();
    Reflect.deleteProperty(globalThis, 'window');
  }

  get scheduled(): boolean {
    return this.pending !== null;
  }

  tick(ms: number): void {
    this.now += ms;
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
}

const PLAY_IN_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { ManualClock, parseWithLeds, recordingListener } = require(workerData.testUtils);
const { LedRunner } = require(workerData.ledRunner);
(async () => {
  const clock = new ManualClock();
  clock.install();
  const { listener, outputs } = recordingListener();
  const runner = new LedRunner(await parseWithLeds(workerData.leds), listener, () => 0, () => {});
  runner.launch();
  runner.eventOn(0, 0);
  for (let i = 0; i < 5; i++) clock.tick(4);
  parentPort.postMessage(outputs);
})();
`;

/**
 * Presses pad (0, 0) of a pack with the given keyLed files and runs five ticks in a worker thread.
 * Rejects when they do not finish before the deadline: a tick stuck in an endless loop blocks its
 * thread, and only terminating the worker gets the test process back.
 */
export function playInWorker(leds: Record<string, string>, deadlineMs = 5000): Promise<LedOutput[]> {
  const worker = new Worker(PLAY_IN_WORKER, {
    eval: true,
    workerData: { leds, testUtils: __filename, ledRunner: require.resolve('./LedRunner') },
  });
  let deadline: NodeJS.Timeout | undefined;
  return new Promise<LedOutput[]>((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error(`ticks did not return within ${deadlineMs} ms`)), deadlineMs);
    worker.once('message', resolve);
    worker.once('error', reject);
  }).finally(() => {
    clearTimeout(deadline);
    return worker.terminate();
  });
}
