import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const real = require('../../lib/unipack/index.ts');
// Keep the real parser, sound engine, runners and channels. Replace storage, analytics and MIDI I/O.
stub('../../lib/unipack/index.ts', { ...real,
  getSetting: async () => null, setSetting: async () => {},
  MidiConnection: class {
    async connect(listener) { midiListener = listener; return false; }
    getStatus() { return { connected: false, requestedProfile: 'auto', resolvedProfile: 'none', inputName: null, outputName: null }; }
    release() {} sendPadLed() {} sendChainLed() {} sendFunctionKeyLed() {} clearAllLeds() {}
  },
});
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent() {} });
const { useUniPadEngine } = require('./useUniPadEngine.ts');
let now, nextId, timers, starts, hidden, midiListener;
const flush = async action => act(async () => { await action?.(); });
const tick = async ms => flush(() => {
  now += ms;
  // A late browser tick dispatches each already-due callback once, without replaying newly queued timers.
  for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.run();
});
const visibility = async value => flush(() => {
  hidden = value;
  document.dispatchEvent(new window.Event('visibilitychange'));
});
beforeEach(() => {
  now = 1000; nextId = 0; timers = new Map(); starts = []; hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  mock.method(performance, 'now', () => now);
  const later = (run, ms = 0) => { const id = ++nextId; timers.set(id, { at: now + ms, run }); return id; };
  for (const target of [window, globalThis]) {
    mock.method(target, 'setTimeout', later);
    mock.method(target, 'clearTimeout', id => timers.delete(id));
  }
  window.requestAnimationFrame = globalThis.requestAnimationFrame = run => later(run, 0);
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame = id => timers.delete(id);
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async decodeAudioData() { return { duration: 0.1 }; }
    createBufferSource() { return { connect() {}, start() { starts.push(now); }, stop() {} }; }
    close() { this.state = 'closed'; }
  };
});
afterEach(() => { cleanup(); mock.restoreAll(); delete globalThis.AudioContext; });

async function mount({ autoPlay = 'd 10000\no 1 1\nf 1 1', led = 'o 1 1 a 5\nd 1000\nf 1 1\nd 1000\no 1 2 a 9', wormhole = false } = {}) {
  const zip = new JSZip();
  zip.file('info', 'title=Transitions\nproducerName=Test\nbuttonX=2\nbuttonY=2\nchain=3\nsquareButton=true');
  zip.file('keySound', `1 1 1 a.wav${wormhole ? ' 1 2' : ''}\n1 1 2 a.wav\n2 1 1 a.wav\n3 1 1 a.wav`);
  zip.file('sounds/a.wav', new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  zip.file('keyLED/1 1 1', led);
  zip.file('autoPlay', autoPlay);
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const view = renderHook(useUniPadEngine);
  await flush(() => view.result.current.loadUniPack(data));
  assert.equal(view.result.current.state.loaded, true);
  return view;
}
const draw = () => tick(0);

test('hidden autoplay freezes progress, sounds and chains, then resumes without a backlog', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\nc 2\no 1 1\nf 1 1\nd 1000\nc 3\no 1 1\nf 1 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(100);
  assert.equal(starts.length, 1);
  const progress = result.current.state.autoPlayProgress;
  await visibility(true);
  await tick(5000);
  await visibility(false);
  await tick(1);
  assert.equal(starts.length, 1, 'hidden time must not play queued sounds');
  assert.equal(result.current.state.chain, 0);
  assert.equal(result.current.state.autoPlayProgress, progress);
  await tick(899);
  assert.equal(starts.length, 2);
  assert.equal(result.current.state.chain, 1);
});

test('a finite light animation freezes while hidden and keeps its remaining delay', async () => {
  const { result } = await mount();
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(100); await draw();
  const color = result.current.state.padStates[0][0].color;
  assert.notEqual(color, 'transparent');
  await visibility(true);
  await tick(5000);
  await visibility(false);
  await tick(1); await draw();
  assert.equal(result.current.state.padStates[0][0].color, color);
  assert.equal(result.current.state.padStates[0][1].color, 'transparent');
  await tick(899); await draw();
  // The pressed feedback can cover pad 0,0; the second light still waits for its own time.
  assert.equal(result.current.state.padStates[0][1].color, 'transparent');
  await tick(1000); await draw();
  assert.notEqual(result.current.state.padStates[0][1].color, 'transparent');
});

test('returning to a paused autoplay does not start it', async () => {
  const { result } = await mount();
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(100);
  await flush(() => result.current.autoPlayPlayPause());
  await visibility(true); await tick(5000); await visibility(false); await tick(1);
  assert.equal(result.current.state.autoPlayPlaying, false);
  assert.equal(starts.length, 0);
});

