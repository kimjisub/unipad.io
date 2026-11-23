import { test, expect, stateTimeout } from './browser';

// CSS media emulation does not control Firefox's native scrolling preference.
// Enable native motion only in this isolated, audio-free browser; ordinary projects keep host defaults.
test.skip(({ browserName }) => browserName !== 'firefox', 'Firefox native UI preference regression');
test.use({ reducedMotion: 'no-preference', launchOptions: { firefoxUserPrefs: { 'ui.prefersReducedMotion': 0 } } });

test('Firefox full-motion scrolling animates without a project-wide override', async ({ page }, info) => {
  expect(info.project.use.launchOptions?.firefoxUserPrefs ?? {}).not.toHaveProperty('ui.prefersReducedMotion');
  await page.setContent('<style>html{scroll-behavior:smooth}body{margin:0;height:20000px}</style>');
  const immediate = await page.evaluate(() => {
    window.scrollTo({ top: 10000, behavior: 'smooth' });
    return { top: scrollY, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  await info.attach('native-motion', {
    body: JSON.stringify({ platform: process.platform, nativeMotionPreference: 0, immediate }), contentType: 'application/json',
  });
  expect(immediate).toEqual({ top: 0, reduced: false });
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: stateTimeout }).toBe(10000);
});
