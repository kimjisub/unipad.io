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
    constructor() { midiConnections.push(this); this.released = false; this.connected = nextMidiConnected; }
    async connect(listener, options) { midiListener = listener; const gate = midiConnectGate; midiConnectGate = null; if (gate) await gate; options?.onStatusChange?.(this.getStatus()); return this.connected; }
    getStatus() { return { connected: this.connected, requestedProfile: 'auto', resolvedProfile: this.connected ? 'launchpad_x' : 'none', inputName: this.connected ? 'Launchpad X' : null, outputName: this.connected ? 'Launchpad X' : null }; }
    release() { this.released = true; } sendPadLed() {} sendChainLed() {} sendFunctionKeyLed() {} clearAllLeds() {}
  },
});
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent() {} });
const { useUniPadEngine } = require('./useUniPadEngine.ts');
let now, nextId, timers, starts, hidden, midiListener, audio, audioContexts, sources, midiConnections, nextMidiConnected, midiConnectGate;
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
  now = 1000; nextId = 0; timers = new Map(); starts = []; hidden = false; audioContexts = []; audio = null; sources = []; midiConnections = []; nextMidiConnected = false; midiConnectGate = null;
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
    createGain() { this.outputGain = { value: 1 }; return { gain: this.outputGain, connect() {} }; }
    async decodeAudioData() { return { duration: 0.1 }; }
    createBufferSource() {
      const source = { stopped: false, connect() {}, start() { starts.push(now); }, stop(at) { if (at === undefined) this.stopped = true; } };
      sources.push(source);
      return source;
    }
    close() { this.state = 'closed'; }
  };
});
afterEach(() => { cleanup(); mock.restoreAll(); delete globalThis.AudioContext; });

