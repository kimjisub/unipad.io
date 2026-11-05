import { resolve } from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect, expectPads } from './browser';
import { connectStore } from './database';
import { measureElements, measureReachability, reachable, resize } from './layout';
import { importSavedPack, savedRecords } from './saved-packs';

const viewports = [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 430, height: 932 }];
// Phone widths, then the wider ones where the store number and the language decide when the buttons wrap.
const widths = [
  ...Array.from({ length: 12 }, (_, step) => 320 + step * 10),
  ...Array.from({ length: 11 }, (_, step) => 440 + step * 20),
];

const locales = [
  { locale: 'en-US', search: 'Search unipacks', ascending: 'Sort ascending', descending: 'Sort descending', theme: 'Theme', store: 'Store', play: 'Play' },
  { locale: 'ko-KR', search: '유니팩 검색', ascending: '오름차순 정렬', descending: '내림차순 정렬', theme: '테마', store: '스토어', play: '재생' },
] as const;

const packTitle = 'Browser Test Pack';
// Live visitors see this number on the store button, which makes the button row wider.
const storeCount = 128;

/** Every control in the bar, in reading order. */
function bar(page: Page, text: (typeof locales)[number]) {
  return {
    sort: page.getByRole('button', { name: /^(Title|Producer|Date)$/ }),
    direction: page.getByRole('button', { name: new RegExp(`^(${text.ascending}|${text.descending})$`) }),
    search: page.getByRole('textbox', { name: text.search, exact: true }),
    theme: page.getByRole('button', { name: text.theme, exact: true }),
    // The empty list shows its own store button further down the page.
    store: page.getByRole('button', { name: new RegExp(`^${text.store}`) }).first(),
    import: page.getByRole('button', { name: '+ Import', exact: true }),
  };
}

/** The store answers with a count, as it does for a visitor; a build without a database stops here. */
async function showStoreCount(page: Page, context: BrowserContext, text: (typeof locales)[number], open: () => Promise<void>) {
  const database = await connectStore(context, storeCount);
  await open();
  await database.publish(storeCount);
  await expect(bar(page, text).store).toContainText(String(storeCount));
}

type Measurement = Awaited<ReturnType<typeof measureElements>>[number];

/** The whole control is on screen, a press at its centre reaches it and no two controls touch. */
function expectReachable(names: string[], measurements: Measurement[]) {
  for (const [index, name] of names.entries()) {
    const { box, inside, pressable } = measurements[index];
    expect({ inside, pressable }, name).toEqual({ inside: true, pressable: true });
    for (const [otherIndex, otherName] of names.entries()) {
      if (otherIndex <= index) continue;
      const other = measurements[otherIndex].box;
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width
        && box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, `${name} overlaps ${otherName}`).toBe(false);
    }
  }
}

/** Measured once fonts and the CSS size transitions they start have settled. */
async function expectAllReachable(controls: Partial<ReturnType<typeof bar>>) {
  const named = Object.entries(controls);
  expectReachable(named.map(([name]) => name), await measureReachability(named.map(([, control]) => control), { transitions: true }));
}

async function expectFileChooser(page: Page, control: Locator) {
  const chooser = page.waitForEvent('filechooser');
  await control.click();
  await chooser;
}

