import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { expect } from './browser';

export const BASIC_PACK = 'e2e/fixtures/basic.uni';

/** basic.uni's 100 ms 440 Hz PCM tone (sounds/tone.wav). */
export async function basicTone(): Promise<Uint8Array> {
  return (await JSZip.loadAsync(await readFile(BASIC_PACK))).file('sounds/tone.wav')!.async('uint8array');
}

/** Opens basic.uni on /play with `remove` taken out and `files` written over it, once its pads are drawn. */
export async function openBasicWith(page: Page, files: Record<string, string | Uint8Array>, remove: string[] = []) {
  const zip = await JSZip.loadAsync(await readFile(BASIC_PACK));
  const date = new Date('2020-01-01T00:00:00Z');
  for (const path of remove) zip.remove(path);
  for (const [path, content] of Object.entries(files)) zip.file(path, content, { date });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'pack.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.locator('[data-pad]')).toHaveCount(64);
}
