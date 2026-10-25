import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement', 'screen']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const React = await import('react');
const { render, cleanup, act, fireEvent } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const noop = () => {};
const translate = key => key;
stub('next-intl', { useTranslations: () => translate });
stub('framer-motion', { AnimatePresence: ({ children }) => children, motion: { div: 'div' } });
for (const name of ['PadGrid', 'ChainBar', 'ControlPanel', 'OptionPanel', 'StoreModal', 'SkinImage', 'LaunchpadSettingsModal']) {
  stub(`./${name}.tsx`, { [name]: () => null });
}
let main;
stub('./MainScreen.tsx', { MainScreen: props => { main = props; return null; }, ConfirmDialog: () => null });
stub('../../lib/store.ts', { subscribeStoreCount: async () => noop });
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent: noop });
let held = {}, storage, loads, themes, engine, nextResult, library, loadOverrides;
const deferred = () => { let resolve, reject; return { promise: new Promise((r, j) => { resolve = r; reject = j; }), resolve, reject }; };
const hold = kind => {
  const waiting = { ...deferred(), entered: deferred() };
  (held[kind] ??= []).push(waiting);
  return waiting;
};
const step = async (kind, run) => {
  const waiting = held[kind]?.shift();
  if (waiting) { waiting.entered.resolve(); await waiting.promise; }
  return run();
};
const savedAutoPlay = { current: [{ type: 'delay', delay: 1000 }], backup: [] };
const pack = id => ({ ...(id === 'B' ? { autoPlay: savedAutoPlay } : {}), id, title: id, zipData: id, info: { title: id, buttonX: 8, buttonY: 8, chain: 1 }, soundCount: 1 });
stub('../../lib/unipack/index.ts', {
  listUniPacks: () => step('list', () => [...library.values()]), listThemes: async () => [],
  getUniPack: id => step('read', () => pack(id)),
  updateUniPackLastOpened: () => step('recent', noop),
  getTheme: () => step('themeRead', () => ({ zipData: 'saved-theme' })),
  getSetting: key => step(key === 'lastThemeId' ? 'themeSetting' : 'setting', () => storage.get(key) ?? null),
  setSetting: (key, value) => step(key === 'lastUniPackId' ? 'lastWrite' : 'write', () => storage.set(key, value)),
  parseUniPack: async data => pack(data),
  saveUniPack: () => step('save', () => { library.set('Imported', pack('Imported')); return 'Imported'; }),
});
function useTestEngine() {
  const [state, setState] = React.useState({
    loaded: false, loading: false, errors: [], unipack: null, padStates: [], chainStates: [], traceLogSequence: [], theme: { images: {}, colors: {} },
  });
  const revision = React.useRef(0);
  const unload = React.useCallback(() => {
    revision.current++;
    setState(prev => ({ ...prev, loaded: false, loading: false, unipack: null }));
  }, []);
  const loadUniPack = React.useCallback(async (data, autoPlay) => {
    loadOverrides.push(autoPlay);
    unload(); const own = revision.current;
    loads.push(data);
    setState(prev => ({ ...prev, loading: true }));
    const opened = await step('load', () => {
      if (own !== revision.current) return null;
      // A load can also be replaced inside the engine (for example by a controller action).
      if (nextResult === null) window.history.replaceState(null, '', '/play?pack=Replacement');
      return nextResult;
    });
    if (opened === true) setState(prev => ({ ...prev, loaded: true, loading: false, unipack: pack(data) }));
    else if (opened === false) setState(prev => ({ ...prev, loading: false }));
    return opened;
  }, [unload]);
  const loadTheme = React.useCallback(async (data, isCurrent = () => true) => {
    await step('themeLoad', noop);
    if (isCurrent()) themes.push(data);
  }, []);
  const resumeAudio = React.useCallback(() => step('resume', noop), []);
  engine = { state, unload, onQuit: engine?.onQuit };
  return { state, loadUniPack, unload, loadTheme, resumeAudio, setMidiProfile: noop, setKeyboardBlocked: noop,
    setMidiUiContext: context => { engine.onQuit = context.onQuit; } };
}
stub('./useUniPadEngine.ts', { useUniPadEngine: useTestEngine });
const { PlayPage } = require('./PlayPage.tsx');
const flush = async action => act(async () => { await action?.(); });
async function mount(url = '/play', prepare = noop) {
  library = new Map([['A', pack('A')], ['B', pack('B')]]);
  held = {}; storage = new Map(); loads = []; loadOverrides = []; themes = []; nextResult = true; engine = null; main = null;
  prepare();
  window.history.replaceState(null, '', url);
  const view = render(React.createElement(PlayPage));
  await flush();
  return view;
}
afterEach(cleanup);
const currentUrlPack = () => new URL(window.location.href).searchParams.get('pack');