async function expectStoreOpens(page: Page, control: Locator) {
  await control.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('reachability reads moving controls in the same browser turn', async ({ page }) => {
  await page.setContent('<div style="display:flex;gap:20px"><button>Theme</button><button>+ Import</button></div>');
  await page.evaluate(() => {
    const hitTest = document.elementFromPoint.bind(document);
    const turns: number[] = [];
    let turn = 0;
    Object.assign(window, { measurementTurns: turns });
    document.elementFromPoint = (x, y) => {
      turns.push(turn);
      // The microtask moves the layout after this synchronous browser evaluation finishes.
      queueMicrotask(() => {
        document.querySelector('div')!.style.marginLeft = `${++turn * 10}px`;
      });
      return hitTest(x, y);
    };
  });
  await expectAllReachable({ theme: page.getByRole('button', { name: 'Theme' }), import: page.getByRole('button', { name: '+ Import' }) });
  const turns = await page.evaluate(() => (window as unknown as { measurementTurns: number[] }).measurementTurns);
  expect(turns).toEqual([0, 0]);
});

test('reachability never combines rectangles from different layouts', async ({ page }) => {
  await page.setContent(`<style>
    div { display: flex; gap: 80px; width: 240px; }
    button { width: 80px; height: 40px; flex-shrink: 0; }
  </style><div><button>Theme</button><button>+ Import</button></div>`);
  await page.evaluate(() => {
    const row = document.querySelector('div')!;
    // Each layout has two disjoint 80px buttons, 80px apart. Swapping both in one task
    // keeps them disjoint, but rectangles read on opposite sides of a swap overlap.
    let reversed = false;
    setInterval(() => {
      reversed = !reversed;
      row.style.flexDirection = reversed ? 'row-reverse' : 'row';
    }, 0);
  });
  const controls = { theme: page.getByRole('button', { name: 'Theme' }), import: page.getByRole('button', { name: '+ Import' }) };
  for (let sample = 0; sample < 40; sample++) await expectAllReachable(controls);
});

test('reachability waits for the native size transition before measuring', async ({ page }) => {
  await page.setContent(`<style>button { font-size: 12px; transition: font-size 150ms; } div { display: flex; gap: 20px; }</style>
    <div><button>Theme</button><button>+ Import</button></div>`);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.forEach(button => button.getBoundingClientRect());
    buttons.forEach(button => { button.style.fontSize = '24px'; });
    const animations = document.getAnimations();
    if (animations.length !== 2) throw new Error(`Expected two native transitions, got ${animations.length}`);
    animations.forEach(animation => { animation.pause(); animation.currentTime = 75; });
    const probe = { started: false, earlyReads: 0 };
    Object.assign(window, { transitionProbe: probe });
    const getAnimations = document.getAnimations.bind(document);
    document.getAnimations = () => { probe.started = true; return getAnimations(); };
    const hitTest = document.elementFromPoint.bind(document);
    document.elementFromPoint = (x, y) => {
      probe.started = true;
      if (animations.some(animation => animation.playState !== 'finished')) probe.earlyReads++;
      return hitTest(x, y);
    };
  });
  await Promise.all([
    expectAllReachable({ theme: page.getByRole('button', { name: 'Theme' }), import: page.getByRole('button', { name: '+ Import' }) }),
    (async () => {
      await page.waitForFunction(() => (window as unknown as { transitionProbe: { started: boolean } }).transitionProbe.started);
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    })(),
  ]);
  expect(await page.evaluate(() => (window as unknown as { transitionProbe: { earlyReads: number } }).transitionProbe.earlyReads)).toBe(0);
});

for (const text of locales) {
  test.describe(text.locale, () => {
    test.use({ locale: text.locale });

    test('every control works on a phone-width screen with no saved packs', async ({ page, context }) => {
      await showStoreCount(page, context, text, async () => { await page.goto('/play'); });
      const { theme, store, import: importButton } = bar(page, text);
      for (const viewport of viewports) {
        await resize(page, viewport);
        await expectAllReachable({ theme, store, import: importButton });
        await expectFileChooser(page, theme);
        await expectStoreOpens(page, store);
        await expectFileChooser(page, importButton);
      }
    });

    test('the bar and the first pack fit a short screen at every narrow width', async ({ page, context }) => {
      test.setTimeout(90_000);
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      // The bar keeps the same elements at every width; only CSS wrapping moves them. Find them once,
      // then let one browser call per width resize, settle and measure: a busy machine makes each call slow.
      const named = Object.entries(bar(page, text));
      const names = named.map(([name]) => name);
      const elements = await Promise.all(named.map(([, control]) => control.elementHandle()));
      try {
        for (const width of widths) {
          const measurements = await measureElements(page, elements, { viewport: { width, height: 568 }, transitions: true });
          expectReachable(names.map(name => `${name} at ${width}px`), measurements);
          expect(measurements[names.indexOf('search')].box.width, `search box width at ${width}px`).toBeGreaterThanOrEqual(112);
          await expect(row, `first pack at ${width}px`).toBeInViewport({ ratio: 0.99 });
        }
      } finally {
        await Promise.all(elements.map(element => element.dispose()));
      }
    });

    test('every control works on a phone-width screen with a saved pack', async ({ page, context }) => {
      test.setTimeout(90_000);
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      for (const viewport of viewports) {
        await resize(page, viewport);
        await expect(row).toBeInViewport({ ratio: 0.99 });

        await controls.search.click();
        await page.keyboard.type('no such pack');
        await expect(controls.search).toHaveValue('no such pack');
        await expect(row).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(row).toBeVisible();

        await controls.sort.click();
        await page.getByRole('button', { name: 'Title', exact: true }).last().click();
        const direction = await controls.direction.getAttribute('aria-label');
        await controls.direction.click();
        await expect(controls.direction).not.toHaveAttribute('aria-label', direction!);
        await controls.sort.click();
        await page.getByRole('button', { name: 'Date', exact: true }).last().click();

        await expectFileChooser(page, controls.theme);
        await expectStoreOpens(page, controls.store);
        await expectFileChooser(page, controls.import);
      }
    });

    test('the search box and the first pack stay usable at 320px with 200% text', async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
      const controls = bar(page, text);
      const row = page.getByRole('option', { name: new RegExp(packTitle) });
      await expect(row).toBeVisible();
      await resize(page, { width: 320, height: 800 });
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      // Measure every control after the text resize has finished moving the layout.
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
      await expectAllReachable(controls);
      expect((await controls.search.boundingBox())!.width, 'search box width').toBeGreaterThanOrEqual(224);
      await expect(row).toBeInViewport({ ratio: 0.99 });
    });
  });
}

