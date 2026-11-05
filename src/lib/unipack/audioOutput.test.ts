import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { prepareAudioContext, takeAudioContext } from './audioOutput';
import { SoundEngine } from './SoundEngine';
import { installAudioContext, parseWithLeds } from './testUtils';

/** Fails a wait that never ends instead of hanging the run; it is not a timing condition. */
const WAIT_LIMIT_MS = 10_000;

function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen`)), WAIT_LIMIT_MS);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/**
 * Safari on iPhone and iPad: a context starts only inside a tap, and until then its resume stays
 * pending. Once started in a tap it resumes without one, a little later as the device starts.
 * With `holdParking` the first suspension waits until the test calls `releaseParking`.
 */
function installWebKitContext(t: TestContext, options: { holdParking?: boolean; lateStateChange?: boolean } = {}) {
  const made: WebKitContext[] = [];
  const page = { tapping: false };
  const parkingStarted = deferred();
  const parkingGate = deferred();
  if (!options.holdParking) parkingGate.resolve();
  const watchers: { context: WebKitContext; state: AudioContextState; reached: () => void }[] = [];

  class WebKitContext {
    state: AudioContextState = 'suspended';
    started = false;
    destination = {};
    onstatechange: (() => void) | null = null;
    constructor() { made.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async resume() {
      if (!this.started && !page.tapping) return new Promise<void>(() => {});
      if (this.started) await new Promise(done => setTimeout(done, 5));
      this.started = true;
      this.state = 'running';
      this.deliver('running');
    }
    async suspend() {
      parkingStarted.resolve();
      await parkingGate.promise;
      this.state = 'suspended';
      // The state change event is a task of its own, delivered after the promise's reactions.
      if (options.lateStateChange) setTimeout(() => this.deliver('suspended'), 0);
      else this.deliver('suspended');
    }
    close() { this.state = 'closed'; }
    private deliver(state: AudioContextState) {
      this.onstatechange?.();
      for (const watcher of watchers.filter(w => w.context === this && w.state === state)) {
        watchers.splice(watchers.indexOf(watcher), 1);
        watcher.reached();
      }
    }
  }
  // A context a test prepared but no pack took would otherwise be handed to the next test. After
  // hooks run in order, so this one runs while the stand-in context is still installed.
  t.after(() => {
    parkingGate.resolve();
    takeAudioContext().context.close();
  });
  installAudioContext(t, WebKitContext);

  const tap = (action: () => void) => {
    page.tapping = true;
    try { action(); } finally { page.tapping = false; }
  };
  /** Settles when `context` next delivers a change to `state`; register it before the change. */
  const nextChange = (context: WebKitContext, state: AudioContextState) => {
    const reached = new Promise<void>(done => { watchers.push({ context, state, reached: done }); });
    return within(reached, `the change to ${state}`);
  };
  return {
    made, tap, nextChange,
    parkingStarted: () => within(parkingStarted.promise, 'the parking suspension'),
    releaseParking: parkingGate.resolve,
  };
}

test('a pack opened by a tap plays from its first press although its sounds were set up after the tap', async t => {
  const { made, tap, nextChange } = installWebKitContext(t);
  const pack = await parseWithLeds({});
  tap(prepareAudioContext);
  assert.equal(made.length, 1, 'the opening tap starts a context');
  assert.equal(made[0].state, 'running', 'started inside the tap');
  await nextChange(made[0], 'suspended');
  assert.equal(made[0].state, 'suspended', 'the started context waits suspended while the file is read');

  const running = nextChange(made[0], 'running');
  const engine = new SoundEngine(pack, () => 0, () => {});
  t.after(() => engine.destroy());
  assert.equal(made.length, 1, 'the pack plays through the context the tap started');
  await running;
  assert.equal(engine.context.state, 'running', 'running before the first press, without another tap');
});

test('a pack taking the context while it is being parked does not report an interruption', async t => {
  const { made, tap, nextChange, parkingStarted, releaseParking } =
    installWebKitContext(t, { holdParking: true, lateStateChange: true });
  const pack = await parseWithLeds({});
  tap(prepareAudioContext);
  await parkingStarted();
  assert.equal(made[0].state, 'running', 'parking has started but not finished');

  const engine = new SoundEngine(pack, () => 0, () => {});
  t.after(() => engine.destroy());
  let interruptions = 0;
  engine.onInterrupted = () => { interruptions++; };
  const parked = nextChange(made[0], 'suspended');
  const running = nextChange(made[0], 'running');
  releaseParking();
  await Promise.all([parked, running]);
  assert.equal(interruptions, 0, 'the parking suspension is ours, not an interruption');
  assert.equal(engine.context.state, 'running');
});