for (const phase of ['resume', 'read', 'recent']) {
  for (const leave of ['quit', 'unmount']) {
    test(`${leave} during ${phase} prevents a later engine load`, async () => {
      const view = await mount();
      const waiting = hold(phase);
      let opening;
      await flush(() => { opening = main.onPlay('A'); return waiting.entered.promise; });
      await flush(() => leave === 'quit' ? engine.onQuit() : view.unmount());
      await flush(() => { waiting.resolve(); return opening; });
      assert.deepEqual(loads, []);
      assert.equal(await opening, null);
      assert.equal(currentUrlPack(), null);
      assert.equal(storage.has('lastUniPackId'), false);
    });
  }
}

test('a saved open passes its stored autoPlay to the player', async () => {
  await mount();
  await flush(() => main.onPlay('B'));
  assert.deepEqual(loadOverrides, [savedAutoPlay]);
});

test('requests that finish reading in reverse order keep the last requested pack and its record', async () => {
  await mount();
  const waiting = hold('read');
  let first;
  await flush(() => { first = main.onPlay('A'); return waiting.entered.promise; });
  await flush(() => main.onPlay('B'));
  await flush(() => { waiting.resolve(); return first; });
  assert.equal(await first, null);
  assert.deepEqual(loads, ['B']);
  assert.equal(engine.state.unipack.id, 'B');
  assert.equal(currentUrlPack(), 'B');
  assert.equal(storage.get('lastUniPackId'), 'B');
  await flush(() => engine.onQuit());
  assert.equal(main.lastPlayedPackId, 'B');
});

for (const phase of ['themeSetting', 'themeRead', 'themeLoad']) {
  for (const leave of ['quit', 'replace']) {
    test(`${leave} during ${phase} leaves no old theme or address`, async () => {
      await mount(); storage.set('lastThemeId', 'skin');
      const waiting = hold(phase);
      let first;
      await flush(() => { first = main.onPlay('A'); return waiting.entered.promise; });
      await flush(() => leave === 'quit' ? engine.onQuit() : main.onPlay('B'));
      themes.length = 0;
      await flush(() => { waiting.resolve(); return first; });
      assert.equal(await first, null);
      assert.deepEqual(themes, []);
      assert.equal(currentUrlPack(), leave === 'quit' ? null : 'B');
    });
  }
}

test('a last-pack write that finishes late cannot overwrite the newer successful open', async () => {
  await mount();
  const writing = hold('lastWrite');
  let first, second;
  await flush(() => { first = main.onPlay('A'); return writing.entered.promise; });
  await flush(() => { second = main.onPlay('B'); });
  await flush(() => { writing.resolve(); return Promise.all([first, second]); });
  assert.equal(await first, null);
  assert.equal(await second, true);
  assert.equal(storage.get('lastUniPackId'), 'B');
  assert.equal(currentUrlPack(), 'B');
});

test('the title and current-pack record follow the latest request while it decodes', async () => {
  const view = await mount();
  const reading = hold('read');
  let first, second;
  await flush(() => { first = main.onPlay('A'); return reading.entered.promise; });
  const decoding = hold('load');
  await flush(() => { second = main.onPlay('B'); return decoding.entered.promise; });
  await flush(() => { reading.resolve(); return first; });
  assert.ok(view.queryByText('B'));
  assert.equal(view.queryByText('A'), null);
  await flush(() => { decoding.resolve(); return second; });
  await flush(() => engine.onQuit());
  assert.equal(main.lastPlayedPackId, 'B');
});

test('a replaced URL restoration does not erase the newer address', async () => {
  let waiting;
  await mount('/play?pack=A', () => { waiting = hold('load'); });
  await flush(() => waiting.entered.promise);
  await flush(() => main.onPlay('B'));
  await flush(() => { waiting.resolve(); });
  assert.equal(currentUrlPack(), 'B');
});

test('an imported pack replaced during decoding is saved without erasing the newer address', async () => {
  const view = await mount();
  const waiting = hold('load');
  await flush(() => {
    fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [{ arrayBuffer: async () => new ArrayBuffer(0) }] } });
    return waiting.entered.promise;
  });
  await flush(() => main.onPlay('B'));
  await flush(() => { waiting.resolve(); });
  assert.equal(currentUrlPack(), 'B');
  assert.equal(storage.get('lastUniPackId'), 'B');
});

