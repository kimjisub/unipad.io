import { test as base, expect, type Frame, type Page, type Request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { attachLogsSince, firefoxLogsEnabled, logOffsets, withFirefoxLogs } from './firefox-logs';

export interface BrowserProbe {
  audio: { decoded: number[]; starts: { id: number; duration: number; loop: boolean }[]; stops: number[]; outputRms: () => number | null; outputState: () => string | null };
  /** `messages` reach the launchpad output, `synthMessages` the synthesizer Windows always lists. */
  midi: { supported: boolean; requests: MIDIOptions[]; messages: number[][]; synthMessages: number[][]; emit: (data: number[]) => void; unplug: () => void; plugAnother: () => void };
}

declare global {
  interface Window { browserProbe: BrowserProbe }
}

/** Installation registration wraps authToken; token refresh returns the token directly. */
export function installationResponse(url: URL) {
  const authToken = { token: 'FAKE_INSTALLATION_TOKEN', expiresIn: '604800s' };
  return url.pathname.endsWith('/authTokens:generate') ? authToken
    : { fid: 'cAAAAAAAAAAAAAAAAAAAAA', refreshToken: 'FAKE_REFRESH_TOKEN', authToken };
}

export interface PageErrors {
  /** Fail the test unless it empties this list itself. */
  errors: string[];
  /** Firebase or same-origin prefetches cut off while their page was being replaced. */
  ignored: string[];
  /** Mark the UI action; only document-replacing controls wait beyond its return. */
  navigate: <T>(action: () => Promise<T>, options?: { waitForDocument?: boolean }) => Promise<T>;
}

// WebKit writes a failed fetch to its console, and Playwright reports that line as a page error, splitting the
// text at the URL's first colon. The fetch's own rejection is a separate error, so ignoring the line hides no exception.
const webkitFetchUrl = (error: Error) => {
  const protocol = /^Fetch API cannot load (https?)$/.exec(error.name)?.[1];
  const suffix = ' due to access control checks.';
  return protocol && error.message.endsWith(suffix)
    ? `${protocol}:/${error.message.slice(0, -suffix.length)}` : undefined;
};

// Next uses different cache keys for a route's tree and segments. WebKit can report an
// aborted segment before its request event, so match a prefetch target we already observed.
// Preserve the origin, path and every application query parameter.
const prefetchTarget = (url: URL) => {
  url.searchParams.delete('_rsc');
  return url.href;
};

/**
 * The line can arrive before the navigation's first event, so leaving starts when the test asks to navigate.
 * Client-side links end it when the action returns. Document-replacing controls opt in to
 * waiting until the new document takes over, including language changes that keep the URL.
 */
function collectPageErrors(page: Page): PageErrors {
  let leaving = false;
  const prefetches = new Set<Request>();
  let leavingPrefetches = new Set<string>();
  page.on('request', request => {
    const url = new URL(request.url());
    const headers = request.headers();
    if (request.method() === 'GET' && request.resourceType() === 'fetch' && request.frame() === page.mainFrame()
      && url.origin === new URL(page.url()).origin && url.searchParams.has('_rsc')
      && headers.rsc === '1' && headers['next-router-prefetch'] === '1') {
      prefetches.add(request);
      if (leaving) leavingPrefetches.add(prefetchTarget(url));
    }
  });
  page.on('requestfinished', request => prefetches.delete(request));
  page.on('requestfailed', request => prefetches.delete(request));
  const finishLeaving = () => { leaving = false; leavingPrefetches.clear(); };
  const whileLeaving = <T>(navigation: () => Promise<T>) => {
    leaving = true;
    // Keep the URLs until navigation ends even if requestfailed precedes WebKit's console line.
    leavingPrefetches = new Set([...prefetches].map(request => prefetchTarget(new URL(request.url()))));
    return navigation().finally(finishLeaving);
  };
  const collected: PageErrors = { errors: [], ignored: [], navigate: (action, options) => whileLeaving(async () => {
    // Next links keep the current document running. Its failures must count
    // once the action returns, even while a route response is still pending.
    if (!options?.waitForDocument) return action();
    // A key press can return while the old document is still running and the
    // replacement is pending. Only the main frame's commit ends that interval.
    let commit!: () => void;
    const committed = new Promise<void>(resolve => { commit = resolve; });
    const onNavigated = (frame: Frame) => { if (frame === page.mainFrame()) commit(); };
    page.on('framenavigated', onNavigated);
    try {
      const result = await action();
      await committed;
      return result;
    } finally {
      page.off('framenavigated', onNavigated);
    }
  }) };
  page.on('pageerror', error => {
    const failedUrl = webkitFetchUrl(error);
    const failedPrefetch = failedUrl && URL.canParse(failedUrl) ? new URL(failedUrl) : undefined;
    const cutOffPrefetch = failedPrefetch?.searchParams.has('_rsc') && leavingPrefetches.has(prefetchTarget(failedPrefetch));
    // WebKit can refuse an old document's fetch before emitting a request event.
    // Match its complete native line; the fetch's actual rejection still counts.
    const firebaseFetchLine = failedUrl?.startsWith('https://') && /^\/firebase[a-z]*\.googleapis\.com\//.test(error.message);
    const cutOffFetch = leaving && (firebaseFetchLine || cutOffPrefetch);
    (cutOffFetch ? collected.ignored : collected.errors).push(error.message);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) finishLeaving();
  });
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = (url, options) => whileLeaving(() => goto(url, options));
  page.reload = options => whileLeaving(() => reload(options));
  return collected;
}

