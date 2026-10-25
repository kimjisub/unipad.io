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
const { ChainBar } = require('./ChainBar.tsx');
afterEach(cleanup);

function mount() {
  const selected = [];
  const view = render(createElement(ChainBar, {
    chainCount: 8, chainStates: [], currentChain: 0, theme: null, onChainSelect: chain => selected.push(chain),
  }));
  const send = (type, chain, init = {}) => act(() => {
    const button = view.getByRole('button', { name: `Chain ${chain}` });
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    button.dispatchEvent(event);
  });
  return { selected, send };
}

test('a chain changes once, when its button goes down', () => {
  const { selected, send } = mount();
  send('pointerdown', 2);
  assert.deepEqual(selected, [1], 'the chain is chosen before the finger lifts');
  send('pointerup', 2);
  send('click', 2);
  assert.deepEqual(selected, [1], 'lifting the finger does not choose it again');
});

test('a cancelled press keeps the new chain', () => {
  const { selected, send } = mount();
  send('pointerdown', 3);
  send('pointercancel', 3);
  send('lostpointercapture', 3);
  assert.deepEqual(selected, [2]);
});

test('a finger drawn across the chain buttons chooses only the first', () => {
  const { selected, send } = mount();
  send('pointerdown', 1);
  for (const chain of [2, 3, 4]) {
    send('pointerover', chain, { buttons: 1 });
    send('pointerenter', chain, { buttons: 1 });
    send('pointermove', chain, { buttons: 1 });
  }
  send('pointerup', 4);
  assert.deepEqual(selected, [0]);
});