test('a failed saved open clears the address', async () => {
  await mount(); nextResult = false;
  let result;
  await flush(async () => { result = await main.onPlay('A'); });
  assert.equal(result, false);
  assert.equal(currentUrlPack(), null);
});


test('a new request cancels decoding before its own storage read finishes', async () => {
  await mount();
  const decoding = hold('load');
  let first, second;
  await flush(() => { first = main.onPlay('A'); return decoding.entered.promise; });
  const reading = hold('read');
  await flush(() => { second = main.onPlay('B'); return reading.entered.promise; });
  await flush(() => { decoding.resolve(); return first; });
  assert.equal(await first, null);
  assert.equal(engine.state.loaded, false);
  assert.equal(currentUrlPack(), null);
  await flush(() => { reading.resolve(); return second; });
  assert.equal(engine.state.unipack.id, 'B');
});

test('a failed old URL read cannot clear the newer pack address', async () => {
  let reading;
  await mount('/play?pack=A', () => { reading = hold('read'); });
  await flush(() => reading.entered.promise);
  await flush(() => main.onPlay('B'));
  await flush(() => { reading.reject(new Error('Storage read failed')); });
  assert.equal(currentUrlPack(), 'B');
});

test('a last-pack write stays ordered across page unmount and remount', async () => {
  const view = await mount();
  const writing = hold('lastWrite');
  let first, second;
  await flush(() => { first = main.onPlay('A'); return writing.entered.promise; });
  view.unmount();
  render(React.createElement(PlayPage));
  await flush();
  await flush(() => { second = main.onPlay('B'); });
  await flush(() => { writing.resolve(); return Promise.all([first, second]); });
  assert.equal(await first, null);
  assert.equal(storage.get('lastUniPackId'), 'B');
  assert.equal(currentUrlPack(), 'B');
});

for (const result of [null, false]) {
  for (const source of ['saved', 'import', 'restore']) {
    test(`${source} preserves a replacement on null and clears a failure on false: ${result}`, async () => {
      const view = await mount(source === 'restore' ? '/play?pack=A' : '/play', () => { nextResult = result; });
      if (source !== 'restore') {
        window.history.replaceState(null, '', '/play?pack=Previous');
        if (source === 'saved') await flush(() => main.onPlay('A'));
        else await flush(() => fireEvent.change(view.container.querySelector('input[type=file]'), {
          target: { files: [{ arrayBuffer: async () => new ArrayBuffer(0) }] },
        }));
      }
      assert.equal(currentUrlPack(), result === false ? null : 'Replacement');
    });
  }
}


for (const phase of ['resume', 'file', 'load', 'save']) {
  for (const action of ['quit', 'replace', 'leave']) {
    test(`an import interrupted during ${phase} by ${action} still reaches the saved list`, async () => {
      const view = await mount();
      const waiting = hold(phase);
      const file = { arrayBuffer: () => step('file', () => new ArrayBuffer(0)) };
      await flush(() => {
        fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [file] } });
        return waiting.entered.promise;
      });
      await flush(() => {
        if (action === 'leave') view.unmount();
        else if (action === 'quit') engine.onQuit();
        else return main.onPlay('B');
      });
      const previousLoads = [...loads];
      const previousWrites = new Map(storage);
      const previousThemes = [...themes];
      const previousUrl = window.location.href;
      await flush(() => { waiting.resolve(); });
      assert.ok(library.has('Imported'), 'the readable file is saved even when opening it was canceled');
      assert.deepEqual(loads, previousLoads, 'the canceled import starts no new player load');
      assert.deepEqual(storage, previousWrites, 'it does not replace the last pack or theme preferences');
      assert.deepEqual(themes, previousThemes);
      assert.equal(window.location.href, previousUrl);
      if (action === 'replace') {
        assert.equal(engine.state.unipack.id, 'B');
        // Reveal the page's already-refreshed list without running handleQuit's own list refresh.
        await flush(() => engine.unload());
        assert.ok(main.savedPacks.some(pack => pack.id === 'Imported'));
        await flush(() => engine.onQuit());
        assert.equal(main.lastPlayedPackId, 'B', 'the canceled import preserves the current pack used for saving autoPlay');
      } else if (action === 'leave') {
        render(React.createElement(PlayPage));
        await flush();
      }
      assert.ok(main.savedPacks.some(pack => pack.id === 'Imported'), 'the saved file appears without another list refresh');
    });
  }
}
