import { test, expect, stateTimeout } from './browser';

// The native Firefox UI preference must not turn application scrolling into a jump.
test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox native UI preference regression');
test.use({ reducedMotion: 'no-preference' });

test('normal Firefox pages keep smooth scrolling with no motion reduction', async ({ page }) => {
  await page.setContent('<style>html{scroll-behavior:smooth}body{margin:0;height:20000px}</style>');
  const immediate = await page.evaluate(() => {
    window.scrollTo({ top: 10000, behavior: 'smooth' });
    return { top: scrollY, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  expect(immediate).toEqual({ top: 0, reduced: false });
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: stateTimeout }).toBe(10000);
});
