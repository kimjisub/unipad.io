import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement', 'screen']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let gridSize = { width: 800, height: 800 };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.getBoundingClientRect = function () { return { ...gridSize, x: 0, y: 0, top: 0, left: 0, right: gridSize.width, bottom: gridSize.height }; };
const React = await import('react');
const { render, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('./SkinImage.tsx', { SkinImage: () => null });
const { PadGrid } = require('./PadGrid.tsx');
const { getDefaultTheme } = require('../../lib/unipack/ThemeManager.ts');
afterEach(cleanup);

const padStates = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ color: 'transparent', pressed: false, guide: false })));
const sequence = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 7, y: 7 }];
function grid(props = {}) {
  return render(React.createElement(PadGrid, {
    buttonX: 8, buttonY: 8, squareButton: true, theme: getDefaultTheme(), padStates,
    traceLogSequence: sequence, onPadDown() {}, onPadUp() {}, ...props,
  }));
}
const numbers = (view, pad) => view.container.querySelector(`[data-pad="${pad}"] [data-trace-numbers]`);

test('the trace shows tap order numbers on each pad unless lines are chosen', () => {
  for (const style of [undefined, 'numbers']) {
    const view = grid({ traceLogStyle: style });
    assert.equal(numbers(view, '0,0')?.textContent, '1 3');
    assert.equal(numbers(view, '0,1')?.textContent, '2');
    assert.equal(numbers(view, '7,7')?.textContent, '4');
    assert.equal(numbers(view, '3,3'), null);
    assert.equal(view.container.querySelector('svg'), null, 'the numbers replace the lines, they are not drawn together');
    cleanup();
  }
});

test('lines and dots are the other style and draw no numbers', () => {
  const view = grid({ traceLogStyle: 'lines' });
  assert.equal(view.container.querySelectorAll('[data-trace-numbers]').length, 0);
  assert.equal(view.container.querySelectorAll('svg circle').length, 4);
  assert.equal(view.container.querySelector('svg path').getAttribute('stroke'), '#ffffff');
});

test('the default skin draws light numbers with a dark edge, other skins keep their own trace colour', () => {
  let view = grid();
  const own = numbers(view, '0,0');
  assert.equal(own.style.color, 'rgb(230, 233, 237)');
  assert.match(own.style.textShadow, /#161e2b|rgb\(22, 30, 43\)/i);
  cleanup();
  view = grid({ theme: { ...getDefaultTheme(), colors: { traceLog: '#ff0000' } } });
  const skin = numbers(view, '0,0');
  assert.equal(skin.style.color, 'rgb(255, 0, 0)');
  assert.equal(skin.style.textShadow, '');
  cleanup();
  view = grid({ theme: { ...getDefaultTheme(), colors: { traceLog: '#ff0000' } }, traceLogStyle: 'lines' });
  assert.equal(view.container.querySelector('svg path').getAttribute('stroke'), '#ff0000');
});

test('the same order is drawn again after the pads are laid out again', () => {
  const view = grid();
  view.unmount();
  gridSize = { width: 400, height: 600 };
  const again = grid();
  assert.equal(numbers(again, '0,0')?.textContent, '1 3');
  act(() => { again.rerender(React.createElement(PadGrid, {
    buttonX: 8, buttonY: 8, squareButton: true, theme: getDefaultTheme(), padStates,
    traceLogSequence: sequence, traceLogStyle: 'lines', onPadDown() {}, onPadUp() {},
  })); });
  assert.equal(again.container.querySelectorAll('svg circle').length, 4);
  gridSize = { width: 800, height: 800 };
});
