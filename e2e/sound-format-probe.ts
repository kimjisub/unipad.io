import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { openBasicWith } from './basic-pack';
import { expect } from './browser';
import { pad } from './touch';

type DecodedBuffer = { id: number; duration: number; frames: number; channels: number; sampleRate: number; encodedSha256: string };
type Start = { bufferId: number | null; duration: number; loop: boolean };

interface FormatProbe {
  decodedBuffers: DecodedBuffer[];
  starts: Start[];
}

declare global {
  interface Window { formatProbe: FormatProbe }
}

// Observe native buffers only in the format tests; the shared playback probe stays unchanged.
export async function observeFormatBuffers(page: Page) {
  await page.addInitScript(() => {
    const probe: FormatProbe = { decodedBuffers: [], starts: [] };
    window.formatProbe = probe;
    const bufferIds = new WeakMap<AudioBuffer, number>();
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof decode>) {
      const hash = crypto.subtle.digest('SHA-256', args[0].slice(0));
      return decode.apply(this, args).then(async buffer => {
        const encodedSha256 = Array.from(new Uint8Array(await hash), byte => byte.toString(16).padStart(2, '0')).join('');
        const id = probe.decodedBuffers.length + 1;
        bufferIds.set(buffer, id);
        probe.decodedBuffers.push({ id, duration: buffer.duration, frames: buffer.length, channels: buffer.numberOfChannels,
          sampleRate: buffer.sampleRate, encodedSha256 });
        return buffer;
      });
    };
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const start = source.start.bind(source);
      source.start = (...args) => {
        probe.starts.push({ bufferId: source.buffer ? bufferIds.get(source.buffer) ?? null : null,
          duration: source.buffer?.duration ?? 0, loop: source.loop });
        start(...args);
      };
      return source;
    };
  });
}

export const formatAudio = (page: Page) => page.evaluate(() => window.formatProbe);

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/**
 * Opens basic.uni without its lights and auto play, with the given files written over it, and waits until
 * `decodeCount` sounds reached native decoding with no error shown. observeFormatBuffers must run first.
 */
export async function openFormatPack(page: Page, files: Record<string, string | Uint8Array>, decodeCount: number) {
  await openBasicWith(page, files, ['keyLED', 'autoPlay']);
  await expect.poll(async () => (await formatAudio(page)).decodedBuffers.length).toBe(decodeCount);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  return (await formatAudio(page)).decodedBuffers;
}

export interface HeldPadSound { decoded: DecodedBuffer; started: Start; playingRms: number | null }

/**
 * Holds the pad, whose sound must repeat (keySound loop 0), and checks the conformance audio items: silence
 * before the press, one start of the buffer decoded from the expected bytes, an output signal after the
 * application gain, and silence again once released. `whilePlaying` runs while the pad is still held, so a
 * record attached there survives a failure on release.
 */
export async function expectHeldPadPlays(page: Page, position: string, encodedSha256: string,
  whilePlaying: (sound: HeldPadSound) => Promise<void>) {
  const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
  await expect.poll(rms).toBe(0);
  await pad(page, position).hover();
  await page.mouse.down();
  try {
    await expect.poll(async () => (await formatAudio(page)).starts.length).toBe(1);
    const { decodedBuffers, starts: [started] } = await formatAudio(page);
    const decoded = decodedBuffers.find(buffer => buffer.id === started.bufferId);
    expect(decoded?.encodedSha256).toBe(encodedSha256);
    expect(started.duration).toBe(decoded!.duration);
    expect(started.loop).toBe(true);
    let playingRms: number | null = null;
    await expect.poll(async () => {
      playingRms = await rms();
      return playingRms;
    }).toBeGreaterThan(0.001);
    await whilePlaying({ decoded: decoded!, started, playingRms });
  } finally {
    await page.mouse.up();
  }
  await expect.poll(rms).toBe(0);
}
