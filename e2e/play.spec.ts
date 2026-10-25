import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import JSZip from 'jszip';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { expectLandscapePads } from './pad-layout';
import { loadInputPack } from './input-fixture';
import { configureMidiPorts, midiPortMessages } from './midi';
import { LAUNCHPAD_PROFILE_OPTIONS } from '../src/lib/unipack/MidiProfiles';

const pack = resolve('e2e/fixtures/basic.uni');
const pad = (page: Page, position: string) => page.locator(`[data-pad="${position}"]`);
const led = (page: Page, position: string) => pad(page, position).locator('div[style*="background-color"]');
const pressed = (page: Page, position: string) => pad(page, position).locator('img[src="/theme/btn_.png"]');
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

for (const reconnect of [true, false]) {
  test(`pads pressed before controller lights settle stay held after ${reconnect ? 'reconnect' : 'a model change'}`, async ({ page }, info) => {
    await skipWithoutWebMidi(page);
    await loadPack(page);
    await connectLaunchpadAndClear(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
    if (reconnect) await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.clock.pauseAt(new Date('2024-01-01T00:00:00.000Z'));
    if (reconnect) await dialog.getByRole('button', { name: 'Connect', exact: true }).dispatchEvent('click');
    else await dialog.locator('select').selectOption('launchpad_mini_mk3');
    await dialog.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
    await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
    await page.clock.runFor(16);
    await expect(pressed(page, '0,0')).toBeVisible();
    const source = await page.evaluate(() => window.browserProbe.audio.starts.at(-1)!);
    await info.attach('pressed-before-settling', { body: await page.screenshot(), contentType: 'image/png' });
    await expect.soft(page.getByText('MIDI ON', { exact: true })).toBeVisible();
    await page.clock.runFor(600);
    await info.attach('pressed-after-settling', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('settling-input-output', { body: JSON.stringify(await page.evaluate(() => ({ ...window.browserProbe.audio, lights: window.browserProbe.midi.messages, physicalHardware: false }))), contentType: 'application/json' });
    await expect.soft(pressed(page, '0,0')).toBeVisible();
    expect.soft(await page.evaluate(() => window.browserProbe.audio.stops)).not.toContain(source.id);
    await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
    await page.clock.runFor(16);
    await expect(pressed(page, '0,0')).toHaveCount(0);
    expect(await page.evaluate(() => window.browserProbe.audio.stops)).toContain(source.id);
  });
}

test('controller buttons outside a small pack do not select chains or record pads', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadInputPack(page, 4, 4);
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+r');
  await page.evaluate(() => {
    window.browserProbe.midi.emit([0x90, 22, 100]); // Pad 6,1, outside this pack.
    window.browserProbe.midi.emit([0x80, 22, 0]);
    window.browserProbe.midi.emit([0xb0, 19, 100]); // Chain 8, outside this pack.
  });
  const exported = page.waitForEvent('download');
  await page.keyboard.press('Alt+r');
  const recorded = await readFile(await (await exported).path(), 'utf8');
  await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
  await expect.poll(() => starts(page)).toBe(1);
  const played = await page.evaluate(() => window.browserProbe.audio.starts);
  await info.attach('controller-boundary-screen', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('controller-boundary-output', { body: JSON.stringify({ recorded, played, lights: await midiMessages(page), physicalHardware: false }), contentType: 'application/json' });
  expect(recorded).toBe('c 1');
  expect(played[0].duration).toBe(0.1);
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
});

test('controller option volume includes the selected level and hidden UI clears option lights', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadPack(page);
  await connectLaunchpadAndClear(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('input[type=range][max="7"]').fill('3');
  const lastRing = async () => {
    const messages = await midiMessages(page);
    return [89, 79, 69, 59, 49, 39, 29, 19].map(note => messages.filter(m => m[0] === 0xb0 && m[1] === note).at(-1));
  };
  const volumeLights = await lastRing();
  await info.attach('option-volume-screen', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('option-volume-lights', { body: JSON.stringify(volumeLights), contentType: 'application/json' });
  expect.soft(volumeLights.filter(m => m && m[2] > 0)).toHaveLength(4);
  await page.evaluate(() => window.browserProbe.midi.emit([0xb0, 95, 100])); // Hide UI.
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 0]);
  await info.attach('hidden-option-screen', { body: await page.screenshot(), contentType: 'image/png' });
});

test('an absent controller chain preserves the current animation queue', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadPack(page, await roundLightPack(2, {
    '2 1 1 0 a': 'o 1 2 a 5\nd 60000\n',
    '2 1 1 0 b': 'o 1 2 a 21\nd 60000\n',
  }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('F2');
  await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await page.evaluate(() => {
    window.browserProbe.midi.emit([0x80, 81, 0]);
    window.browserProbe.midi.emit([0xb0, 19, 100]);
    window.browserProbe.midi.emit([0x90, 81, 100]);
  });
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(0, 206, 60)');
  await info.attach('queue-after-absent-chain', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
});

test('hiding the open option panel preserves pack lights underneath it', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadPack(page, await roundLightPack(1, { '1 1 1 1': 'o mc 8 a 21\nd 60000\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+w');
  await page.keyboard.press('Alt+p');
  await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 21]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 5]);
  await page.evaluate(() => window.browserProbe.midi.emit([0xb0, 95, 100]));
  try {
    await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 21]);
  } finally {
    await info.attach('hidden-panel-pack-light', { body: JSON.stringify(await midiMessages(page)), contentType: 'application/json' });
    await info.attach('hidden-panel-screen', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
});

for (const { value: profile } of LAUNCHPAD_PROFILE_OPTIONS) {
  test(`the ${profile} model is selectable and survives reload`, async ({ page }, info) => {
    await skipWithoutWebMidi(page);
    await loadPack(page);
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
    await dialog.locator('select').selectOption(profile);
    await expect(dialog).toContainText(`Resolved Type: ${profile === 'auto' ? 'launchpad_x' : profile}`);
    await info.attach('selected-model', { body: await page.screenshot(), contentType: 'image/png' });
    await page.reload();
    await expectPads(page);
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    await expect(dialog.locator('select')).toHaveValue(profile);
    await expect(dialog).toContainText(`Resolved Type: ${profile === 'auto' ? 'launchpad_x' : profile}`);
  });
}

test('connecting another controller preserves the pad already held', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  await page.evaluate(() => window.browserProbe.midi.plugAnother());
  await page.waitForTimeout(700); // Cross the new controller's mode and settling timers.
  await expect(pressed(page, '0,0')).toBeVisible();
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
  await info.attach('held-through-connect', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
});

test('Pro Live-mode resync redraws lights while preserving held playback', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await dialog.locator('select').selectOption('launchpad_pro');
  await expect(dialog).toContainText('Resolved Type: launchpad_pro');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.browserProbe.midi.emit([0x90, 81, 100]));
  await expect.poll(() => starts(page)).toBe(1);
  await page.evaluate(() => {
    window.browserProbe.midi.messages.length = 0;
    window.browserProbe.midi.emit([0xf0, 0, 0x20, 0x29, 2, 0x10, 0x2e, 0, 0xf7]);
  });
  await expect.poll(() => midiMessages(page)).toContainEqual([0xb0, 89, 3]);
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
  await expect(pressed(page, '0,0')).toBeVisible();
  await info.attach('live-mode-redraw', { body: JSON.stringify(await midiMessages(page)), contentType: 'application/json' });
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
});

