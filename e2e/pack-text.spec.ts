import type { Page } from '@playwright/test';
import { basicTone, openBasicWith } from './basic-pack';
import { test, expect } from './browser';
import { pad } from './touch';

const litPads = (page: Page) => page.locator('[data-pad] div[style*="background-color"]');
/** The dark square practice draws over the pad to press next. */
const guide = (page: Page, position: string) => pad(page, position).locator('div[style*="background-color: rgba(0, 0, 0, 0.87)"]');
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

/** basic.uni with some of its files replaced. */
async function loadBasicWith(page: Page, files: Record<string, string | Uint8Array>) {
  await openBasicWith(page, files);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
}

async function pressAndHold(page: Page, position: string) {
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await pad(page, position).hover();
  await page.mouse.down();
}

/** What Windows Notepad writes for "Unicode" (little-endian) and "Unicode big endian". */
function utf16(text: string, order: 'le' | 'be'): Uint8Array {
  const le = Buffer.from(`\uFEFF${text}`, 'utf16le');
  return new Uint8Array(order === 'le' ? le : le.swap16());
}

for (const order of ['le', 'be'] as const) {
  test(`a keySound saved as UTF-16 ${order.toUpperCase()} with a byte order mark plays`, async ({ page }) => {
    await loadBasicWith(page, { keySound: utf16('1 1 1 tone.wav 0\r\n1 2 1 tone.wav 0\r\n', order) });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await pressAndHold(page, '0,0');
    await expect.poll(() => starts(page)).toBe(1);
    await page.mouse.up();
  });
}

// 똠 is one of the Hangul syllables CP949 adds to EUC-KR (0x8C 0x63), so this needs the browser's CP949.
test('a keySound saved in CP949 (Korean Windows Notepad "ANSI") plays', async ({ page }) => {
  const tone = await basicTone();
  const keySound = Uint8Array.from([...Buffer.from('1 1 1 '), 0x8C, 0x63, ...Buffer.from('.wav 0\r\n')]);
  await loadBasicWith(page, { keySound, 'sounds/똠.wav': tone });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await pressAndHold(page, '0,0');
  await expect.poll(() => starts(page)).toBe(1);
  await page.mouse.up();
});

test('lights outside the pad grid open without warnings and light nothing', async ({ page }) => {
  await loadBasicWith(page, { 'keyLED/1 1 1 1': 'o 9 9 a 5\no 1 9 a 5\no 9 1 a 5\no 1 2 a 5\nd 5000\nf 9 9\nf 1 2' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /warning/i })).toHaveCount(0);

  await pressAndHold(page, '0,0');
  await expect(pad(page, '0,1').locator('div[style*="background-color"]')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await expect(litPads(page)).toHaveCount(1);
  await page.mouse.up();
});

// Pad (1, 1) moves to chain 40 of a two-chain pack; the second autoPlay press is on chain 2.
test('step practice through a keySound move past the last chain plays to the end', async ({ page }, info) => {
  await loadBasicWith(page, {
    info: 'title=Browser Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=2\nsquareButton=true',
    keySound: '1 1 1 tone.wav 1 40\n2 2 1 tone.wav 1\n',
    autoPlay: 'd 1000\no 1 1\nd 200\nf 1 1\nd 3000\no 2 1\nd 200\nf 2 1',
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('[1 1 1 tone.wav 1 40] wormhole is incorrect');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  const step = page.getByRole('button', { name: 'Play mode: Step', exact: true });
  await step.click();
  for (const [position, presses] of [['0,0', 1], ['1,0', 2]] as const) {
    await expect(guide(page, position)).toBeVisible();
    if (presses === 2) await info.attach('nearest-chain-practice-guide', { body: await page.screenshot(), contentType: 'image/png' });
    await pad(page, position).hover();
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => starts(page)).toBe(presses);
  }
  await expect(step).toHaveAttribute('aria-pressed', 'false');
});

test('non-finite sound coordinates warn about format and the following sound still plays', async ({ page }, info) => {
  const huge = '9'.repeat(400);
  await loadBasicWith(page, { keySound: `1 ${huge} 1 tone.wav 0\n1 1 1 tone.wav 0` });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`[1 ${huge} 1 tone.wav 0] format is incorrect`);
  await expect(dialog).toContainText('1 issue');
  await dialog.getByRole('button', { name: 'Show more', exact: true }).click();
  await info.attach('sound-number-warning', { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  await pressAndHold(page, '0,0');
  await expect.poll(() => starts(page)).toBe(1);
  await page.mouse.up();
});

test('a number beyond 32 bits warns about format and the lines after it still work', async ({ page }, info) => {
  const huge = '9'.repeat(400);
  await loadBasicWith(page, {
    keySound: '1 2147483648 1 tone.wav 0\n1 1 1 tone.wav 0',
    'keyLED/1 1 1 1': `o mc ${huge} a 5\no 1 2 a 5\nd 5000\nf 1 2`,
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('2 issues');
  await dialog.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(dialog).toContainText('[1 2147483648 1 tone.wav 0] format is incorrect');
  await expect(dialog).toContainText(`[o mc ${huge} a 5] format is incorrect`);
  await info.attach('beyond-32-bit-warnings', { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  await pressAndHold(page, '0,0');
  await expect.poll(() => starts(page)).toBe(1);
  await expect(pad(page, '0,1').locator('div[style*="background-color"]')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await page.mouse.up();
});
