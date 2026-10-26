import { test, expect } from './browser';
import { expectLandscapePads, padGrid } from './pad-layout';

test.use({ viewport: { width: 1920, height: 1080 } });

test('landscape checks wait for the resized pads even when the old grid is centred', async ({ page }, info) => {
  // Exercise the assertion against browser layout without loading the player and decoding a pack.
  // The real player's layouts, with and without chains, are covered in play.spec.ts.
  await test.step('prepare a centred grid with held native resize delivery', async () => {
    await page.setContent(`
      <style>
        html, body { margin: 0; height: 100%; }
        #grid { display: grid; grid-template-columns: repeat(8, var(--pad-size)); width: max-content; position: absolute; left: 50%; transform: translateX(-50%); }
        [data-pad] { width: var(--pad-size); height: var(--pad-size); background: #555; }
      </style>
      <div id="grid">${'<div data-pad></div>'.repeat(64)}</div>
    `);
    await page.evaluate(() => {
      let hold = false;
      const pending: (() => void)[] = [];
      window.addEventListener('hold-pad-resize', () => { hold = true; });
      window.addEventListener('release-pad-resize', () => {
        hold = false;
        pending.splice(0).forEach(deliver => deliver());
      });
      new ResizeObserver(entries => {
        const size = Math.floor(entries[0].contentRect.height / 8);
        const deliver = () => document.documentElement.style.setProperty('--pad-size', `${size}px`);
        if (hold) pending.push(deliver);
        else deliver();
      }).observe(document.body);
    });
    await expectLandscapePads(page, '1920x1080');
  });

  await page.evaluate(() => window.dispatchEvent(new Event('hold-pad-resize')));
  await page.setViewportSize({ width: 915, height: 402 });
  const before = await padGrid(page);
  expect(before.offCentre).toBeLessThanOrEqual(1);
  expect(before.heightShare).toBeGreaterThan(1);
  expect(before.wholePixelPads).toBe(true);
  await test.step('capture the oversized old pads', async () => {
    await info.attach('before-resize-delivery', { body: await page.screenshot(), contentType: 'image/png' });
  });

  // Observe browser measurements without adding a test hook to the assertion helper.
  const samples = await page.evaluateHandle(() => {
    const samples: { heightShare: number }[] = [];
    const pad = document.querySelector<HTMLElement>('[data-pad]')!;
    const measure = pad.getBoundingClientRect.bind(pad);
    pad.getBoundingClientRect = () => {
      const rect = measure();
      samples.push({ heightShare: rect.height * 8 / window.innerHeight });
      return rect;
    };
    return samples;
  });
  type Outcome = 'waiting' | 'accepted' | 'rejected';
  let outcome: Outcome = 'waiting';
  let failure: unknown;
  const check = expectLandscapePads(page, '915x402').then(
    () => { outcome = 'accepted'; },
    error => { outcome = 'rejected'; failure = error; },
  );
  let outcomeBeforeRelease: Outcome = 'waiting';
  let samplesBeforeRelease: { heightShare: number }[] = [];
  try {
    await test.step('reject the old grid before releasing resize delivery', async () => {
      // The old helper made three separate measurements. Let it finish all three,
      // or let a retrying helper measure again, before checking whether it settled.
      await expect.poll(async () => outcome !== 'waiting' || await samples.evaluate(values => values.length >= 4)).toBe(true);
      // Drain the browser round trip and its assertion continuations before observing completion.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      samplesBeforeRelease = await samples.jsonValue();
      outcomeBeforeRelease = outcome;
    });
  } finally {
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('release-pad-resize')));
    } finally {
      // Both completion paths were handled at creation, even if resize delivery fails.
      await check;
      const measured = await samples.jsonValue();
      const after = await padGrid(page);
      await info.attach('resize-measurements', {
        body: JSON.stringify({ before, after, samples: measured, samplesBeforeRelease, outcomeBeforeRelease, outcome }),
        contentType: 'application/json',
      });
      await test.step('capture the resized pads', async () => {
        await info.attach('after-resize-delivery', { body: await page.screenshot(), contentType: 'image/png' });
      });
    }
  }
  if (failure) throw failure;
  expect(outcomeBeforeRelease, 'an oversized old grid must not satisfy the layout check').toBe('waiting');
  expect(samplesBeforeRelease.length).toBeGreaterThan(0);
  expect(samplesBeforeRelease.every(grid => grid.heightShare > 1)).toBe(true);
  expect((await padGrid(page)).heightShare).toBeLessThanOrEqual(1);
});