async function loadPack(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer } = pack) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
  await expectLoadedPack(page);
}

async function expectLoadedPack(page: Page) {
  await expectPads(page);
  await expect(page.getByRole('button', { name: 'Play mode: Auto', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  const supportsMidi = await hasWebMidi(page);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests)).toEqual(supportsMidi ? [{ sysex: true }] : []);
}

// Launchpad tests need the browser's own Web MIDI API (WebKit has none); there they are
// skipped as not applicable so the skip shows in the results instead of a failure.
const hasWebMidi = (page: Page) => page.evaluate(() => window.browserProbe.midi.supported);

const noWebMidi = 'Not applicable: this browser has no native Web MIDI API';

async function skipWithoutWebMidi(page: Page) {
  await page.goto('/play');
  test.skip(!await hasWebMidi(page), noWebMidi);
}

/**
 * Records a pad's rendered light on every frame, on the page's own clock; the attached timeline also holds
 * the page's pointer and key input. Start it before the input: driver round trips can outlast the pack's
 * 1,200 ms light.
 */
async function watchLight(page: Page, position: string) {
  const record = await pad(page, position).evaluateHandle(element => {
    const transitions: { color: string | null; at: number }[] = [];
    const inputs: { type: string; at: number }[] = [];
    const types = ['pointerdown', 'pointerup', 'keydown', 'keyup'];
    const onInput = (event: Event) => inputs.push({ type: event.type, at: event.timeStamp });
    for (const type of types) window.addEventListener(type, onInput, true);
    let frame = 0;
    const sample = () => {
      const overlay = element.querySelector<HTMLElement>('div[style*="background-color"]');
      const style = overlay && getComputedStyle(overlay);
      const rect = overlay?.getBoundingClientRect();
      const color = style && rect && rect.width > 0 && rect.height > 0
        && style.visibility === 'visible' && style.opacity !== '0' ? style.backgroundColor : null;
      if (!transitions.length || transitions[transitions.length - 1].color !== color) {
        transitions.push({ color, at: performance.now() });
      }
      frame = requestAnimationFrame(sample);
    };
    sample();
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const type of types) window.removeEventListener(type, onInput, true);
    };
    return { transitions, inputs, stop };
  });
  return {
    colors: () => record.evaluate(({ transitions }) => transitions.map(item => item.color)),
    // Called from `finally`: once the page has closed, a read error here would replace the test's own failure.
    async finish(testInfo: TestInfo) {
      const timeline = await record.evaluate(({ transitions, inputs, stop }) => {
        stop();
        return { transitions, inputs };
      }).catch((error: Error) => {
        if (!page.isClosed()) throw error;
        return { unavailable: `The page closed before the timeline was read: ${error.message}` };
      });
      await testInfo.attach('rendered-led-transitions', { body: JSON.stringify(timeline), contentType: 'application/json' });
      if (!page.isClosed()) await record.dispose();
    },
  };
}

test('imports a local pack and restores the saved pack after reload', async ({ page }) => {
  await loadPack(page);
  await expect(page).toHaveURL(/\/play\?pack=.+/);
  await expect.poll(() => starts(page)).toBe(0);
  await page.reload();
  await expectLoadedPack(page);
  expect(await starts(page)).toBe(0);
});

test('imports and restores a pack when native decoding outlasts a UI assertion', async ({ page }) => {
  test.slow(); // Two real decodes, each held beyond the default UI assertion budget.
  await page.addInitScript(() => {
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (...args: Parameters<typeof decode>) {
      const buffer = await decode.apply(this, args);
      await new Promise(resolve => setTimeout(resolve, 6000));
      return buffer;
    };
  });
  await loadPack(page);
  await expect(page).toHaveURL(/\/play\?pack=.+/);
  await page.reload();
  await expectLoadedPack(page);
  expect(await starts(page)).toBe(0);
});

