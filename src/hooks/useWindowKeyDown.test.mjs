import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent } = await import('@testing-library/react');
const { useWindowKeyDown } = await import('./useWindowKeyDown.ts');
afterEach(cleanup);

function Probe({ value, seen, enabled, capture }) {
  useWindowKeyDown(event => seen.push(`${event.key} ${value}`), { enabled, capture });
  return null;
}

/** Records window keydown listeners attached and removed while `action` runs. */
function trackListeners(action) {
  const calls = [];
  const { addEventListener, removeEventListener } = window;
  window.addEventListener = function (type, listener, options) {
    if (type === 'keydown') calls.push(['add', listener, options]);
    return addEventListener.call(this, type, listener, options);
  };
  window.removeEventListener = function (type, listener, options) {
    if (type === 'keydown') calls.push(['remove', listener, options]);
    return removeEventListener.call(this, type, listener, options);
  };
  try { action(); } finally {
    window.addEventListener = addEventListener;
    window.removeEventListener = removeEventListener;
  }
  return calls;
}

test('50 re-renders attach the listener once and unmounting removes that same listener once', () => {
  const seen = [];
  const calls = trackListeners(() => {
    const view = render(React.createElement(Probe, { value: 0, seen }));
    for (let value = 1; value <= 50; value++) view.rerender(React.createElement(Probe, { value, seen }));
    view.unmount();
  });
  assert.deepEqual(calls.map(([kind, , capture]) => [kind, capture]), [['add', false], ['remove', false]]);
  assert.equal(calls[0][1], calls[1][1]);
});

test('the first key after a re-render sees the latest value', () => {
  const seen = [];
  const view = render(React.createElement(Probe, { value: 'first', seen }));
  for (const value of ['second', 'third']) {
    view.rerender(React.createElement(Probe, { value, seen }));
    fireEvent.keyDown(window, { key: 'a' });
  }
  assert.deepEqual(seen, ['a second', 'a third']);
});

test('a disabled handler is skipped without detaching, and resumes when enabled again', () => {
  const seen = [];
  let view;
  const calls = trackListeners(() => {
    view = render(React.createElement(Probe, { value: 'on', seen }));
    view.rerender(React.createElement(Probe, { value: 'off', seen, enabled: false }));
    fireEvent.keyDown(window, { key: 'a' });
    view.rerender(React.createElement(Probe, { value: 'again', seen }));
    fireEvent.keyDown(window, { key: 'b' });
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(seen, ['b again']);
});

test('a capture handler runs before bubbling page listeners attached earlier', () => {
  const order = [];
  const page = () => order.push('page');
  window.addEventListener('keydown', page);
  try {
    function Capturing() {
      useWindowKeyDown(() => order.push('capture'), { capture: true });
      return null;
    }
    render(React.createElement(Capturing));
    fireEvent.keyDown(document.body, { key: 'Escape' });
  } finally {
    window.removeEventListener('keydown', page);
  }
  assert.deepEqual(order, ['capture', 'page']);
});
