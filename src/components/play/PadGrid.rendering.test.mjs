import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement } = await import('react');
const { render, cleanup } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const images = [];
const id = require.resolve('./SkinImage.tsx');
require.cache[id] = { id, filename: id, loaded: true, exports: {
  SkinImage: ({ src, ...props }) => {
    images.push(src);
    return createElement('img', { ...props, src });
  },
} };
const { PadGrid } = require('./PadGrid.tsx');
afterEach(() => { cleanup(); images.length = 0; });

test('changing one light redraws its pad without redrawing the other skin images', () => {
  const padStates = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ color: 'transparent', pressed: false, guide: false })));
  const props = { buttonX: 8, buttonY: 8, squareButton: true, theme: { btn: 'button.png' }, padStates, onPadDown() {}, onPadUp() {} };
  const view = render(createElement(PadGrid, props));
  assert.equal(images.length, 64);
  images.length = 0;
  const changed = padStates.map(row => row.map(pad => ({ ...pad })));
  changed[0][1].color = 'rgb(239, 83, 80)';
  view.rerender(createElement(PadGrid, { ...props, padStates: changed }));
  assert.equal(images.length, 1, 'only the changed pad needs its skin rendered again');
  assert.equal(view.container.querySelector('[data-pad="0,1"] .z-10').style.backgroundColor, 'rgb(239, 83, 80)');
  images.length = 0;
  view.rerender(createElement(PadGrid, { ...props, padStates: changed, theme: { btn: 'another-button.png' } }));
  assert.equal(images.length, 64, 'a changed skin must still update every pad');
  assert.ok(images.every(src => src === 'another-button.png'));
});