// Include every reported short height and the widths where the counted store button wraps.
const shortScreens = [
  { width: 360, height: 600 },
  ...Array.from({ length: 16 }, (_, index) => ({ width: 340 + index * 10, height: 640 })),
  { width: 320, height: 640 }, { width: 320, height: 667 }, { width: 360, height: 700 },
];
const scrollSwitchScreens = [{ width: 320, height: 568 }, { width: 640, height: 360 }];

for (const text of locales) {
  for (const textScale of [100, 200]) {
    test.describe(`${text.locale} ${textScale}% text`, () => {
      test.use({ locale: text.locale, reducedMotion: 'reduce' });
      test('selected pack can start without scrolling on short phones', async ({ page, context }, testInfo) => {
        test.setTimeout(120_000);
        await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
        if (textScale === 200) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const row = page.getByRole('option', { name: new RegExp(packTitle) });
        if (await row.getAttribute('aria-selected') !== 'true') await row.click();
        await expect(row).toHaveAttribute('aria-selected', 'true');
        const play = page.getByRole('button', { name: text.play, exact: true });
        const measurements = [];
        for (const viewport of [...shortScreens, ...(textScale === 100 ? scrollSwitchScreens : [])]) {
          await resize(page, viewport);
          // Never let locator.click scroll the details to disguise a clipped action.
          const state = await reachable(play);
          const search = await bar(page, text).search.boundingBox();
          const pack = await row.boundingBox();
          measurements.push({ ...viewport, state, searchWidth: search!.width, packHeight: pack!.height });
          if (viewport.width === 360 && viewport.height === 600) {
            await testInfo.attach('short-selected-pack', { body: await page.screenshot(), contentType: 'image/png' });
          }
          await testInfo.attach(`layout-${viewport.width}x${viewport.height}`, { body: JSON.stringify(measurements.at(-1)), contentType: 'application/json' });
          await expect(play).toBeInViewport({ ratio: 1 });
          expect(state, `play at ${viewport.width}x${viewport.height}`).toEqual({ inside: true, pressable: true });
          expect(search!.width, 'search box width').toBeGreaterThanOrEqual(180);
          expect(pack!.height, 'first pack height').toBe(72);
          await expect(row).toBeInViewport({ ratio: 0.99 });
        }
        // A visible button must actually open the pack and start sound from a pad.
        const decoded = await page.evaluate(() => window.browserProbe.audio.decoded.length);
        await play.click();
        await expectPads(page);
        await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBeGreaterThan(decoded);
        // Phone playback asks for landscape before accepting pad input.
        await resize(page, { width: 700, height: 360 });
        const pad = page.locator('[data-pad="0,0"]');
        const starts = await page.evaluate(() => window.browserProbe.audio.starts.length);
        await pad.click();
        await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBeGreaterThan(starts);
      });
    });
  }

  test.describe(`${text.locale} scrolled details`, () => {
    test.use({ locale: text.locale, reducedMotion: 'reduce' });
    for (const viewport of scrollSwitchScreens) {
      test(`switching packs restores playback after scrolling at ${viewport.width}x${viewport.height}`, async ({ page, context }, testInfo) => {
        await showStoreCount(page, context, text, () => importSavedPack(page, '/play'));
        await page.locator('input[data-unipack-import]').setInputFiles(resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni'));
        await expectPads(page);
        await expect.poll(async () => (await savedRecords(page)).length).toBe(2);
        await page.goto('/play');
        await resize(page, viewport);
        const first = page.getByRole('option', { name: new RegExp(packTitle) });
        const second = page.getByRole('option', { name: /Chain Release v1 manual/ });
        const play = page.getByRole('button', { name: text.play, exact: true });
        for (const [from, to] of [[first, second], [second, first]]) {
          if (await from.getAttribute('aria-selected') !== 'true') await from.click();
          await expect(from).toHaveAttribute('aria-selected', 'true');
          const details = page.locator('div.overflow-y-auto').filter({ has: play });
          await details.evaluate(element => { element.scrollTop = element.scrollHeight; });
          await expect.poll(() => details.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
          await expect(play).not.toBeInViewport({ ratio: 1 });
          await to.click();
          await expect(to).toHaveAttribute('aria-selected', 'true');
          await testInfo.attach('switched-pack', { body: await page.screenshot(), contentType: 'image/png' });
          // Check before clicking: Playwright would otherwise scroll a clipped button into view.
          await expect(play).toBeInViewport({ ratio: 1 });
          expect(await reachable(play)).toEqual({ inside: true, pressable: true });
          expect(await details.evaluate(element => element.scrollTop)).toBe(0);
        }
        await play.click();
        await expectPads(page);
      });
    }
  });
}