test('a missing saved pack fails the pad value check after restoration ends', async ({ page }, testInfo) => {
  await page.goto('/play?pack=missing-saved-pack');
  const failure = await expectPads(page).then(() => '', error => stripVTControlCharacters(error.message));
  await testInfo.attach('missing-pack-value-failure', { body: failure, contentType: 'text/plain' });
  await testInfo.attach('missing-pack-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(failure).toContain('expect(locator).toHaveCount(expected) failed');
  expect(failure).toContain('Expected: 64');
  expect(failure).toContain('Received: 0');
  await expect(page.getByText('No UniPacks installed', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/pack=/);
});

test('a delayed earlier storage read cannot replace the last pack selected', async ({ page }, info) => {
  await loadPack(page);
  await expect(page).toHaveURL(/pack=.+/);
  const zip = await JSZip.loadAsync(await readFile(pack));
  zip.file('info', (await zip.file('info')!.async('string')).replace(/^title=.*$/m, 'title=Earlier Pack'));
  const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }));
  await page.evaluate(async bytes => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('unipad');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('unipacks', 'readwrite');
        const store = transaction.objectStore('unipacks');
        const request = store.getAll();
        request.onsuccess = () => store.put({ ...request.result[0], id: 'earlier-pack', title: 'Earlier Pack', zipData: new Uint8Array(bytes).buffer });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      const request = get.call(this, query);
      if (this.name === 'unipacks' && query === 'earlier-pack') {
        request.addEventListener('success', event => {
          event.stopImmediatePropagation();
          document.documentElement.dataset.heldPackRead = 'true';
          window.addEventListener('release-earlier-pack', () => request.onsuccess?.call(request, event), { once: true });
        }, { once: true });
      }
      return request;
    };
  }, bytes);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await page.getByRole('option', { name: 'Earlier Pack by UniPad Tests', exact: true }).dblclick();
  await expect(page.locator('html')).toHaveAttribute('data-held-pack-read', 'true');
  await page.getByRole('option', { name: 'Browser Test Pack by UniPad Tests', exact: true }).dblclick();
  await expectPads(page);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect(page).toHaveURL(/pack=.+/);
  const latestUrl = page.url();
  // The unit tests hold every await deterministically. This browser observation also keeps a
  // record of any transient wrong title after releasing the native IndexedDB result.
  const titles = await page.evaluate(() => new Promise<string[]>(resolve => {
    const titles = [document.title];
    const observer = new MutationObserver(() => titles.push(document.title));
    observer.observe(document.querySelector('title')!, { childList: true, subtree: true, characterData: true });
    window.dispatchEvent(new Event('release-earlier-pack'));
    setTimeout(() => { observer.disconnect(); resolve(titles); }, 1000);
  }));
  await info.attach('pack-after-delayed-read', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('delayed-read-observation', { body: JSON.stringify({ titles, latestUrl, observedUrl: page.url() }), contentType: 'application/json' });
  expect(titles.every(title => title === 'Browser Test Pack | UniPad Web Player')).toBe(true);
  await expect(page).toHaveURL(latestUrl);
  await page.keyboard.down('q');
  await expect(pressed(page, '1,0')).toBeVisible();
  await page.keyboard.up('q');
  await expect(pressed(page, '1,0')).toHaveCount(0);
});

test('restoration waits past the temporary pack list before reading a saved pack', async ({ page }, testInfo) => {
  await loadPack(page);
  await expect(page).toHaveURL(/\/play\?pack=.+/);
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    const released = new Promise<void>(resolve =>
      window.addEventListener('release-pack-read', () => resolve(), { once: true }));
    let held = false;
    IDBObjectStore.prototype.get = function (query) {
      const request = get.call(this, query);
      if (this.name === 'unipacks' && !held) {
        held = true;
        request.addEventListener('success', event => {
          event.stopImmediatePropagation();
          void released.then(() => request.onsuccess?.call(request, event));
        }, { once: true });
      }
      return request;
    };
  });
  await page.reload();
  await expect(page.getByRole('option', { name: 'Browser Test Pack by UniPad Tests', exact: true })).toBeVisible();
  await testInfo.attach('temporary-pack-list', { body: await page.screenshot(), contentType: 'image/png' });
  const restored = expectLoadedPack(page).catch(error => error);
  // Keep the actual storage result pending beyond the former five-second assertion.
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.dispatchEvent(new Event('release-pack-read')));
  expect(await restored).toBeUndefined();
});

