import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement']) {
  globalThis[name] = dom.window[name];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let reducedMotion = false;
window.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });

// Frames and the clock are driven by the test, so "five seconds" is exact and fast.
let now = 0;
let frames = new Map();
let nextFrame = 1;
mock.method(performance, 'now', () => now);
globalThis.requestAnimationFrame = (callback) => {
  frames.set(nextFrame, callback);
  return nextFrame++;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const observers = [];
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
};

const React = await import('react');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const { NextIntlClientProvider } = createRequire(import.meta.url)('next-intl');
const { HeroSection } = await import('./HeroSection.tsx');
const { LaunchpadDemo, AUTO_PLAY_MS, WAVE_SETTLE_MS } = await import('./LaunchpadDemo.tsx');

const messages = (locale) => JSON.parse(readFileSync(new URL(`../../i18n/messages/${locale}.json`, import.meta.url)));

/** Advances the clock to `ms` one 16 ms frame at a time, running the frames the component asked for. */
function runUntil(ms) {
  act(() => {
    while (now < ms) {
      now = Math.min(now + 16, ms);
      const due = [...frames.values()];
      frames = new Map();
      for (const callback of due) callback(now);
    }
  });
}

const litPads = (view) => [...view.container.querySelectorAll('[data-pad]')].filter((pad) => pad.style.backgroundColor !== '');

function showDemo() {
  const view = render(React.createElement(LaunchpadDemo, { hint: 'Tap the pads' }));
  act(() => observers.at(-1).callback([{ isIntersecting: true }]));
  return view;
}

beforeEach(() => {
  now = 0;
  frames = new Map();
  observers.length = 0;
  reducedMotion = false;
});

afterEach(() => cleanup());

for (const locale of ['ko', 'en']) {
  test(`${locale} hero shows the fixed two-line title and the three start buttons with the guide`, () => {
    const all = messages(locale);
    const view = render(
      React.createElement(NextIntlClientProvider, { locale, messages: all }, React.createElement(HeroSection)),
    );
    const heading = view.getByRole('heading', { level: 1 });
    assert.ok(heading.textContent.startsWith(`${all.hero.headline1} ${all.hero.headline2}`), heading.textContent);
    assert.ok(heading.textContent.includes(all.hero.tagline), 'the search title stays readable to screen readers');
    assert.ok(view.getByText(all.hero.description));

    const links = [...view.container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]);
    assert.deepEqual(links, [
      [all.hero.playOnWeb, '/play', null],
      [`${all.stores.android}${all.stores.googlePlay}`, 'https://play.google.com/store/apps/details?id=com.kimjisub.launchpad', '_blank'],
      [`${all.stores.ios}${all.stores.appStore}`, 'https://apps.apple.com/app/id6760479102', '_blank'],
      [all.hero.guide, '/docs/get-started', null],
    ]);
  });
}

test('pads light by themselves only for the first five seconds in view, then every frame request stops', () => {
  const view = showDemo();
  runUntil(1000);
  assert.ok(litPads(view).length > 0, 'the pads light up by themselves at first');
  runUntil(AUTO_PLAY_MS);
  assert.equal(frames.size, 0, 'no frame is requested once the five seconds are over');
  assert.deepEqual(litPads(view), []);
});

test('with reduced motion the pads never light by themselves', () => {
  reducedMotion = true;
  const view = showDemo();
  runUntil(AUTO_PLAY_MS);
  assert.deepEqual(litPads(view), []);
  assert.equal(frames.size, 0);
});

test('pressing a pad at rest lights it, then the picture rests again', () => {
  reducedMotion = true;
  const view = showDemo();
  runUntil(AUTO_PLAY_MS);
  const pads = view.container.querySelectorAll('[data-pad]');
  fireEvent.pointerDown(pads[27]);
  runUntil(AUTO_PLAY_MS + 48);
  assert.ok(litPads(view).includes(pads[27]), 'the pressed pad lights');
  runUntil(AUTO_PLAY_MS + WAVE_SETTLE_MS + 32);
  assert.equal(frames.size, 0);
  assert.deepEqual(litPads(view), []);
});
