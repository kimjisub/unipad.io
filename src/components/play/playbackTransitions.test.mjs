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
let now, nextId, timers, starts, hidden, midiListener, audio, audioContexts;
const flush = async action => act(async () => { await action?.(); });
const tick = async ms => flush(() => {
  now += ms;
  if (audio?.state === 'running') audio.currentTime += ms / 1000;
  // A late browser tick dispatches each already-due callback once, without replaying newly queued timers.
  for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.run();
});
const visibility = async value => flush(() => {
  hidden = value;
  document.dispatchEvent(new window.Event('visibilitychange'));
});
beforeEach(() => {
  now = 1000; nextId = 0; timers = new Map(); starts = []; hidden = false; audioContexts = []; audio = null;
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
    state = 'running'; destination = {}; currentTime = 0;
    suspends = 0; resumes = 0; pendingResume = null;
    constructor() { audioContexts.push(this); }
    async suspend() { this.suspends++; this.state = 'suspended'; }
    async resume() {
      this.resumes++;
      if (this.pendingResume) await this.pendingResume;
      if (this.state !== 'closed') this.state = 'running';
    }
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
  audio = audioContexts.at(-1);
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
  await tick(998);
  assert.equal(starts.length, 1);
  await tick(1);
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
  // A late tick after the seek restarts the song there; the next note's guide follows its 800 ms lead.
  await tick(201);
  await tick(200); await draw();
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
  assert.equal(target, 1600);
  await visibility(true); await tick(1000); await visibility(true); await tick(4000);
  await visibility(false); await visibility(false); await draw();
  assert.equal(result.current.state.padStates[0][0].guideTargetWallTimeMs, 6600);
  await tick(499); await draw();
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


test('visibility freezes an active long sound with the remaining autoplay and light delay', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(100); await draw();
  const soundTime = audio.currentTime;
  await visibility(true);
  assert.equal(audio.suspends, 1);
  await tick(5000);
  assert.equal(audio.currentTime, soundTime, 'the sample must not advance while its sequencer is frozen');
  await visibility(false); await tick(999); await draw();
  assert.equal(starts.length, 1);
  await tick(1); await draw();
  assert.equal(starts.length, 2);
  assert.equal(Math.round((audio.currentTime - soundTime) * 1000), 1000);
});

test('the sequencer waits for asynchronous audio resume before counting its remaining delay', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay')); await tick(100);
  await visibility(true); await tick(5000);
  let finishResume;
  audio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false); await tick(2000);
  assert.equal(starts.length, 1, 'a slow resume must not advance the sequencer');
  await flush(finishResume); await tick(999);
  assert.equal(starts.length, 1);
  await tick(1); assert.equal(starts.length, 2);
});

test('a gesture while hidden does not resume suspended audio', async () => {
  await mount();
  await visibility(true);
  const resumes = audio.resumes;
  await flush(() => document.dispatchEvent(new window.Event('pointerdown')));
  assert.equal(audio.resumes, resumes);
  assert.equal(audio.state, 'suspended');
});

test('hiding again during a pending audio resume keeps the sequencer frozen', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay')); await tick(100);
  await visibility(true);
  let finishResume;
  audio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false);
  await visibility(true);
  await flush(finishResume); await tick(5000);
  assert.equal(starts.length, 1);
});

test('a rejected audio resume keeps playback frozen until the next visible gesture', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay')); await tick(100);
  await visibility(true);
  const resume = audio.resume.bind(audio);
  audio.resume = async () => { throw new Error('activation refused'); };
  await visibility(false); await tick(2000);
  assert.equal(starts.length, 1);
  assert.equal(audio.state, 'suspended');
  audio.resume = resume;
  await flush(() => document.dispatchEvent(new window.Event('pointerdown')));
  assert.equal(audio.state, 'running');
  await tick(999); assert.equal(starts.length, 1);
  await tick(1); assert.equal(starts.length, 2);
});