for (const delayedInspection of [false, true]) {
  test(`pointer press/release plays/stops a loop and runs keyLed on another pad${delayedInspection ? ' after delayed inspection' : ''}`, async ({ page }, testInfo) => {
    await loadPack(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await pad(page, '0,0').hover();
    const light = await watchLight(page, '0,1');
    try {
      expect(await light.colors()).toEqual([null]);
      await page.mouse.down();
      if (delayedInspection) {
        // Deliberately inspect after the unchanged 1,200 ms light has gone, with the pad still held.
        await page.waitForTimeout(1500);
        await expect(led(page, '0,1')).toHaveCount(0);
      }
      await expect(pressed(page, '0,0')).toBeVisible();
      await expect.poll(() => starts(page)).toBe(1);
      expect(await page.evaluate(() => window.browserProbe.audio.starts[0])).toEqual({ id: 1, duration: 0.1, loop: true });
      await expect.poll(light.colors).toEqual([null, 'rgb(239, 83, 80)', null]);
      await page.mouse.up();
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await expect(led(page, '0,1')).toHaveCount(0);
      expect(await light.colors(), 'the release lights nothing again').toEqual([null, 'rgb(239, 83, 80)', null]);
    } finally {
      await light.finish(testInfo);
    }
  });
}

test('keyboard down/up reaches the mapped pad and ignores repeated keydown', async ({ page }, testInfo) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const light = await watchLight(page, '1,1');
  try {
    expect(await light.colors()).toEqual([null]);
    await page.keyboard.down('q');
    await expect(pressed(page, '1,0')).toBeVisible();
    await expect.poll(() => starts(page)).toBe(1);
    await expect.poll(light.colors).toEqual([null, 'rgb(0, 206, 60)', null]);
    await page.keyboard.down('q');
    expect(await starts(page)).toBe(1);
    await page.keyboard.up('q');
    await expect(pressed(page, '1,0')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
    expect(await light.colors(), 'the repeated keydown lights nothing again').toEqual([null, 'rgb(0, 206, 60)', null]);
  } finally {
    await light.finish(testInfo);
  }
});

test('pad audio reaches the output after volume control and becomes silent on release or mute', async ({ page, browser }, info) => {
  await loadPack(page);
  const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
  await expect.poll(rms, 'a connected, idle output must be silent').toBe(0);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  let playingRms: number | null = null;
  await expect.poll(async () => {
    playingRms = await rms();
    return playingRms;
  }, 'the held pad must produce a nonzero post-volume audio signal').toBeGreaterThan(0.001);
  // Preserve the positive measurement even if a later control check fails.
  await info.attach('output-signal', {
    body: JSON.stringify({ playingRms, browser: info.project.name, browserVersion: browser.version(),
      measurement: 'RMS after application output gain, before native audio destination', humanListening: false }),
    contentType: 'application/json',
  });
  await page.mouse.up();
  await expect.poll(rms, 'release must silence the output').toBe(0);
  const releasedRms = await rms();

  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('input[type=range][max="7"]').fill('0');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await page.keyboard.down('q');
  await expect.poll(() => starts(page)).toBe(2);
  // Still playing a looping source: a pre-volume probe would incorrectly report sound.
  await expect.poll(rms, 'zero application volume must silence a running source').toBe(0);
  const mutedRms = await rms();
  await page.keyboard.up('q');
  await info.attach('output-signal-controls', {
    body: JSON.stringify({ playingRms, releasedRms, mutedRms,
      measurement: 'RMS after application output gain, before native audio destination',
      humanListening: false }),
    contentType: 'application/json',
  });
});

test('a chain change preserves the held loop until release and quit stops playback', async ({ page }) => {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni'));
  await expectPads(page);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBe(3);
  await page.keyboard.down('1');
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  const chain = page.getByRole('button', { name: 'Chain 10', exact: true });
  await chain.click();
  await expect(chain.locator('div[style*="background-color"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
  await page.keyboard.up('1');
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await page.keyboard.down('q');
  await expect.poll(() => starts(page)).toBe(2);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Chain Release v1 manual by UniPad Tests', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
  await page.keyboard.up('q');
  await expect(page).not.toHaveURL(/pack=/);
});

test('auto-play starts, pauses without advancing, resumes, and stops', async ({ page }) => {
  // Exercise state transitions without letting a delayed browser round trip finish
  // the song before the stop click. Native output is checked in audio-visibility.
  await page.addInitScript(() => {
    Object.defineProperty(BaseAudioContext.prototype, 'currentTime', {
      configurable: true,
      get: () => performance.now() / 1000,
    });
  });
  await loadPack(page);
  await page.clock.pauseAt(new Date('2024-01-01T00:00:00.000Z'));
  const auto = page.getByRole('button', { name: 'Play mode: Auto', exact: true });
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(16);
  await page.clock.fastForward(1100);
  expect(await starts(page)).toBe(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const progress = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  // Cross the next note deadline: a paused/stopped runner must emit nothing.
  await page.clock.fastForward(3500);
  expect(await starts(page)).toBe(1);
  expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(progress);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.fastForward(3200);
  expect(await starts(page)).toBe(2);
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.clock.fastForward(3500);
  expect(await starts(page)).toBe(2);
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
});

for (const delayedInspection of [false, true]) {
  test(`Web MIDI discovers devices, receives notes, emits LED bytes and disconnects${delayedInspection ? ' after delayed inspection' : ''}`, async ({ page }, testInfo) => {
    await skipWithoutWebMidi(page);
    test.setTimeout(90_000); // Keep connection checks bounded even on projects with a longer setup budget.
    await loadPack(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await connectLaunchpadAndClear(page);
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
    await expect(dialog).toContainText('Input: Launchpad X Test Input');
    await expect(dialog).toContainText('Output: Launchpad X Test Output');
    await expect(dialog).toContainText('Resolved Type: launchpad_x');
    // The hint promises what the model picker does: a connected device is re-initialised at once.
    await expect(dialog).toContainText('Changing the model applies it immediately to devices that are already connected.');
    await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
    await dialog.locator('select').selectOption('launchpad_mini_mk3');
    await expect(dialog).toContainText('Resolved Type: launchpad_mini_mk3');
    await expect.poll(async () => padLightsAfterMode(await midiMessages(page))).toBeGreaterThanOrEqual(64);
    // As on Android and iOS: lights off in the old layout, the new mode switch, then the whole board again.
    const modelChange = await midiMessages(page);
    const firstSysEx = modelChange.findIndex(m => m[0] === 0xf0);
    expect(firstSysEx, 'lights go off before the mode switch').toBeGreaterThan(0);
    expect(modelChange.slice(0, firstSysEx).every(m => m[2] === 0), 'only lights off before the mode switch').toBe(true);
    expect(modelChange.slice(firstSysEx, firstSysEx + 2)).toEqual([[0xf0, 0, 0x20, 0x29, 2, 0x0d, 0x10, 0, 0xf7], [0xf0, 0, 0x20, 0x29, 2, 0x0d, 0x0e, 1, 0xf7]]);
    const redrawn = modelChange.slice(firstSysEx + 2);
    expect(redrawn.filter(m => m[0] === 0xf0), 'one mode switch only').toEqual([]);
    expect(new Set(redrawn.filter(m => (m[0] & 0xe0) === 0x80).map(m => m[1])).size, 'every pad redrawn').toBeGreaterThanOrEqual(64);
    await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
    await dialog.locator('select').selectOption('auto');
    await expect(dialog).toContainText('Resolved Type: launchpad_x');
    await expect.poll(async () => padLightsAfterMode(await midiMessages(page))).toBeGreaterThanOrEqual(64);
    expect((await midiMessages(page)).filter(m => m[0] === 0xf0)).toEqual([[0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x10, 0, 0xf7], [0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]]);
    expect(await page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const light = await watchLight(page, '0,1');
    try {
      expect(await light.colors()).toEqual([null]);
      await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.emit([0x90, 81, 127]); });
      if (delayedInspection) {
        // Deliberately consume the result after the unchanged 1,200 ms pulse has disappeared.
        await page.waitForTimeout(1500);
        await expect(led(page, '0,1')).toHaveCount(0);
      }
      await expect(pressed(page, '0,0')).toBeVisible();
      await expect.poll(() => starts(page)).toBe(1);
      await expect.poll(light.colors).toEqual([null, 'rgb(239, 83, 80)', null]);
      await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x90, 82, 5]);
      await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
      await expect(pressed(page, '0,0')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x90, 82, 0]);
      expect(await light.colors(), 'the note-off lights nothing again').toEqual([null, 'rgb(239, 83, 80)', null]);
    } finally {
      await light.finish(testInfo);
    }
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(dialog).toContainText('Disconnected');
    await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
    // With nothing connected the choice waits for the next connect; no model is shown as in use.
    await dialog.locator('select').selectOption('launchpad_mini_mk3');
    await expect(dialog).toContainText('Requested Type: launchpad_mini_mk3');
    await expect(dialog).toContainText('Resolved Type: none');
    await dialog.locator('select').selectOption('auto');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(2);
  });
}

// CoreFW keeps the stock product name but names its ports "<model> (MIDI)", and plays and lights the
// drum-rack layout on channel 1: pad 0,0 is note 64, pad 0,1 note 65 (its src/utils/layout.rs).
test('a Launchpad running CoreFW is played and lit in its own layout', async ({ page }, testInfo) => {
  test.slow();
  await skipWithoutWebMidi(page);
  await configureMidiPorts(page, { rename: 'LPX (MIDI)' });
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await expect(dialog).toContainText('Output: LPX (MIDI)');
  await expect(dialog).toContainText('Resolved Type: launchpad_corefw');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await midiMessages(page)).filter(m => m[0] === 0xf0), 'no stock mode switch').toEqual([]);

  const light = await watchLight(page, '0,1');
  try {
    expect(await light.colors()).toEqual([null]);
    await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.emit([0x90, 64, 127]); });
    await expect(pressed(page, '0,0')).toBeVisible();
    await expect.poll(light.colors).toEqual([null, 'rgb(239, 83, 80)', null]);
    await expect.poll(() => padNoteMessages(page, 64)).toEqual([[0x90, 64, 3]]);
    await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 65, 5]);
    await page.evaluate(() => window.browserProbe.midi.emit([0x80, 64, 0]));
    await expect(pressed(page, '0,0')).toHaveCount(0);
    await expect.poll(() => padNoteMessages(page, 64)).toEqual([[0x90, 64, 3], [0x90, 64, 0]]);
    await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 65, 0]);
    expect(await light.colors(), 'the note-off lights nothing again').toEqual([null, 'rgb(239, 83, 80)', null]);
  } finally {
    await light.finish(testInfo);
  }
});

