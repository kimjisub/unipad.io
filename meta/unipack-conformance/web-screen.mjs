// Records screen-input scenarios through the actual play hook. Only storage, MIDI transport and the
// audio API are replaced; parser, input ownership, chain selection, engines and runners stay real.
// Called in a separate process because the hook owns DOM globals and module-level dependencies.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { fileBytes } from './lib.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-test.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(document, 'hidden', { value: false, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const real = require('../../src/lib/unipack/index.ts');
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let events, watchStops, names, started, now, timers, nextID, midi;
const hex = (value) => (value >>> 0).toString(16).padStart(8, '0');
const recordListener = (listener, fields) => new Proxy(listener, {
  get(target, key) {
    const run = target[key];
    if (typeof run !== 'function') return run;
    return (...args) => { if (fields[key]) events.push(fields[key](...args)); return run.apply(target, args); };
  },
});
stub('../../src/lib/unipack/index.ts', { ...real,
  getSetting: async () => null, setSetting: async () => {},
  MidiConnection: class {
    async connect(listener) { midi = listener; return false; }
    getStatus() { return { connected: false, requestedProfile: 'auto', resolvedProfile: 'none', inputName: null, outputName: null }; }
    release() {} sendPadLed() {} sendChainLed() {} sendFunctionKeyLed() {} clearAllLeds() {}
  },
  SoundEngine: class extends real.SoundEngine {
    constructor(pack, chainValue, setChain, ...rest) {
      super(pack, chainValue, c => { events.push(['chain', c]); setChain(c); }, ...rest);
      this.readChain = chainValue;
      names = [...pack.soundFiles.keys()];
    }
    soundOn(x, y, input) {
      const before = started.length, c = this.readChain();
      super.soundOn(x, y, input);
      for (const source of started.slice(before)) {
        const file = source.name.replace(/^(?:.*\/)?sounds\//i, '');
        const loop = source.stopAt === null ? (source.loop ? -1 : 0) : Math.round(source.stopAt / 0.01) - 1;
        source.pad = [c, x, y, file];
        events.push(['sound', ...source.pad, loop]);
      }
    }
  },
  LedRunner: class extends real.LedRunner {
    constructor(pack, listener, chainValue, setChain) {
      super(pack, recordListener(listener, {
        onPadLedTurnOn: (x, y, color, velocity) => ['ledOn', x, y, hex(color), velocity],
        onPadLedTurnOff: (x, y) => ['ledOff', x, y],
        onChainLedTurnOn: (c, color, velocity) => ['ledOn', -1, c, hex(color), velocity],
        onChainLedTurnOff: c => ['ledOff', -1, c],
      }), chainValue, c => { events.push(['chain', c]); setChain(c); });
    }
  },
  AutoPlayRunner: class extends real.AutoPlayRunner {
    constructor(pack, listener, ...rest) {
      super(pack, recordListener(listener, {
        onPadTouchOn: (x, y) => ['autoOn', x, y],
        onPadTouchOff: (x, y) => ['autoOff', x, y],
        onChainChange: c => ['autoChain', c],
      }), ...rest);
    }
  },
});
stub('../../src/lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent() {} });
const { useUniPadEngine } = require('../../src/components/play/useUniPadEngine.ts');
const flush = action => act(async () => { await action?.(); });
const tick = ms => flush(() => {
  const target = now + ms;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at; due[1].run();
  }
  now = target;
});
async function run({ files, scenario }, assets) {
  now = 1000; timers = new Map(); nextID = 0; started = []; events = []; watchStops = false;
  const saved = [];
  const replace = (target, name, value) => { saved.push([target, name, target[name]]); target[name] = value; };
  const later = (run, ms = 0) => { const id = ++nextID; timers.set(id, { at: now + ms, run }); return id; };
  replace(performance, 'now', () => now);
  for (const target of [window, globalThis]) {
    replace(target, 'setTimeout', later); replace(target, 'clearTimeout', id => timers.delete(id));
    replace(target, 'requestAnimationFrame', run => later(() => run(now), 16));
    replace(target, 'cancelAnimationFrame', id => timers.delete(id));
  }
  const previousAudio = globalThis.AudioContext;
  globalThis.AudioContext = class {
    state = 'running'; currentTime = 0; destination = {};
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async resume() {} async close() {}
    async decodeAudioData() { return { name: names.shift(), duration: 0.01 }; }
    createBufferSource() {
      const source = { name: '', loop: false, stopAt: null, stopped: false, pad: null };
      return {
        buffer: null, onended: null, connect() {},
        get loop() { return source.loop; }, set loop(value) { source.loop = value; },
        start() { source.name = this.buffer.name; started.push(source); },
        stop(at) {
          if (at !== undefined) source.stopAt = at;
          else if (!source.stopped) { source.stopped = true; if (watchStops && source.pad) events.push(['soundStop', ...source.pad]); }
        },
      };
    }
  };
  try {
    const zip = new JSZip();
    for (const file of files) {
      if (file.directory) zip.folder(file.path);
      else zip.file(file.path, fileBytes(file, assets));
    }
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    const view = renderHook(useUniPadEngine);
    await flush(() => view.result.current.loadUniPack(bytes));
    assert.equal(view.result.current.state.loaded, true, 'screen scenario must load its pack');
    // Setup notifications are not part of a press/release scenario.
    events = [];
    const checkpoints = [];
    for (const step of scenario) {
      const api = view.result.current;
      const input = step.input ?? 'pointer:1';
      switch (step.do) {
        case 'press':
          await flush(() => input.startsWith('midi:') ? midi.onPadTouch(step.x, step.y, true) : api.padTouchOn(step.x, step.y, input)); break;
        case 'release':
          await flush(() => input.startsWith('midi:') ? midi.onPadTouch(step.x, step.y, false) : api.padTouchOff(step.x, step.y, input)); break;
        case 'chain': await flush(() => api.setChain(step.c)); break;
        case 'autoplay': await flush(() => api.switchPlayMode('autoPlay')); break;
        case 'autoplayOff': await flush(() => api.switchPlayMode('none')); break;
        case 'watchStops': watchStops = true; break;
        case 'advance': await tick(step.ms); break;
        case 'observe': checkpoints.push(events); events = []; break;
        default: throw new Error(`unknown screen step ${step.do}`);
      }
    }
    return { checkpoints };
  } finally {
    await flush(() => cleanup());
    for (const [target, name, value] of saved.reverse()) target[name] = value;
    globalThis.AudioContext = previousAudio;
  }
}
const bytes = readFileSync(process.env.UNIPACK_CONFORMANCE_CORPUS ?? new URL('./corpus.json', import.meta.url));
const corpus = JSON.parse(bytes);
const results = [];
for (const c of corpus.cases.filter(c => c.screenInputs)) results.push({ id: c.id, actual: await run(c, corpus.assets) });
console.log('UNIPACK-SCREEN-RESULT ' + JSON.stringify({ corpusSha256: createHash('sha256').update(bytes).digest('hex'), cases: results }));
