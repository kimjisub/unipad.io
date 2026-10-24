import type { Page } from '@playwright/test';

interface MidiPortOptions {
  inputs?: string[];
  outputs?: string[];
  replace?: boolean;
  first?: boolean;
  rename?: string;
}

interface MidiPortProbe {
  messages: number[][][];
  emit(index: number, data: number[]): void;
  remove(kind: 'inputs' | 'outputs', index: number): void;
}

declare global {
  interface Window { midiPortProbe: MidiPortProbe }
}

/** Change only the existing browser MIDI fake; keep the native capability check and request record. */
export async function configureMidiPorts(page: Page, options: MidiPortOptions) {
  await page.addInitScript(options => {
    const request = navigator.requestMIDIAccess.bind(navigator);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async (midiOptions: MIDIOptions) => {
        const access = await request(midiOptions);
        if (options.rename) {
          for (const port of [...access.inputs.values(), ...access.outputs.values()]) {
            (port as { name: string }).name = options.rename;
          }
        }
        const messages: number[][][] = (options.outputs ?? []).map(() => []);
        const inputs = (options.inputs ?? []).map((name, i) => ({ id: `test-input-${i}`, name, onmidimessage: null as ((event: { data: Uint8Array }) => void) | null }));
        const outputs = (options.outputs ?? []).map((name, i) => ({ id: `test-output-${i}`, name, send: (data: number[]) => messages[i].push(Array.from(data)) }));
        for (const [key, ports] of [['inputs', inputs], ['outputs', outputs]] as const) {
          const map = access[key] as unknown as Map<string, unknown>;
          const existing = options.replace ? [] : [...map];
          const added = ports.map(port => [port.id, port] as const);
          map.clear();
          for (const [id, port] of options.first ? [...added, ...existing] : [...existing, ...added]) map.set(id, port);
        }
        window.midiPortProbe = {
          messages,
          emit: (index, data) => {
            const handler = inputs[index].onmidimessage;
            if (!handler) throw new Error('No MIDI input listener attached');
            handler({ data: new Uint8Array(data) });
          },
          remove: (kind, index) => {
            (access[kind] as unknown as Map<string, unknown>).delete(`test-${kind === 'inputs' ? 'input' : 'output'}-${index}`);
            access.onstatechange?.({} as MIDIConnectionEvent);
          },
        };
        return access;
      },
    });
  }, options);
}

export const midiPortMessages = (page: Page) => page.evaluate(() => window.midiPortProbe.messages);
