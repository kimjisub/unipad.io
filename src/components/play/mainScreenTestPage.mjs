// A browser page in Node for the pack list's unit tests. Import it before React or the component:
// React and framer-motion read these globals when they load.
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: value => value };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

export const require = createRequire(import.meta.url);

/** Replaces a module, resolved from this folder, for every later `require` of it. */
export function stub(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

require('framer-motion').MotionGlobalConfig.skipAnimations = true;

const noop = () => {};

/** Every callback the pack list requires, each doing nothing. */
export const mainScreenCallbacks = {
  onPlay: noop, onOpenStore: noop, onImport: noop, onImportTheme: noop, onDeletePack: noop,
  onDeleteTheme: noop, onApplyTheme: noop, onClearTheme: noop, onToggleBookmark: noop,
};