async function mount({ autoPlay = 'd 10000\no 1 1\nf 1 1', led = 'o 1 1 a 5\nd 1000\nf 1 1\nd 1000\no 1 2 a 9', wormhole = false, ledName = '1 1 1', keySound } = {}) {
  const zip = new JSZip();
  zip.file('info', 'title=Transitions\nproducerName=Test\nbuttonX=2\nbuttonY=2\nchain=3\nsquareButton=true');
  zip.file('keySound', keySound ?? `1 1 1 a.wav${wormhole ? ' 1 2' : ''}\n1 1 2 a.wav\n2 1 1 a.wav\n3 1 1 a.wav`);
  zip.file('sounds/a.wav', new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  zip.file(`keyLED/${ledName}`, led);
  zip.file('autoPlay', autoPlay);
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const view = renderHook(useUniPadEngine);
  await flush(() => view.result.current.loadUniPack(data));
  assert.equal(view.result.current.state.loaded, true);
  audio = audioContexts.at(-1);
  return { ...view, data };
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

for (const resume of ['button', 'mode']) test(`resuming guide via ${resume} discards the scanned step and guides only upcoming notes`, async () => {
  const { result } = await mount({ autoPlay: 'd 1000\no 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 1000\no 2 1\nf 2 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('guidePlay'));
  await tick(1); await tick(200); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, true);
  await flush(() => result.current.autoPlayPlayPause());
  await tick(1); await draw();
  assert.equal(result.current.state.padStates[0][0].guide, true, 'the scanned step is offered until resume');
  const progress = result.current.state.autoPlayProgress;
  await tick(2000);
  await flush(() => resume === 'button' ? result.current.autoPlayPlayPause() : result.current.switchPlayMode('guidePlay'));
  await tick(1); await draw();
  assert.equal(result.current.state.autoPlayProgress, progress + 1, 'resume consumes only the next delay, without replaying the scanned note');
  assert.equal(result.current.state.padStates[0][0].guide, false, 'the scanned note must not reappear');
  await tick(200); await draw();
  assert.equal(result.current.state.padStates[0][1].guide, true, 'the next unscanned note gets its full guide');
  assert.equal(result.current.state.padStates[0][1].guideTargetWallTimeMs, now + 800);
  assert.equal(result.current.state.padStates[0][0].guide, false);
});

for (const resume of ['button', 'mode']) {
  const resumeGuide = result => flush(() => resume === 'button'
    ? result.current.autoPlayPlayPause() : result.current.switchPlayMode('guidePlay'));

  test(`resuming guide via ${resume} before a step tick preserves the remaining half-second`, async () => {
    const { result } = await mount({ autoPlay: 'd 1000\no 1 1\nf 1 1\nd 10000' });
    await flush(() => result.current.switchPlayMode('guidePlay'));
    await tick(1); await tick(500); await draw();
    const target = result.current.state.padStates[0][0].guideTargetWallTimeMs;
    assert.equal(target - now, 500);
    await flush(() => result.current.autoPlayPlayPause());
    // Both inputs happen before the sequencer can scan a step.
    await resumeGuide(result);
    await tick(1); await draw();
    assert.equal(result.current.state.padStates[0][0].guide, true);
    assert.equal(result.current.state.padStates[0][0].guideTargetWallTimeMs, target);
    await tick(498); await draw();
    assert.equal(result.current.state.padStates[0][0].guide, true);
    await tick(1); await draw();
    assert.equal(result.current.state.padStates[0][0].guide, false);
  });

  test(`resuming guide via ${resume} after scanning only a chain keeps the remaining delay`, async () => {
    const { result } = await mount({ autoPlay: 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000' });
    await flush(() => result.current.switchPlayMode('guidePlay'));
    await tick(1); await tick(1000); await tick(100); await draw();
    await flush(() => result.current.autoPlayPlayPause());
    await tick(200); await draw();
    assert.equal(result.current.state.chainStates.some(chain => chain.guide), true);
    await resumeGuide(result);
    await tick(1); await tick(199);
    await flush(() => result.current.setChain(1));
    await tick(1); await tick(1); await draw();
    const pad = result.current.state.padStates[0][1];
    assert.equal(pad.guide, true, 'finding another chain without scanning a pad must preserve song time');
    // Of the remaining 900 ms, 200 ms elapse before the chain prompt, then one tick draws the pad.
    const remainingMs = 699;
    assert.equal(pad.guideTargetWallTimeMs - now, remainingMs);
    await tick(remainingMs - 1); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, true);
    await tick(1); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, false);
  });

  test(`resuming guide via ${resume} after a chain-only scan keeps additional wait lines`, async () => {
    const { result } = await mount({ autoPlay: 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\nd 1000\no 1 2\nf 1 2\nd 10000' });
    await flush(() => result.current.switchPlayMode('guidePlay'));
    await tick(1); await tick(1000); await tick(100); await draw();
    await flush(() => result.current.autoPlayPlayPause());
    await tick(200); await draw();
    await resumeGuide(result);
    await tick(1); await tick(199);
    await flush(() => result.current.setChain(1));
    await tick(900); await draw();
    assert.equal(result.current.state.autoPlayEnabled, true, 'the unconsumed wait must not end the song early');
    const pad = result.current.state.padStates[0][1];
    assert.equal(pad.guide, true);
    assert.equal(pad.guideTargetWallTimeMs - now, 800);
    await tick(799); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, true);
    await tick(1); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, false);
  });

  test(`resuming guide via ${resume} while awaiting a chain preserves the next note lead time`, async () => {
    const { result } = await mount({ autoPlay: 'd 1000\no 1 1\nf 1 1\nd 1000\nc 2\no 1 2\nf 1 2\nd 10000' });
    await flush(() => result.current.switchPlayMode('guidePlay'));
    await tick(1); await tick(1000); await tick(200); await draw();
    const progress = result.current.state.autoPlayProgress;
    await flush(() => result.current.autoPlayPlayPause());
    await tick(200); await draw();
    assert.equal(result.current.state.autoPlayProgress, progress, 'waiting for a chain does not scan a step');
    await resumeGuide(result);
    await tick(1);
    await flush(() => result.current.setChain(1));
    await tick(1); await tick(1); await draw();
    const pad = result.current.state.padStates[0][1];
    assert.equal(pad.guide, true);
    assert.equal(pad.guideTargetWallTimeMs - now, 798);
    await tick(797); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, true);
    await tick(1); await draw();
    assert.equal(result.current.state.padStates[0][1].guide, false);
  });
}

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

test('a keyboard chain choice cancels the pending wormhole', async () => {
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

for (const action of ['selection', 'unload']) test(`${action} during wormhole suspension follows its chain-change rule`, async () => {
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


test('autoplay wormholes do not repeat a parsed chain move 100 ms later', async () => {
  const { result } = await mount({ wormhole: true, autoPlay: 'o 1 1\nd 50\nc 3\nd 1000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1); assert.equal(result.current.state.chain, 1);
  await tick(50); assert.equal(result.current.state.chain, 2);
  await tick(51); assert.equal(result.current.state.chain, 2);
});

test('pause preserves the unplayed part of a delay', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nd 1000\no 1 2\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  await tick(500); assert.equal(starts.length, 1);
  await flush(() => result.current.autoPlayPlayPause());
  await tick(3000);
  await flush(() => result.current.autoPlayPlayPause());
  await tick(499); assert.equal(starts.length, 1);
  await tick(1); assert.equal(starts.length, 2);
});

for (const action of ['autoPlayPlayPause', 'autoPlayNext', 'autoPlayPrev', 'stop']) {
  test(`${action} ends endless light animations from every chain`, async () => {
    const { result } = await mount({ autoPlay: 'o 1 1\n' + 'f 1 2\n'.repeat(45) + 'c 2\nd 10000\no 1 2', ledName: '1 1 1 0', led: 'o 2 2 a 5\nd 10\nf 2 2\nd 10' });
    await flush(() => result.current.switchPlayMode('autoPlay'));
    await tick(1); await tick(4); await draw();
    assert.notEqual(result.current.state.padStates[1][1].color, 'transparent');
    await flush(() => action === 'stop' ? result.current.switchPlayMode('autoPlay') : result.current[action]());
    for (let i = 0; i < 10; i++) { await tick(4); await draw(); assert.equal(result.current.state.padStates[1][1].color, 'transparent'); }
  });
}

test('natural autoplay end preserves a finite animation and its final lights', async () => {
  const { result } = await mount({ autoPlay: 't 1 1\nd 100\nf 1 2', led: 'o 2 2 a 5\nd 2000\no 2 1 a 9' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(4); await tick(4); await draw();
  const lit = result.current.state.padStates[1][1].color;
  assert.notEqual(lit, 'transparent');
  await tick(100); await draw();
  assert.equal(result.current.state.autoPlayEnabled, false);
  assert.equal(result.current.state.padStates[1][1].color, lit);
  await tick(1900); await draw();
  assert.notEqual(result.current.state.padStates[1][0].color, 'transparent');
});

test('step practice waits for the last group and clears its guide after the press', async () => {
  const { result } = await mount({ autoPlay: 't 1 1' });
  await flush(() => result.current.switchPlayMode('stepPractice'));
  await tick(1); await draw();
  assert.equal(result.current.state.autoPlayEnabled, true);
  assert.equal(result.current.state.padStates[0][0].guide, true);
  await flush(() => result.current.padTouchOn(0, 0, 'finger'));
  await tick(1); await draw();
  assert.equal(result.current.state.autoPlayEnabled, false);
  assert.equal(result.current.state.padStates[0][0].guide, false);
});

for (const direct of [false, true]) test(`opening another pack resets session options with direct replacement ${direct}`, async () => {
  const { result, data } = await mount();
  await flush(() => {
    result.current.switchPlayMode('stepPractice');
    result.current.toggleRecording();
    result.current.toggleProLightMode();
    result.current.toggleTraceLog();
    result.current.toggleHideUI();
    result.current.setWatermark(false);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', code: 'Digit1' }));
  });
  const oldMidi = midiConnections.at(-1);
  const oldAudio = audio;
  await flush(() => { if (!direct) result.current.unload(); });
  await flush(() => result.current.loadUniPack(data));
  for (const key of ['autoPlayEnabled', 'autoPlayPlaying', 'autoPlayControlsVisible', 'practiceMode', 'recording', 'proLightMode', 'traceLog', 'hideUI']) assert.equal(result.current.state[key], false, key);
  assert.equal(result.current.state.watermark, true);
  assert.equal(oldMidi.released, true);
  assert.equal(oldAudio.state, 'closed');
  const count = starts.length;
  await flush(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', code: 'Digit1' })));
  assert.equal(starts.length, count + 1, 'the old held keyboard key must not suppress the new press');
});

for (const second of ['screen', 'keyboard', 'midi']) for (const releaseFirst of ['first', 'second']) test(`each player input releases its own sound and lights (${second}, ${releaseFirst} first)`, async () => {
  const { result } = await mount({ keySound: '1 1 1 a.wav 0', ledName: '1 1 1 0', led: 'o 2 2 a 5\nd 1000' });
  await flush(() => result.current.setFeedbackLight(true));
  await flush(() => result.current.padTouchOn(0, 0, 'first'));
  await tick(4);
  const secondInput = down => second === 'screen'
    ? result.current[down ? 'padTouchOn' : 'padTouchOff'](0, 0, 'second')
    : second === 'midi' ? midiListener.onPadTouch(0, 0, down)
    : window.dispatchEvent(new window.KeyboardEvent(down ? 'keydown' : 'keyup', { key: '1', code: 'Digit1' }));
  await flush(() => secondInput(true));
  await tick(4); await draw();
  await flush(() => releaseFirst === 'first' ? result.current.padTouchOff(0, 0, 'first') : secondInput(false));
  await tick(4); await draw();
  assert.equal(sources.at(-1).stopped, releaseFirst === 'second');
  assert.equal(result.current.state.padStates[0][0].pressedIsWinning, true);
  assert.equal(result.current.state.padStates[1][1].color === 'transparent', releaseFirst === 'second');
  assert.equal(result.current.state.padStates[0][0].pressed, true);
  await flush(() => releaseFirst === 'first' ? secondInput(false) : result.current.padTouchOff(0, 0, 'first'));
  await tick(4); await draw();
  assert.equal(sources.at(-1).stopped, true);
  assert.equal(result.current.state.padStates[1][1].color, 'transparent');
  assert.equal(result.current.state.padStates[0][0].pressed, false);
});

for (const playerAt of [0, 500]) test(`player and autoplay own independent sound and lights (player at ${playerAt})`, async () => {
  const { result } = await mount({ keySound: '1 1 1 a.wav 0', ledName: '1 1 1 0', led: 'o 2 2 a 5\nd 1000', autoPlay: 'd 300\no 1 1\nd 700\nf 1 1\nd 1000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  if (playerAt === 0) await flush(() => result.current.padTouchOn(0, 0, 'finger'));
  await tick(300); await tick(4);
  if (playerAt === 500) {
    await tick(196); await flush(() => result.current.padTouchOn(0, 0, 'finger'));
    await tick(4); await tick(496);
  } else {
    await tick(196); await flush(() => result.current.padTouchOff(0, 0, 'finger'));
    await tick(4); await draw();
    assert.equal(sources[1].stopped, false, 'player release must preserve autoplay sound');
    assert.notEqual(result.current.state.padStates[1][1].color, 'transparent');
    await tick(496);
  }
  await tick(4); await draw();
  const player = sources[playerAt === 0 ? 0 : 1];
  const auto = sources[playerAt === 0 ? 1 : 0];
  assert.equal(auto.stopped, true);
  if (playerAt === 500) {
    assert.equal(player.stopped, false);
    assert.notEqual(result.current.state.padStates[1][1].color, 'transparent');
    await flush(() => result.current.padTouchOff(0, 0, 'finger'));
    await tick(4); await draw();
    assert.equal(player.stopped, true);
  }
});

test('repeated autoplay presses across chains leave no unreachable endless sound', async () => {
  const { result } = await mount({ keySound: '1 1 1 a.wav 0\n2 1 1 a.wav', autoPlay: 'o 1 1\nc 2\no 1 1\nd 500\nf 1 1\nd 1000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  assert.equal(sources[0].stopped, false);
  await tick(500);
  assert.equal(sources[0].stopped, true, 'off must release the earlier chain\'s endless sound');
});


test('late MIDI connection status from the previous pack cannot replace the new connection', async () => {
  let finishOld;
  midiConnectGate = new Promise(resolve => { finishOld = resolve; });
  const { result, data } = await mount();
  nextMidiConnected = true;
  await flush(() => result.current.loadUniPack(data));
  assert.equal(result.current.state.midiConnected, true);
  await flush(finishOld);
  assert.equal(result.current.state.midiConnected, true);
  assert.equal(result.current.state.midiInputName, 'Launchpad X');
});

test('seeking while paused starts the remaining clock at the new position', async () => {
  const song = 'o 1 1\nf 1 1\nd 1000\n'.repeat(20);
  const { result } = await mount({ autoPlay: song });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(100);
  await flush(() => result.current.autoPlayPlayPause());
  await tick(1000);
  await flush(() => result.current.autoPlayNext());
  await tick(2000);
  await flush(() => result.current.autoPlayPlayPause());
  await tick(1);
  await tick(999); assert.equal(starts.length, 1);
  await tick(1); assert.equal(starts.length, 2);
});

test('pad lights commit even while the browser delays animation frames', async () => {
  const frames = new Map();
  window.requestAnimationFrame = run => { const id = ++nextId; frames.set(id, run); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const { result } = await mount({ led: 'o 1 2 a 5\nd 1000\nf 1 2' });
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(4);
  assert.notEqual(result.current.state.padStates[0][1].color, 'transparent', 'a due light must not wait for a later animation-frame callback');
});

test('a due light commits before React waits for another browser task', async () => {
  const { result } = await mount({ led: 'o 1 2 a 5\nd 1000\nf 1 2' });
  await flush(() => result.current.padTouchOn(0, 0));
  await act(async () => {
    now += 4;
    audio.currentTime += 0.004;
    for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.run();
    // Keep React's deferred work queued while the engine's light microtask runs. A visible
    // light must commit there, rather than depend on a later scheduler task getting CPU time.
    await new Promise(queueMicrotask);
    assert.notEqual(result.current.state.padStates[0][1].color, 'transparent');
  });
});

test('resumed notes and lights account for audio rendered while suspension was pending', async () => {
  const { result } = await mount({
    autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000',
    led: 'o 1 1 a 5\nd 1000\nf 1 1\no 1 2 a 9',
  });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  await tick(100);
  assert.equal(starts.length, 1);
  let finishSuspending;
  audio.suspend = async () => {
    audio.suspends++;
    await new Promise(resolve => { finishSuspending = resolve; });
    audio.state = 'suspended';
  };
  await visibility(true);
  await tick(80);
  await flush(() => finishSuspending());
  await tick(5000);
  await visibility(false);
  await tick(819);
  assert.equal(starts.length, 1);
  await tick(1);
  assert.equal(starts.length, 2, 'the sample already advanced 80 ms before native suspension completed');
  await tick(3); // The LED runner's next 4 ms tick observes the same boundary.
  assert.notEqual(result.current.state.padStates[0][1].color, 'transparent');
});

test('a light first requested after suspension keeps its full delay on return', async () => {
  const { result } = await mount({ led: 'o 1 1 a 5\nd 1000\nf 1 1\no 1 2 a 9' });
  let finishSuspending;
  audio.suspend = async () => {
    await new Promise(resolve => { finishSuspending = resolve; });
    audio.state = 'suspended';
  };
  await visibility(true);
  await tick(80);
  await flush(() => finishSuspending());
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(5000);
  await visibility(false);
  await tick(999);
  assert.equal(result.current.state.padStates[0][1].color, 'transparent', 'a new hidden light has not consumed the older sample’s 80 ms');
  await tick(4);
  assert.notEqual(result.current.state.padStates[0][1].color, 'transparent');
});

test('pad-only light commits keep an unchanged chain snapshot while real chain changes still publish', async () => {
  const { result } = await mount({ led: 'o 1 2 a 5\nd 1000\nf 1 2' });
  const chains = result.current.state.chainStates;
  await flush(() => result.current.padTouchOn(0, 0));
  await tick(4);
  assert.strictEqual(result.current.state.chainStates, chains, 'unchanged chains must not force chain bars into a pad light commit');
  await flush(() => result.current.setChain(1));
  assert.notStrictEqual(result.current.state.chainStates, chains);
  assert.equal(result.current.state.chain, 1);
  assert.notEqual(result.current.state.chainStates[9].color, chains[9].color);
});

for (const delayedTransition of ['hide', 'show']) for (const callbackOrder of ['before', 'after']) {
  test(`notes and finite lights share one visibility boundary with a delay ${callbackOrder} ${delayedTransition} callbacks`, async () => {
    const { result } = await mount({
      autoPlay: 'o 1 1\nf 1 1\nd 1000\no 1 2\nf 1 2\nd 10000',
      led: 'o 1 1 a 5\nd 1000\nf 1 1\no 1 2 a 9',
    });
    if (result.current.state.feedbackLight) await flush(() => result.current.toggleFeedbackLight());
    await flush(() => result.current.switchPlayMode('autoPlay'));
    await tick(1);
    const firstAudioTime = audio.currentTime;
    await tick(100);
    assert.equal(starts.length, 1);
    const suspend = real.AutoPlayRunner.prototype.setSuspended;
    mock.method(real.AutoPlayRunner.prototype, 'setSuspended', function (hidden, ...args) {
      const delayed = hidden === (delayedTransition === 'hide');
      const delay = () => {
        // A callback can enter or return later in the same visibility task. The audio device
        // keeps rendering until native suspension and resumes before the runners are released.
        now += 80;
        if (audio.state === 'running') audio.currentTime += 0.08;
      };
      if (delayed && callbackOrder === 'before') delay();
      suspend.call(this, hidden, ...args);
      if (delayed && callbackOrder === 'after') delay();
    });
    await visibility(true);
    await tick(2000);
    await visibility(false);
    const nextNote = now + Math.round((firstAudioTime + 1 - audio.currentTime) * 1000);
    await tick(nextNote - now - 1);
    assert.equal(starts.length, 1);
    assert.equal(result.current.state.padStates[0][1].color, 'transparent', 'the next light must not consume another runner\'s callback delay');
    await tick(1);
    assert.equal(starts.length, 2);
    assert.equal(starts[1], nextNote);
    await tick(4);
    assert.notEqual(result.current.state.padStates[0][1].color, 'transparent', 'the due light must not add another runner\'s callback delay');
  });
}


test('visibility mutes output before a slow sequencer pause callback', async () => {
  const { result } = await mount({ autoPlay: 'o 1 1\nf 1 1\nd 10000' });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  assert.equal(starts.length, 1);
  let value = audio.outputGain.value;
  assert.ok(value > 0);
  let mutedAt = null;
  Object.defineProperty(audio.outputGain, 'value', {
    get: () => value,
    set: next => { value = next; if (next === 0) mutedAt = now; },
  });
  const suspend = real.AutoPlayRunner.prototype.setSuspended;
  mock.method(real.AutoPlayRunner.prototype, 'setSuspended', function (hidden, ...args) {
    if (hidden) {
      now += 80;
      if (audio.state === 'running') audio.currentTime += 0.08;
    }
    suspend.call(this, hidden, ...args);
  });
  const hiddenAt = now;
  await visibility(true);
  assert.notEqual(mutedAt, null);
  assert.ok(mutedAt - hiddenAt < 50, 'a slow runner must not hold up the output mute request');
  assert.equal(value, 0);
});


for (const adoptLightBeforeHide of [false, true]) test(`resumed note and ${adoptLightBeforeHide ? 'running' : 'queued'} light retain the same deadline after native audio advances`, async () => {
  const { result } = await mount({
    autoPlay: 'o 1 1\nf 1 1\nd 1500\no 1 2\nf 1 2\nd 10000',
    led: 'o 1 1 a 5\nd 1500\nf 1 1\no 1 2 a 9',
  });
  if (result.current.state.feedbackLight) await flush(() => result.current.toggleFeedbackLight());
  let finish;
  audio.suspend = async () => { await new Promise(resolve => { finish = resolve; }); audio.state = 'suspended'; };
  if (!adoptLightBeforeHide) {
    const eventOn = real.LedRunner.prototype.eventOn;
    mock.method(real.LedRunner.prototype, 'eventOn', function (...args) {
      eventOn.apply(this, args);
      if (args[1] === 0 && !hidden) {
        hidden = true;
        document.dispatchEvent(new window.Event('visibilitychange'));
      }
    });
  }
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1);
  const firstAudioTime = audio.currentTime;
  if (adoptLightBeforeHide) await tick(4);
  await visibility(true); await tick(80); await flush(() => finish());
  await tick(5000); await visibility(false);
  const due = now + Math.round((firstAudioTime + 1.5 - audio.currentTime) * 1000);
  await tick(due - now - 1);
  assert.equal(starts.length, 1);
  assert.equal(result.current.state.padStates[0][1].color, 'transparent');
  await tick(1); await tick(4);
  assert.equal(starts[1], due);
  assert.notEqual(result.current.state.padStates[0][1].color, 'transparent');
});

for (const resume of [false, true]) test(`an unrelated task cannot separate a due note from its light${resume ? ' after resuming' : ''}`, async () => {
  const writes = [];
  const processEvent = real.LedRunner.prototype.processEvent;
  mock.method(real.LedRunner.prototype, 'processEvent', function (event, state) {
    if (event.type === 'on' && event.y === 1) writes.push(now);
    return processEvent.call(this, event, state);
  });
  const { result } = await mount({
    autoPlay: 'o 1 1\nf 1 1\nd 1500\no 1 2\nf 1 2\nd 10000',
    led: 'o 1 1 a 5\nd 1500\nf 1 1\no 1 2 a 9',
  });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await tick(1); await tick(4);
  if (resume) { await visibility(true); await tick(5000); await visibility(false); }
  const due = starts[0] + 1500 + (resume ? 5000 : 0);
  // Dispatch due timers in deadline order. A separate ready task takes 200 ms immediately after
  // the task which plays note two, before any later timer task can begin.
  await flush(() => {
    audio.currentTime += (due - now) / 1000; now = due;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now || !timers.delete(id)) continue;
      timer.run();
      if (starts.length === 2 && writes.length === 0) { now += 200; audio.currentTime += 0.2; }
    }
  });
  assert.equal(starts[1], due, 'the second note is due before the unrelated task');
  assert.equal(writes.length, 1);
  assert.ok(writes[0] - starts[1] < 50, `light was separated from its note by ${writes[0] - starts[1]} ms`);
});