// Analytics calls are queued in gtag's dataLayer; the next event read after an input proves
// that the input was handled, since the events pass through Firebase in order.
const analyticsEvents = (page: Page) => page.evaluate(() =>
  ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
    .map(entry => Array.from(entry))
    .filter(([command]) => command === 'event')
    .map(([, name, params]) => ({ name, inputSource: (params as Record<string, unknown> | undefined)?.input_source })));

const padInputs: Record<'screen' | 'keyboard' | 'midi', (page: Page) => Promise<void>> = {
  screen: async page => { await pad(page, '0,0').hover(); await page.mouse.down(); await page.mouse.up(); },
  keyboard: async page => { await page.keyboard.down('q'); await page.keyboard.up('q'); },
  midi: page => page.evaluate(() => { window.browserProbe.midi.emit([0x90, 81, 127]); window.browserProbe.midi.emit([0x80, 81, 0]); }),
};

for (const [source, press] of Object.entries(padInputs)) {
  test(`the first pad press after a load is recorded once as ${source} input`, async ({ page }) => {
    await loadPack(page);
    const midi = await hasWebMidi(page);
    test.skip(source === 'midi' && !midi, noWebMidi);
    await press(page);
    for (const [other, otherPress] of Object.entries(padInputs)) if (other !== 'midi' || midi) await otherPress(page);
    await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
    await expect.poll(() => analyticsEvents(page).then(events => events.map(e => e.name))).toContain('autoplay_start');
    expect((await analyticsEvents(page)).filter(e => e.name === 'pad_press')).toEqual([{ name: 'pad_press', inputSource: source }]);
  });
}

test('autoplay pressing pads is not recorded as a player pad press', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(() => starts(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await padInputs.screen(page);
  await expect.poll(() => analyticsEvents(page).then(events => events.filter(e => e.name === 'pad_press'))).toEqual([{ name: 'pad_press', inputSource: 'screen' }]);
});

const midiMessages = (page: Page) => page.evaluate(() => window.browserProbe.midi.messages);
const padLightsAfterMode = (messages: number[][]) => {
  const lastMode = messages.map(message => message[0]).lastIndexOf(0xf0);
  return lastMode < 0 ? 0 : new Set(messages.slice(lastMode + 1).filter(message => (message[0] & 0xe0) === 0x80).map(message => message[1])).size;
};
const padNoteMessages = async (page: Page, note: number) => (await midiMessages(page)).filter(m => (m[0] & 0xe0) === 0x80 && m[1] === note);

async function connectLaunchpadAndClear(page: Page) {
  test.skip(!await hasWebMidi(page), noWebMidi);
  await expect.poll(() => midiMessages(page)).toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
  await expect.poll(async () => (await midiMessages(page)).some(message => (message[0] & 0xe0) === 0x80)).toBe(true);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
}

// Android and iOS light a pressed pad red (velocity 3) on the launchpad as well as on screen.
test('the press light reaches the launchpad when it is on', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3]]);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
  await page.mouse.up();
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3], [0x90, 81, 0]]);
});

test('a pressed pad sends nothing to the launchpad while the press light is off', async ({ page }) => {
  await loadPack(page);
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => starts(page)).toBe(1);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  expect(await padNoteMessages(page, 81)).toEqual([]);
});

test('with the pack lights and the press light off, no pad light reaches the launchpad', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'LED', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => starts(page)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  const padNotes = (await midiMessages(page)).filter(m => (m[0] & 0xe0) === 0x80 && m[1] % 10 >= 1 && m[1] % 10 <= 8 && m[1] >= 11 && m[1] <= 88);
  expect(padNotes).toEqual([]);
});

const synthMessages = (page: Page) => page.evaluate(() => window.browserProbe.midi.synthMessages);