export const test = base.extend<{ checkedPage: PageErrors; firefoxLogsOnFailure: void }, { firefoxLogDir: string | undefined }>({
  // One folder per worker: a worker launches one browser, and a failure starts the next worker.
  firefoxLogDir: [async ({ browserName }, use, workerInfo) => {
    if (!firefoxLogsEnabled(browserName)) return await use(undefined);
    const dir = path.join(workerInfo.project.outputDir, 'firefox-logs', `worker-${workerInfo.workerIndex}`);
    mkdirSync(dir, { recursive: true });
    await use(dir);
  }, { scope: 'worker' }],
  launchOptions: [async ({ launchOptions, firefoxLogDir }, use) => {
    await use(firefoxLogDir ? withFirefoxLogs(launchOptions, firefoxLogDir) : launchOptions);
  }, { scope: 'worker' }],
  firefoxLogsOnFailure: [async ({ firefoxLogDir }, use, info) => {
    const since = firefoxLogDir ? logOffsets(firefoxLogDir) : undefined;
    await use();
    if (firefoxLogDir && since && info.status !== info.expectedStatus) await attachLogsSince(info, firefoxLogDir, since);
  }, { auto: true }],
  checkedPage: [async ({ page, context, baseURL }, use) => {
    const collected = collectPageErrors(page);
    // Firebase analytics receives inert local responses so its installation
    // promise does not reject when networking is blocked. No requests leave CI.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'firebaseinstallations.googleapis.com') {
        return route.fulfill({ json: installationResponse(url) });
      }
      if (url.hostname === 'firebase.googleapis.com') {
        return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: 'G-FAKE-CI' } });
      }
      return url.origin === baseURL ? route.continue() : route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await installBrowserProbe(page);
    await use(collected);
    expect(collected.errors, 'uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

// Waits that check state, not speed. On a busy shared machine one browser round trip has stalled for 5-10 s,
// and opening a 10 KB pack (reading the archive and decoding its sounds before the pads appear) has taken 8 s.
export const stateTimeout = 15_000;

/** Waits for the pads of the pack just opened on /play: 64 for an 8x8 pack. */
export const expectPads = (page: Page, count = 64) =>
  expect(page.locator('[data-pad]')).toHaveCount(count, { timeout: stateTimeout });

export async function expectSavedPlaybackPack(page: Page) {
  // Pads appear before persistence finishes. Observe both within the existing pad-state budget,
  // rather than starting a separate, shorter URL deadline as soon as the pads appear.
  let lastUrl = page.url();
  await expect.poll(async () => {
    const state = await page.evaluate(() => ({
      url: location.href,
      pads: document.querySelectorAll('[data-pad]').length,
      saved: Boolean(new URL(location.href).searchParams.get('pack')),
    }));
    lastUrl = state.url;
    return { pads: state.pads, saved: state.saved };
  }, { timeout: stateTimeout }).toEqual({ pads: 64, saved: true }).catch(error => {
    throw new Error(`${error.message}\nLast observed playback URL: ${lastUrl}`, { cause: error });
  });
}

/**
 * Playback starts only once the browser runs the audio output. When the device never opens, a mode
 * button stays off; this names the device instead of the app state.
 */
export const expectAudioOutputRunning = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState()),
    { message: 'the browser did not start the audio output of the opened pack' }).toBe('running');