test('an obsolete resume cannot restart a new pack after unloading', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay')); await tick(100);
  await visibility(true);
  let finishResume;
  const oldAudio = audio;
  oldAudio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false);
  await flush(() => result.current.unload());
  await flush(finishResume); await tick(5000);
  assert.equal(oldAudio.state, 'closed');
  assert.equal(result.current.state.loaded, false);
  assert.equal(starts.length, 1);
});

test('an audio resume that resolves without running does not restart the sequencer', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay')); await tick(100);
  await visibility(true);
  const resume = audio.resume.bind(audio);
  audio.resume = async () => {};
  await visibility(false); await tick(2000);
  assert.equal(audio.state, 'suspended');
  assert.equal(starts.length, 1);
  audio.resume = resume;
  await flush(() => document.dispatchEvent(new window.Event('pointerdown')));
  await tick(999); assert.equal(starts.length, 1);
  await tick(1); assert.equal(starts.length, 2);
});


test('a hidden wormhole keeps its remaining 50 ms instead of changing chain early', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0)); await tick(50);
  await visibility(true); await tick(5000);
  assert.equal(result.current.state.chain, 0);
  assert.equal(audio.currentTime, 0.05);
  await visibility(false); await tick(49);
  assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});

test('a hidden wormhole waits for slow audio activation before counting its remaining delay', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0)); await tick(50); await visibility(true);
  let finishResume;
  audio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false); await tick(5000);
  assert.equal(result.current.state.chain, 0);
  await flush(finishResume); await tick(49);
  assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});

for (const refused of ['rejected', 'not running']) test(`a hidden wormhole waits after ${refused} audio activation until a visible retry`, async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0)); await tick(50); await visibility(true);
  const resume = audio.resume.bind(audio);
  audio.resume = async () => { if (refused === 'rejected') throw new Error('activation refused'); };
  await visibility(false); await tick(5000);
  assert.equal(result.current.state.chain, 0);
  audio.resume = resume;
  await flush(() => document.dispatchEvent(new window.Event('pointerdown')));
  await tick(49); assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});

test('hiding again during wormhole audio activation preserves the remaining delay', async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0)); await tick(50); await visibility(true);
  let finishResume;
  audio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false); await tick(1000); await visibility(true);
  await flush(finishResume); await tick(5000);
  assert.equal(result.current.state.chain, 0);
  await visibility(false); await tick(49); assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});

for (const action of ['selection', 'unload']) test(`${action} during wormhole suspension prevents a late chain change`, async () => {
  const { result } = await mount({ wormhole: true });
  await flush(() => result.current.padTouchOn(0, 0)); await tick(50); await visibility(true);
  let finishResume;
  audio.pendingResume = new Promise(resolve => { finishResume = resolve; });
  await visibility(false);
  await flush(() => action === 'selection' ? result.current.setChain(2) : result.current.unload());
  await flush(finishResume); await tick(5000);
  assert.equal(result.current.state.chain, action === 'selection' ? 2 : 0);
});

test('overlapping hidden wormholes resume in order without resetting on repeated hide events', async () => {
  const { result } = await mount({ wormhole: true });
  result.current.state.unipack.soundTable[0][0][1][0].wormhole = 2;
  await flush(() => result.current.padTouchOn(0, 0)); await tick(25);
  await flush(() => result.current.padTouchOn(0, 1)); await tick(25);
  await visibility(true); await tick(1000); await visibility(true); await tick(4000);
  assert.equal(result.current.state.chain, 0);
  await visibility(false); await tick(49); assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
  await tick(24); assert.equal(result.current.state.chain, 1);
  await tick(1); assert.equal(result.current.state.chain, 2);
});

test('a wormhole requested while hidden waits its full delay after audio resumes', async () => {
  const { result } = await mount({ wormhole: true });
  await visibility(true); await tick(1000);
  await flush(() => result.current.padTouchOn(0, 0)); await tick(4000);
  assert.equal(result.current.state.chain, 0);
  await visibility(false); await tick(99); assert.equal(result.current.state.chain, 0);
  await tick(1); assert.equal(result.current.state.chain, 1);
});