// Android and iOS send lights only to a device they recognise; a synthesizer plays each light as a note.
test('pack and press lights reach the launchpad and nothing reaches the synthesizer', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3]]);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
  await page.mouse.up();
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3], [0x90, 81, 0]]);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  expect(await synthMessages(page)).toEqual([]);
});

// Picking the model by hand is how a launchpad with a name the player does not know gets its lights.
test('a model picked by hand keeps lights off the synthesizer', async ({ page }) => {
  await skipWithoutWebMidi(page);
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await dialog.locator('select').selectOption('launchpad_x');
  await expect(dialog).toContainText('Requested Type: launchpad_x');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.synthMessages.length = 0; });
  await pad(page, '0,0').hover();
  await page.mouse.down();
  for (const messages of [midiMessages]) {
    await expect.poll(() => messages(page)).toContainEqual([0x90, 81, 3]);
    await expect.poll(() => messages(page)).toContainEqual([0x90, 82, 5]);
  }
  await page.mouse.up();
  expect(await synthMessages(page)).toEqual([]);
});

for (const [scenario, names, selected] of [
  ['both identically named controllers', ['Launchpad X LPX MIDI Out', 'Launchpad X LPX MIDI Out'], [true, true]],
  ['only the original Pro Standalone port', ['Launchpad Pro Live Port', 'Launchpad Pro Standalone Port', 'Launchpad Pro MIDI Port'], [false, true, false]],
] as const) {
  test(`pad lights reach ${scenario}`, async ({ page }, info) => {
    await skipWithoutWebMidi(page);
    await configureMidiPorts(page, { inputs: names.map(name => name.replace(/Out$/, 'In')), outputs: [...names], replace: true });
    await loadPack(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    const messages = () => midiPortMessages(page);
    const primary = selected.indexOf(true);
    await expect.poll(async () => (await messages())[primary].some(message => message[0] === 0x90)).toBe(true);
    const initialization = await messages();
    await page.evaluate(() => window.midiPortProbe.messages.forEach(messages => { messages.length = 0; }));
    await pad(page, '0,0').hover();
    await page.mouse.down();
    await expect(pressed(page, '0,0')).toBeVisible();
    await expect.poll(async () => (await messages())[primary]).toContainEqual([0x90, 81, 3]);
    const pressedMessages = await messages();
    await info.attach('port-routing-pressed-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await page.mouse.up();
    await expect(pressed(page, '0,0')).toHaveCount(0);
    const releasedMessages = await messages();
    await info.attach('port-routing-signals', { body: JSON.stringify({ names, initialization, pressedMessages, releasedMessages, physicalHardware: false }), contentType: 'application/json' });
    expect.soft(initialization.map(messages => messages.some(message => message[0] === 0xf0))).toEqual(selected);
    expect.soft(pressedMessages.map(messages => messages.some(message => message[0] === 0x90 && message[1] === 81 && message[2] === 3))).toEqual(selected);
    expect(releasedMessages.map(messages => messages.some(message => message[0] === 0x90 && message[1] === 81 && message[2] === 0))).toEqual(selected);
  });
}

// Android's MultiplexDriver lights every pad with its own driver. A master keyboard gets no lights; a
// Launchpad Mini gets the Launchpad S layout (pad x,y is note x * 16 + y, palette 3 and 5 are 63 and 2).
for (const [other, otherLights] of [['Master Keyboard', []], ['Launchpad Mini', [[0x90, 0, 63], [0x90, 1, 2]]]] as const) {
  for (const otherFirst of [true, false]) {
    test(`with ${other} listed ${otherFirst ? 'before' : 'after'} the Launchpad X, each gets the lights in its own layout`, async ({ page }) => {
      await skipWithoutWebMidi(page);
      await configureMidiPorts(page, { outputs: [other], first: otherFirst });
      await loadPack(page);
      await page.getByRole('button', { name: 'Feedback', exact: true }).click();
      await connectLaunchpadAndClear(page);
      const otherMessages = async () => (await midiPortMessages(page))[0];
      await page.evaluate(() => { window.midiPortProbe.messages[0].length = 0; });
      await pad(page, '0,0').hover();
      await page.mouse.down();
      await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3]]);
      await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
      await page.mouse.up();
      await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3], [0x90, 81, 0]]);
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
      for (const light of otherLights) expect(await otherMessages()).toContainEqual(light);
      if (otherLights.length === 0) expect(await otherMessages()).toEqual([]);
    });
  }
}

// Stock X and Mini MK3 share a grid; also exercise two genuinely different layouts.
for (const [name, note] of [
  ['Launchpad Mini MK3', 81],
  ['Launchpad Mini', 0],
  ['Launchpad Mini MK3 MINI MK3 (MIDI)', 64],
] as const) {
  for (const otherFirst of [false, true]) {
    test(`Auto reads each input in its own layout: ${name} ${otherFirst ? 'before' : 'after'} X`, async ({ page }) => {
      await skipWithoutWebMidi(page);
      await configureMidiPorts(page, { inputs: [name], first: otherFirst });
      await loadPack(page);
      await page.getByRole('button', { name: 'Feedback', exact: true }).click();
      for (const source of ['X', 'other'] as const) {
        const send = (status: number, velocity: number) => page.evaluate(({ source, status, velocity, note }) => {
          if (source === 'X') window.browserProbe.midi.emit([status, 81, velocity]);
          else window.midiPortProbe.emit(0, [status, note, velocity]);
        }, { source, status, velocity, note });
        await send(0x90, 127);
        await test.info().attach(`${source}-pressed`, { body: await page.screenshot(), contentType: 'image/png' });
        await expect(pressed(page, '0,0')).toBeVisible();
        await expect.poll(() => starts(page)).toBe(source === 'X' ? 1 : 2);
        await send(0x80, 0);
        await expect(pressed(page, '0,0')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops.length)).toBe(source === 'X' ? 1 : 2);
      }
    });
  }
}