for (const direction of ['next', 'prev']) test(`guide ${direction} moves the guide to the selected position`, async () => {
  const song = Array.from({ length: 60 }, (_, i) => `o 1 ${Math.floor(i / 5) % 2 + 1}\nf 1 ${Math.floor(i / 5) % 2 + 1}\nd 1000`).join('\n');
  const { result } = await mount({ autoPlay: song });
  await flush(() => result.current.switchPlayMode('guidePlay'));
  await tick(1);
  if (direction === 'prev') {
    // Seek ahead so the previous button must return to an earlier five-note group.
    await flush(() => result.current.autoPlayNext());
    await flush(() => result.current.autoPlayNext());
    await flush(() => result.current.autoPlayNext());
    await tick(1);
  }
  await flush(() => result.current[direction === 'next' ? 'autoPlayNext' : 'autoPlayPrev']());
  await tick(201); await draw();
  assert.equal(result.current.state.padStates[0][1].guide, true);
  const guides = result.current.state.padStates[0].filter(p => p.guide);
  assert.ok(guides.length > 0, 'the new position needs a guide');
  assert.ok(guides.every(p => p.guideTargetWallTimeMs >= now - 800 && p.guideTargetWallTimeMs <= now + 800), 'the upcoming guide must keep its lead time at the new position');
});

for (const selected of [0, 2]) test(`a chain choice of ${selected} cancels the pending wormhole`, async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(50);
  await flush(() => result.current.setChain(selected));
  await tick(50);
  assert.equal(result.current.state.chain, selected);
});

test('leaving the player cancels its pending wormhole', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0));
  await flush(() => result.current.unload());
  await tick(100);
  assert.equal(result.current.state.chain, 0);
});

test('without a user chain choice a wormhole still changes chain after 100 ms', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(99); assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});

test('destroy prevents the sound engine from calling its chain observer later', async () => {
  const { result } = await mount({ wormhole: true });
  const changes = [];
  const sound = new real.SoundEngine(result.current.state.unipack, () => 0, c => changes.push(c));
  sound.soundOn(0, 0);
  sound.destroy();
  await tick(100);
  assert.deepEqual(changes, []);
});


test('repeated visibility events preserve a guide target and its remaining lead time', async () => {
  const { result } = await mount({ autoPlay: 'd 500\no 1 1\nf 1 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('guidePlay'));
  await tick(100); await draw();
  const target = result.current.state.padStates[0][0].guideTargetWallTimeMs;
  assert.equal(target, 1500);
  await visibility(true); await tick(1000); await visibility(true); await tick(4000);
  await visibility(false); await visibility(false); await draw();
  assert.equal(result.current.state.padStates[0][0].guideTargetWallTimeMs, 6500);
  await tick(399); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, true);
  await tick(2); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, false);
});

test('a keyboard chain choice also cancels the pending wormhole', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0));
  await flush(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F3' })));
  await tick(100);
  assert.equal(result.current.state.chain, 2);
});

test('overlapping wormholes without a user choice keep their original order', async () => {
  const { result } = await mount({ wormhole: true });
  const pack = result.current.state.unipack;
  pack.soundTable[0][0][1][0].wormhole = 2;
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(50);
  await flush(() => result.current.padTouchOn(0, 1));
  await tick(50); assert.equal(result.current.state.chain, 1);
  await tick(50); assert.equal(result.current.state.chain, 2);
});

test('a pack opened while already hidden waits until it is visible', async () => {
  hidden = true;
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(5000);
  assert.equal(starts.length, 0);
  await visibility(false); await tick(1);
  assert.equal(starts.length, 1);
});

test('a light requested while hidden starts at the frozen position on return', async () => {
  const { result } = await mount();
  await visibility(true); await tick(1000);
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(4000); await visibility(false); await tick(4); await draw();
  assert.notEqual(result.current.state.padStates[0][0].color, 'transparent');
});

test('returning to paused guide practice does not restore its obsolete timed guide', async () => {
  const { result } = await mount({ autoPlay: 'd 500\no 1 1\nf 1 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('guidePlay'));
  await tick(100); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, true);
  await flush(() => result.current.autoPlayPlayPause()); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, false);
  await visibility(true); await tick(5000); await visibility(false); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, false);
  assert.equal(result.current.state.autoPlayPlaying, false);
});


test('a controller chain choice cancels the pending wormhole', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0));
  await flush(() => midiListener.onChainTouch(2));
  await tick(100);
  assert.equal(result.current.state.chain, 2);
});
