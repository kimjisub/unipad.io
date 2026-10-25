import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement } = await import('react');
const { render, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const id = require.resolve('./SkinImage.tsx');
require.cache[id] = { id, filename: id, loaded: true, exports: { SkinImage: () => null } };
const { PadGrid } = require('./PadGrid.tsx');
afterEach(cleanup);

// A pad is 100px square; the 10px border of every pad is the gap between pads.
const at = (x, y) => ({ clientX: y * 100 + 50, clientY: x * 100 + 50 });
const GAP = { clientX: 100, clientY: 50 };
const OUTSIDE = { clientX: 5000, clientY: 5000 };
document.elementFromPoint = (clientX, clientY) => {
  const grid = document.querySelector('.grid');
  if (!grid || clientX < 0 || clientY < 0 || clientX >= 800 || clientY >= 800) return document.body;
  const inX = clientX % 100;
  const inY = clientY % 100;
  if (inX < 10 || inX >= 90 || inY < 10 || inY >= 90) return grid;
  return grid.querySelector(`[data-pad="${Math.floor(clientY / 100)},${Math.floor(clientX / 100)}"]`);
};

function mount(slideMode) {
  const log = [];
  const padStates = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ color: 'transparent', pressed: false, guide: false })));
  const props = {
    buttonX: 8, buttonY: 8, squareButton: true, theme: null, padStates, slideMode,
    onPadDown: (x, y, input) => log.push(`down ${x},${y} ${input}`),
    onPadUp: (x, y, input) => log.push(`up ${x},${y} ${input}`),
  };
  const view = render(createElement(PadGrid, props));
  const grid = view.container.querySelector('.grid');
  const send = (type, pointerId, point) => act(() => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...point });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    grid.dispatchEvent(event);
  });
  return { log, send, view, props };
}

for (const slideMode of [false, true]) {
  const name = slideMode ? 'slide on' : 'slide off';

  test(`${name}: a finger moved from one pad onto the next`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(2, 2));
    send('pointermove', 1, at(2, 3));
    send('pointerup', 1, at(2, 3));
    assert.deepEqual(log, slideMode
      ? ['down 2,2 pointer-1', 'up 2,2 pointer-1', 'down 2,3 pointer-1', 'up 2,3 pointer-1']
      : ['down 2,2 pointer-1', 'up 2,2 pointer-1']);
  });

  test(`${name}: a finger moved through the gap onto the next pad`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(2, 2));
    send('pointermove', 1, GAP);
    assert.deepEqual(log, slideMode ? ['down 2,2 pointer-1', 'up 2,2 pointer-1'] : ['down 2,2 pointer-1']);
    send('pointermove', 1, at(2, 3));
    send('pointerup', 1, at(2, 3));
    assert.deepEqual(log, slideMode
      ? ['down 2,2 pointer-1', 'up 2,2 pointer-1', 'down 2,3 pointer-1', 'up 2,3 pointer-1']
      : ['down 2,2 pointer-1', 'up 2,2 pointer-1']);
  });

  test(`${name}: a finger moved off the pads and back`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(0, 0));
    send('pointermove', 1, OUTSIDE);
    assert.deepEqual(log, slideMode ? ['down 0,0 pointer-1', 'up 0,0 pointer-1'] : ['down 0,0 pointer-1']);
    send('pointermove', 1, at(0, 1));
    send('pointerup', 1, OUTSIDE);
    assert.deepEqual(log, slideMode
      ? ['down 0,0 pointer-1', 'up 0,0 pointer-1', 'down 0,1 pointer-1', 'up 0,1 pointer-1']
      : ['down 0,0 pointer-1', 'up 0,0 pointer-1']);
  });

  test(`${name}: two fingers are followed independently`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(1, 1));
    send('pointerdown', 2, at(5, 5));
    send('pointermove', 1, at(1, 2));
    send('pointerup', 2, at(5, 5));
    send('pointerup', 1, at(1, 2));
    assert.deepEqual(log, slideMode
      ? ['down 1,1 pointer-1', 'down 5,5 pointer-2', 'up 1,1 pointer-1', 'down 1,2 pointer-1', 'up 5,5 pointer-2', 'up 1,2 pointer-1']
      : ['down 1,1 pointer-1', 'down 5,5 pointer-2', 'up 5,5 pointer-2', 'up 1,1 pointer-1']);
  });

  test(`${name}: a cancelled touch is released and never pressed again`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(3, 3));
    send('pointercancel', 1, at(3, 3));
    send('pointermove', 1, at(3, 4));
    send('pointerup', 1, at(3, 4));
    assert.deepEqual(log, ['down 3,3 pointer-1', 'up 3,3 pointer-1']);
  });

  test(`${name}: turning the screen releases every finger, which stays released until lifted`, () => {
    const { log, send } = mount(slideMode);
    send('pointerdown', 1, at(3, 3));
    send('pointerdown', 2, at(4, 4));
    act(() => { window.dispatchEvent(new window.Event('orientationchange')); });
    assert.deepEqual(log, ['down 3,3 pointer-1', 'down 4,4 pointer-2', 'up 3,3 pointer-1', 'up 4,4 pointer-2']);
    send('pointermove', 1, at(3, 4));
    send('pointermove', 2, at(4, 4));
    send('pointerup', 1, at(3, 4));
    send('pointerup', 2, at(4, 4));
    assert.equal(log.length, 4, 'a finger left down through the turn must not press again');
  });

  test(`${name}: changing the setting releases the fingers already down`, () => {
    const { log, send, view, props } = mount(slideMode);
    send('pointerdown', 1, at(6, 6));
    act(() => { view.rerender(createElement(PadGrid, { ...props, slideMode: !slideMode })); });
    assert.deepEqual(log, ['down 6,6 pointer-1', 'up 6,6 pointer-1']);
    send('pointermove', 1, at(6, 7));
    send('pointerup', 1, at(6, 7));
    assert.equal(log.length, 2);
  });
}

test('the setting is off unless it is given', () => {
  const { log, send } = mount(undefined);
  send('pointerdown', 1, at(2, 2));
  send('pointermove', 1, at(2, 3));
  send('pointerup', 1, at(2, 3));
  assert.deepEqual(log, ['down 2,2 pointer-1', 'up 2,2 pointer-1']);
});
