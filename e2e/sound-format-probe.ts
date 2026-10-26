import type { Page } from '@playwright/test';

interface FormatProbe {
  decodedBuffers: { id: number; duration: number; encodedSha256: string }[];
  starts: { bufferId: number | null; duration: number; loop: boolean }[];
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
        probe.decodedBuffers.push({ id, duration: buffer.duration, encodedSha256 });
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
