import { test as base, expect, type Page } from '@playwright/test';

export interface BrowserProbe {
  audio: { decoded: number[]; starts: { id: number; duration: number; loop: boolean }[]; stops: number[]; outputRms: () => number | null };
  midi: { supported: boolean; requests: MIDIOptions[]; messages: number[][]; emit: (data: number[]) => void };
}

declare global {
  interface Window { browserProbe: BrowserProbe }
}

export const test = base.extend<{ checkedPage: void }>({
  checkedPage: [async ({ page, context, baseURL }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Firebase analytics receives inert local responses so its installation
    // promise does not reject when networking is blocked. No requests leave CI.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'firebaseinstallations.googleapis.com') {
        return route.fulfill({ json: { fid: 'cAAAAAAAAAAAAAAAAAAAAA', refreshToken: 'FAKE_REFRESH_TOKEN', authToken: { token: 'FAKE_INSTALLATION_TOKEN', expiresIn: '604800s' } } });
      }
      if (url.hostname === 'firebase.googleapis.com') {
        return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: 'G-FAKE-CI' } });
      }
      return url.origin === baseURL ? route.continue() : route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await installBrowserProbe(page);
    await use();
    expect(errors, 'uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

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
      };
      const midi: BrowserProbe['midi'] = { supported: typeof navigator.requestMIDIAccess === 'function', requests: [], messages: [], emit: () => {} };
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
      const output = { id: 'test-output', name: 'Launchpad X Test Output', send: (data: number[]) => midi.messages.push(Array.from(data)) };
      const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null };
      midi.emit = data => {
        if (!input.onmidimessage) throw new Error('No MIDI input listener attached');
        input.onmidimessage({ data: new Uint8Array(data) });
      };
      if (midi.supported) Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async (options: MIDIOptions) => { midi.requests.push(options); return access; },
      });
    });
}
