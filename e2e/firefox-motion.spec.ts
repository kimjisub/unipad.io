import { test, expect, stateTimeout } from './browser';

// Native smooth scrolling follows the host preference even when CSS media is emulated.
test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox native UI preference regression');
test.use({ reducedMotion: 'no-preference' });

test('normal Firefox scrolling follows host motion without a project override', async ({ page }, info) => {
  expect(info.project.use.launchOptions?.firefoxUserPrefs ?? {}).not.toHaveProperty('ui.prefersReducedMotion');
  await page.setContent('<style>html{scroll-behavior:smooth}body{margin:0;height:20000px}</style>');
  await page.emulateMedia({ reducedMotion: null });
  const nativeReduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const immediate = await page.evaluate(() => {
    window.scrollTo({ top: 10000, behavior: 'smooth' });
    return { top: scrollY, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  await info.attach('native-motion', {
    body: JSON.stringify({ platform: process.platform, nativeReduced, immediate }), contentType: 'application/json',
  });
  expect(immediate).toEqual({ top: nativeReduced ? 10000 : 0, reduced: false });
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: stateTimeout }).toBe(10000);
});
