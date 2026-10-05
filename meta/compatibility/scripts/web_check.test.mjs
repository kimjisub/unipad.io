import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { checksOf } from './web_rules.mjs';

// Exercise the CLI's actual observation and profile code without its setup or a browser launch.
const source = fs.readFileSync(new URL('./web_check.mjs', import.meta.url), 'utf8');
const sweepCode = source.slice(source.indexOf('async function findSoundingPad('), source.indexOf('async function runProfile('));
const profileCode = source.slice(source.indexOf('async function runProfile('), source.indexOf('\n{\n  fs.mkdirSync'));

function harness({ size = 2, sounding = null, lights = {}, firstStarts = 0 } = {}) {
  const ids = Array.from({ length: size * size }, (_, n) => `${n % size},${Math.floor(n / size)}`);
  const presses = [];
  let starts = firstStarts;
  let viewport = [1280, 800];
  const page = {
    locator: (selector) => {
      if (selector === '[data-pad]') return { evaluateAll: (fn) => fn(ids.map(id => ({ getAttribute: () => id }))) };
      return { first: () => ({ setInputFiles: async () => {} }) };
    },
    on() {}, route: async () => {}, goto: async () => {}, waitForSelector: async () => {},
    waitForTimeout: async () => {}, setViewportSize: async ({ width, height }) => { viewport = [width, height]; },
  };
  const ctx = {
    checksOf, BASE: 'http://localhost:3688', LOCALE: 'en', PACK: 'pack.zip', SCREENSHOTS: false,
    AUDIO_PROBE: () => {},
    readAudio: async () => ({ starts, state: 'running' }),
    readPads: async () => ({ pads: ids.length, lit: 0 }),
    hintVisible: async () => viewport[1] > viewport[0],
    pressPad: async (_page, _cdp, input, id) => {
      assert.ok(ids.includes(id), `pad ${id} not visible`);
      presses.push({ input, id, viewport });
      if (viewport[0] > viewport[1] && id === sounding) starts++;
      return { lit: viewport[0] > viewport[1] ? (lights[id] ?? 0) : 0 };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(sweepCode + profileCode, ctx);
  const browser = { newContext: async ({ viewport: v }) => {
    viewport = [v.width, v.height];
    return { addInitScript: async () => {}, newPage: async () => page, newCDPSession: async () => ({}), close: async () => {} };
  } };
  return { ctx, page, browser, presses };
}

for (const input of ['mouse', 'touch']) {
  for (const size of [2, 10]) {
    test(`${input} finds a sound on the last pad of a ${size}x${size} pack`, async () => {
      const id = `${size - 1},${size - 1}`;
      const h = harness({ size, sounding: id, lights: { [id]: 1 } });
      const found = await h.ctx.findSoundingPad(h.page, null, input);
      assert.equal(found?.padId, id);
      assert.equal(found.tried, size * size);
      assert.equal(h.presses.length, size * size);
      assert.ok(h.presses.every(p => p.input === input));
    });
  }
  test(`${input} retains light-only observations and does not count earlier sound starts`, async () => {
    const h = harness({ size: 8, lights: { '0,1': 4 }, firstStarts: 3 });
    const result = await h.ctx.runProfile(h.browser, { id: 'test', first: [1280, 800], input }, new Set(), [], []);
    assert.equal(result.steps.padPress.litWhileHeld, 4);
    assert.equal(result.checks.led, true);
    assert.equal(result.checks.sound, false);
  });
  test(`${input} keeps lights from a silent pad when another pad sounds`, async () => {
    const h = harness({ sounding: '0,0', lights: { '1,1': 4 } });
    const result = await h.ctx.runProfile(h.browser, { id: 'test', first: [1280, 800], input }, new Set(), [], []);
    assert.equal(result.checks.sound, true);
    assert.equal(result.checks.led, true);
    assert.equal(result.steps.padPress.litWhileHeld, 4);
  });
}

test('touch rotation keeps light-only observations after a covered portrait layout', async () => {
  const h = harness({ lights: { '0,1': 4 } });
  const result = await h.ctx.runProfile(h.browser, { id: 'rotate', first: [390, 844], rotated: [844, 390], input: 'touch' }, new Set(), [], []);
  assert.equal(result.steps.rotate.litWhileHeldAfterRotate, 4);
  assert.equal(result.checks.led, true);
  assert.equal(result.checks.sound, false);
  assert.equal(result.checks.rotation, true);
});

test('touch rotation still finds sound and independent lights on a large pack', async () => {
  const h = harness({ size: 10, sounding: '9,9', lights: { '0,0': 2 } });
  const result = await h.ctx.runProfile(h.browser, { id: 'rotate', first: [390, 844], rotated: [844, 390], input: 'touch' }, new Set(), [], []);
  assert.equal(result.steps.rotate.padIdAfterRotate, '9,9');
  assert.equal(result.checks.sound, true);
  assert.equal(result.checks.led, true);
  assert.equal(result.checks.rotation, true);
});

test('no sound and no held lights fail independently', async () => {
  const h = harness({ size: 8 });
  const result = await h.ctx.runProfile(h.browser, { id: 'silent', first: [1280, 800], input: 'mouse' }, new Set(), [], []);
  assert.equal(result.checks.sound, false);
  assert.equal(result.checks.led, false);
  assert.equal(result.steps.padPress.soundStarts, 0);
});

for (const input of ['mouse', 'touch']) {
  test(`${input} reads lights while held and then releases the pad`, async () => {
    let held = false;
    const events = [];
    const ctx = { readPads: async () => { assert.equal(held, true); events.push('read'); return { lit: 4 }; } };
    vm.createContext(ctx);
    vm.runInContext(source.slice(source.indexOf('async function pressPad('), source.indexOf('/** Sweeps')), ctx);
    const page = {
      locator: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 20, height: 20 }) }),
      mouse: { move: async () => {}, down: async () => { held = true; events.push('down'); },
        up: async () => { held = false; events.push('up'); } },
      waitForTimeout: async () => {},
    };
    const cdp = { send: async (_method, event) => {
      held = event.type === 'touchStart'; events.push(held ? 'down' : 'up');
    } };
    assert.equal((await ctx.pressPad(page, cdp, input, '0,0')).lit, 4);
    assert.equal(held, false);
    assert.deepEqual(events, ['down', 'read', 'up']);
  });
}