// The basic pack with two chains, where its two sound pads (rows 1 and 2 of column 1) light round
// button 9 (chain 1's button) and round button 10 (chain 2's button), each for a second.
async function roundLightPack(chains = 2, keyLeds: Record<string, string> = {
  '1 1 1 1': 'o mc 9 a 5\nd 1000\nf mc 9\n',
  '1 2 1 1': 'o mc 10 a 21\nd 1000\nf mc 10\n',
}) {
  const zip = await JSZip.loadAsync(await readFile(pack));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', `chain=${chains}`));
  zip.remove('keyLED');
  for (const [name, script] of Object.entries(keyLeds)) zip.file(`keyLED/${name}`, script);
  return { name: 'round-lights.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

// On a Launchpad X the round buttons are control changes; button 9 is CC 89, button 10 is CC 79.
const roundLightMessages = async (page: Page, cc: number) => (await midiMessages(page)).filter(m => m[0] === 0xb0 && m[1] === cc);

async function tapPad(page: Page, position: string, presses: number) {
  await pad(page, position).hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => starts(page)).toBe(presses);
}

for (const [label, earlier, later] of [
  ['decomposed Latin', 'o', 'n\u0303'],
  ['decomposed Hangul', '\u3131', '\u1100\u1161'],
  ['UTF-16 names', '\ud83d\ude00', '\ufffd'],
]) {
  test(`LED filename order matches composed spellings: ${label}`, async ({ page }, testInfo) => {
    const file = await roundLightPack(1, {
      [`1 1 1 0 ${later}`]: 'o 1 2 a 21\nd 60000\n',
      [`1 1 1 0 ${earlier}`]: 'o 1 2 a 5\nd 60000\n',
    });
    await loadPack(page, file);
    const light = led(page, '0,1');
    for (const [index, color] of ['rgb(239, 83, 80)', 'rgb(0, 206, 60)'].entries()) {
      await pad(page, '0,0').hover();
      await page.mouse.down();
      // Both files light the same pad; wait for its rendered light before recording it.
      await expect(light).toHaveCount(1);
      await testInfo.attach(`queue-position-${index + 1}`, { body: await page.screenshot(), contentType: 'image/png' });
      await expect(light).toHaveCSS('background-color', color);
      await page.mouse.up();
      await expect(light).toHaveCount(0);
    }
  });
}

// Android and iOS send a round button its highest remaining light whenever one of its lights
// changes: the selected chain's light (velocity 3) outranks pack lights, which reach round buttons
// only in Pro light mode.
test('a pack light ending on the selected chain button leaves the chain light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await tapPad(page, '1,0', 2);
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
});

test('in Pro light mode a pack light shows on a round button and turns off when it ends', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  // Turning Pro light mode on redraws the round buttons, and the changed setting the chain column,
  // both with the selected chain's light still on.
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
  expect(await roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await tapPad(page, '1,0', 2);
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 21], [0xb0, 79, 0]]);
});

test('numeric zero columns show a round light without warnings and clear it on release', async ({ page }, testInfo) => {
  const file = await roundLightPack(2, { '1 1 1 0': 'on 0 10 FF0000\nd 10000\noff 0 10\nd 10000' });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
  await expectPads(page);
  const warning = page.getByRole('alertdialog');
  const warningCount = await warning.count();
  if (warningCount) {
    await testInfo.attach('import-warnings', { body: await warning.innerText(), contentType: 'text/plain' });
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
  }
  await page.keyboard.press('Alt+p');
  const light = page.getByRole('button', { name: 'Chain 10', exact: true }).locator('div[style*="background-color"]');
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => starts(page)).toBe(1);
  try {
    await expect(light).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  } finally {
    await testInfo.attach('numeric-zero-held', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.mouse.up();
  await expect(light).toHaveCount(0);
  await testInfo.attach('numeric-zero-released', { body: await page.screenshot(), contentType: 'image/png' });
  expect(warningCount, 'numeric zero coordinates do not warn').toBe(0);
});

test('switching chains moves the chain light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('F2');
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 3]]);
  expect(await roundLightMessages(page, 89)).toEqual([[0xb0, 89, 0]]);
});

// From the ninth chain on, the chain light sits on the bottom row (the tenth on CC 7), and hiding
// it redraws every round button as Android's chainBtnsRefresh does.
test('hiding the chain light turns it off on the launchpad from the ninth chain on', async ({ page }) => {
  await loadPack(page, await roundLightPack(12));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('F10');
  await expect.poll(() => roundLightMessages(page, 7)).toEqual([[0xb0, 7, 3]]);
  await page.keyboard.press('Alt+w');
  await expect.poll(async () => (await roundLightMessages(page, 7)).at(-1)).toEqual([0xb0, 7, 0]);
});

// Outside Pro light mode pack lights stay off the round buttons, so turning it off clears a pack
// light still on one (round button 20 is CC 5).
test('turning Pro light mode off clears a pack light left on a round button', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 20 a 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await tapPad(page, '0,0', 1);
  await expect.poll(async () => (await roundLightMessages(page, 5)).at(-1)).toEqual([0xb0, 5, 5]);
  await page.keyboard.press('Alt+p');
  await expect.poll(async () => (await roundLightMessages(page, 5)).at(-1)).toEqual([0xb0, 5, 0]);
});

// The open option panel shows the volume on the chain column; a pack light ending there leaves it.
test('a pack light ending under the open option panel leaves its volume lights', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
  await tapPad(page, '1,0', 1);
  await expect.poll(() => roundLightMessages(page, 79)).toContainEqual([0xb0, 79, 21]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 40]);
  await page.waitForTimeout(1500);
  expect((await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 40]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 0]);
});

// The watermark lights the top row's buttons 5 to 8 (button 5 is CC 95) and, as in Android and
// iOS, outranks a pack light there, so a pack light passing over it leaves the watermark on.
test('a pack light ending on a watermark button leaves the watermark light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 5 a 5\nd 1000\nf mc 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await expect.poll(async () => (await roundLightMessages(page, 95)).at(-1)).toEqual([0xb0, 95, 61]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 95)).toEqual([[0xb0, 95, 61], [0xb0, 95, 61]]);
});

test('with the watermark off, a pack light on the top row turns off when it ends', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 5 a 5\nd 1000\nf mc 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await page.keyboard.press('Alt+w');
  await expect.poll(async () => (await roundLightMessages(page, 95)).at(-1)).toEqual([0xb0, 95, 0]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 95)).toEqual([[0xb0, 95, 5], [0xb0, 95, 0]]);
});