export async function installBrowserProbe(page: Page) {
    await page.addInitScript(() => {
      const outputs: { analyser: AnalyserNode; samples: Float32Array<ArrayBuffer> }[] = [];
      const audio: BrowserProbe['audio'] = {
        decoded: [], starts: [], stops: [],
        outputRms: () => {
          if (!outputs.length) return null;
          return Math.max(...outputs.map(({ analyser, samples }) => {
            if (analyser.context.state !== 'running') return 0;
            analyser.getFloatTimeDomainData(samples);
            return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          }));
        },
        outputState: () => outputs.at(-1)?.analyser.context.state ?? null,
      };
      const midi: BrowserProbe['midi'] = { supported: typeof navigator.requestMIDIAccess === 'function', requests: [], messages: [], synthMessages: [], emit: () => {}, unplug: () => {}, plugAnother: () => {} };
      window.browserProbe = { audio, midi };
      // Insert a transparent analyser AFTER the application's output gain, before the
      // native destination. Measuring a source would miss a muted/disconnected output.
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
        if (this instanceof GainNode && destination === this.context.destination) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          outputs.push({ analyser, samples: new Float32Array(analyser.fftSize) });
          Reflect.apply(connect, this, [analyser, output ?? 0, 0]);
          Reflect.apply(connect, analyser, [destination, 0, input ?? 0]);
          return destination;
        }
        return Reflect.apply(connect, this, [destination, output ?? 0, ...(destination instanceof AudioNode ? [input ?? 0] : [])]);
      } as typeof connect;
      // Observe real Web Audio decoding/playback; keep all original calls intact.
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof decode>) {
        return decode.apply(this, args).then(buffer => {
          audio.decoded.push(buffer.duration);
          return buffer;
        });
      };
      const createSource = AudioContext.prototype.createBufferSource;
      let sourceId = 0;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this);
        const id = ++sourceId;
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        source.start = (...args) => {
          audio.starts.push({ id, duration: source.buffer?.duration ?? 0, loop: source.loop });
          start(...args);
        };
        source.stop = (...args) => { audio.stops.push(id); stop(...args); };
        return source;
      };
      const input = { id: 'test-input', name: 'Launchpad X Test Input', onmidimessage: null as ((event: { data: Uint8Array }) => void) | null };
      const output: { id: string; name: string; send: (data: number[]) => void } = { id: 'test-output', name: 'Launchpad X Test Output', send: (data: number[]) => midi.messages.push(Array.from(data)) };
      const synth = { id: 'test-synth', name: 'Microsoft GS Wavetable Synth', send: (data: number[]) => midi.synthMessages.push(Array.from(data)) };
      const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output], [synth.id, synth]]), onstatechange: null as (() => void) | null };
      midi.emit = data => {
        if (!input.onmidimessage) throw new Error('No MIDI input listener attached');
        input.onmidimessage({ data: new Uint8Array(data) });
      };
      // Unplugs the controller `emit` plays, leaving one `plugAnother` added.
      midi.unplug = () => {
        access.inputs.delete(input.id);
        access.outputs.delete(output.id);
        access.onstatechange?.();
      };
      midi.plugAnother = () => {
        access.inputs.set('other-input', { id: 'other-input', name: 'Launchpad X Other Input', onmidimessage: null });
        access.outputs.set('other-output', { id: 'other-output', name: 'Launchpad X Other Output', send: () => {} });
        access.onstatechange?.();
      };
      if (midi.supported) Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async (options: MIDIOptions) => { midi.requests.push(options); return access; },
      });
    });
}