// The open option panel shows its settings on the top row (button 8, CC 98, is the quit light);
// a pack light ending there leaves it, and closing the panel brings the watermark back.
test('a pack light ending under the open option panel leaves its top-row lights', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 8 a 21\nd 1000\nf mc 8\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await tapPad(page, '0,0', 1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 5]);
  await page.waitForTimeout(1500);
  expect((await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 5]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 40]);
});

// Android 4.1.7 drew the pads off-centre (unipad-android#75); the web centred them in the space
// right of the menu, 61 px right of the screen's centre line on every landscape screen, and with
// the menu hidden it centred the pads together with the chain column, half a column to the left,
// and drew them at zero size, then at fractional sizes with seams between them.
for (const [name, file] of [
  ['without a chain column', pack],
  ['with a chain column', resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni')],
]) {
  test(`pad grid sits on the screen centre line in landscape, ${name}`, async ({ page }) => {
    await page.goto('/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
    await expectPads(page);
    for (const hideUI of [false, true]) {
      if (hideUI) await page.keyboard.press('Alt+h');
      await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toHaveCount(hideUI ? 0 : 1);
      for (const [width, height] of [[915, 402], [844, 390], [1280, 720], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        const screen = `${width}x${height}${hideUI ? ' menu hidden' : ''}`;
        await expectLandscapePads(page, screen);
      }
    }
  });
}


for (const [name, selected] of [['LPX MIDI', 1], ['LPMiniMK3 MIDI', 1], ['LPProMK3 MIDI', 0]] as const) {
  test(`Windows alias routing uses the documented interface for ${name}`, async ({ page }, info) => {
    await skipWithoutWebMidi(page);
    // Put the second interface first to also rule out list-order selection.
    const names = [`MIDIOUT2 (${name})`, name];
    const lighting = selected === 1 ? 0 : 1;
    await configureMidiPorts(page, { inputs: names.map(n => n.replace('MIDIOUT', 'MIDIIN')), outputs: names, replace: true });
    await loadPack(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await expect.poll(async () => (await midiPortMessages(page)).flat().some(m => m[0] === 0x90)).toBe(true);
    const initialization = await midiPortMessages(page);
    await page.evaluate(() => window.midiPortProbe.messages.forEach(m => { m.length = 0; }));
    await pad(page, '0,0').hover(); await page.mouse.down();
    await expect(pressed(page, '0,0')).toBeVisible();
    const lights = await midiPortMessages(page);
    await info.attach('windows-routing-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('windows-routing-bytes', { body: JSON.stringify({ names, initialization, lights, physicalHardware: false }), contentType: 'application/json' });
    await page.mouse.up();
    expect(initialization.map(m => m.filter(b => b[0] === 0xf0).length)).toEqual(names.map((_, i) => i === lighting ? 2 : 0));
    expect(lights.map(m => m.some(b => b[0] === 0x90 && b[1] === 81 && b[2] === 3))).toEqual(names.map((_, i) => i === lighting));
  });
}

test('split removal keeps the remaining identical controller ready for lights', async ({ page }, info) => {
  await skipWithoutWebMidi(page);
  await configureMidiPorts(page, { inputs: ['Launchpad X MIDI In', 'Launchpad X MIDI In'], outputs: ['Launchpad X MIDI Out', 'Launchpad X MIDI Out'], replace: true });
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect.poll(async () => (await midiPortMessages(page)).every(m => m.some(b => b[0] === 0x90))).toBe(true);
  await pad(page, '0,0').hover();
  await page.clock.pauseAt(new Date('2024-01-01T00:00:00.000Z'));
  await page.evaluate(() => {
    window.midiPortProbe.messages.forEach(m => { m.length = 0; });
    window.midiPortProbe.remove('inputs', 0);
    window.midiPortProbe.remove('outputs', 0);
    window.midiPortProbe.emit(1, [0x90, 81, 127]);
  });
  await page.clock.runFor(16);
  await expect(pressed(page, '0,0')).toBeVisible();
  const messages = await midiPortMessages(page);
  await info.attach('split-removal-screen', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('split-removal-bytes', { body: JSON.stringify({ messages, elapsed: 16, physicalHardware: false }), contentType: 'application/json' });
  expect(messages[1]).toContainEqual([0x90, 81, 3]);
  expect(messages[1].filter(m => m[0] === 0xf0)).toEqual([]);
});


for (const [names, selected] of [
  [['Foo DAW Out', 'Foo MIDI Out'], 1],
  [['Foo DIN Out', 'Foo Out'], 1],
  [['Foo DAW Out'], 0],
] as const) {
  test(`a manual unknown controller chooses its best available port: ${names.join(', ')}`, async ({ page }, info) => {
    await skipWithoutWebMidi(page);
    await configureMidiPorts(page, { inputs: ['Foo DAW In'], outputs: [...names], replace: true, manufacturer: 'Novation' });
    await loadPack(page);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
    await dialog.locator('select').selectOption('launchpad_x');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(async () => (await midiPortMessages(page)).flat().some(message => message[0] === 0x90)).toBe(true);
    const initialization = await midiPortMessages(page);
    await page.evaluate(() => window.midiPortProbe.messages.forEach(messages => { messages.length = 0; }));
    await pad(page, '0,0').hover(); await page.mouse.down();
    await expect(pressed(page, '0,0')).toBeVisible();
    const lights = await midiPortMessages(page);
    await info.attach('unknown-controller-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('unknown-controller-routing', { body: JSON.stringify({ names, initialization, lights, physicalHardware: false }), contentType: 'application/json' });
    await page.mouse.up();
    expect(initialization.map(messages => messages.filter(message => message[0] === 0xf0).length)).toEqual(names.map((_, i) => i === selected ? 2 : 0));
    expect(lights.map(messages => messages.some(message => message[0] === 0x90 && message[1] === 81 && message[2] === 3))).toEqual(names.map((_, i) => i === selected));
  });
}
