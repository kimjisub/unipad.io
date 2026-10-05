// Independent CDP regression; no e2e fixtures, Playwright or application hooks.
// Open PLAYER_URL in a Chrome instance with remote debugging first, then run:
// CDP_URL=http://localhost:9222 PLAYER_URL=http://localhost:3000/play \
// SCREENSHOT_DIR=/path/to/evidence node src/components/play/mainScreenViewport.browser.mjs
// Uses only the existing jszip dependency and Node's native WebSocket.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const endpoint = process.env.CDP_URL;
const url = process.env.PLAYER_URL;
assert.ok(endpoint && url, 'Provide CDP_URL and PLAYER_URL');
const origin = new URL(url).origin;
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Use a local test origin: its storage is cleared');
const pages = await fetch(`${endpoint}/json`).then(r => r.json());
const page = pages.find(p => p.type === 'page' && p.url.startsWith(origin));
assert.ok(page, 'Open the local player in Chrome first');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = e => {
  const message = JSON.parse(e.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(message.id);
  if (message.error) request.reject(Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
};
const run = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async expression => {
  for (let i = 0; i < 60; i++) {
    if (await run(expression)) return;
    await wait(100);
  }
  throw Error(`Timed out: ${expression}`);
};
const button = label => `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)})`;
const detail = `document.querySelector('button[aria-label="Add bookmark"],button[aria-label="Remove bookmark"]')?.parentElement.parentElement`;
const row = `document.querySelector('[data-pack-id]')`;
const snapshot = async name => {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  const { data } = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(process.env.SCREENSHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
};
// Read geometry and hit targets without scrolling. A whole control must fit
// both the viewport and every clipping ancestor before any mouse click.
const geometry = expression => run(`(() => {
  const e = ${expression}; if (!e) return { reachable: false, missing: true };
  const r = e.getBoundingClientRect();
  let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
  for (let p = e.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p), b = p.getBoundingClientRect();
    if (s.overflowY !== 'visible') { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    if (s.overflowX !== 'visible') { left = Math.max(left, b.left); right = Math.min(right, b.right); }
  }
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { reachable: r.width > 0 && r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1 && r.left >= left - 1 && r.right <= right + 1 && !!hit && (e === hit || e.contains(hit)), rect: r.toJSON(), x, y };
})()`);
// Only real wheel input at the nearest user-scrollable area is allowed.
// Never use click(), force, focus(), scrollIntoView or scroll hidden ancestors.
const reach = async expression => {
  for (let i = 0; i < 12; i++) {
    const g = await geometry(expression);
    if (g.reachable) return g;
    const scroll = await run(`(() => {
      const e = ${expression}; if (!e) return null;
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (!['auto','scroll'].includes(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight) continue;
        const b = p.getBoundingClientRect(), r = e.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: Math.max(1, Math.min(innerHeight - 1, b.top + b.height / 2)), deltaY: r.top < b.top ? -100 : 100 };
      }
      return null;
    })()`);
    if (!scroll) { await wait(120); continue; }
    await command('Input.dispatchMouseEvent', { type: 'mouseWheel', deltaX: 0, ...scroll });
    await wait(120);
  }
  const g = await geometry(expression);
  assert.equal(g.reachable, true, `Target clipped or covered: ${expression} ${JSON.stringify(g)}`);
  return g;
};
const tap = async expression => {
  const { x, y } = await reach(expression);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await wait(250);
};
const key = async (key, code, virtualKey) => {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
  await wait(200);
};
const quit = async () => {
  await until(`document.querySelectorAll('[data-pad]').length === 64 && location.search.includes('pack=')`);
  if (await run(`innerWidth < 768 && innerWidth < innerHeight`)) {
    assert.equal(await run(`document.body.textContent.includes('Rotate to landscape')`), true, 'Existing portrait rotation prompt remains');
    await command('Page.navigate', { url });
    await until(`!!${row} && !document.querySelector('[data-pad]')`);
    return;
  }
  await tap(`document.querySelector('button[aria-label="Open menu"]')`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  await tap(button('Quit'));
  await until(`!!${row} && !document.querySelector('[data-pad]')`);
};
const zip = new JSZip();
zip.file('info', 'title=Viewport test\nproducerName=CI\nbuttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n');
zip.file('keySound', '');
zip.file('keyLED/1 1 1 1', 'o 1 1 a 5\nd 30\nf 1 1');
zip.file('autoPlay', 'd 60000\no 1 1\nd 60000\nf 1 1');
const pack = await zip.generateAsync({ type: 'base64' });
try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.setCookie', { name: 'NEXT_LOCALE', value: 'en', url: origin });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'requestMIDIAccess', {value:undefined, configurable:true});" });
  await command('Emulation.setDeviceMetricsOverride', { width: 800, height: 300, deviceScaleFactor: 1, mobile: false });
  await command('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb,local_storage' });
  await command('Page.navigate', { url });
  await until(`!!document.querySelector('input[accept=".zip,.uni"]')`);
  // Populate the native file input; every interaction after import is real input.
  await run(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(pack)}), c => c.charCodeAt(0))], 'viewport.uni'));
    const input = document.querySelector('input[accept=".zip,.uni"]'); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await quit();
  if (await run(`${row}?.getAttribute('aria-pressed') === 'true'`)) await tap(`${row}.querySelector('div.flex-1')`);
  await tap(`${row}.querySelector('div.flex-1')`);
  await until(`!!${detail}`);
  await snapshot('home-selected-initial');
  console.log('Initial detail play geometry', JSON.stringify(await geometry(`${detail}.querySelector('button.group')`)));
  let scenario = 0;
  for (const [width, height] of [[800, 300], [390, 844], [1280, 800], [800, 300]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(300);
    await reach(`${detail}.querySelector('.text-lg')`);
    await reach(`${detail}.querySelector('.text-xs')`);
    await tap(`${detail}.querySelector('button[aria-label="Add bookmark"]')`);
    await until(`!!document.querySelector('button[aria-label="Remove bookmark"]')`);
    await tap(`${detail}.querySelector('button[aria-label="Remove bookmark"]')`);
    await until(`!!document.querySelector('button[aria-label="Add bookmark"]')`);
    await snapshot(`home-${scenario}-title`);
    await reach(`${detail}.querySelector('button.group')`);
    await snapshot(`home-${scenario}-play`);
    await tap(`${detail}.querySelector('button[aria-label="Delete UniPack"]')`);
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    await tap(button('Cancel'));
    await tap(`${detail}.querySelector('button.group')`);
    await quit();
    await tap(`${row}.querySelector('button')`);
    await quit();
    // Deselect with pointer, select and play with the application's arrow/Enter
    // shortcuts. No test-side focus/scroll is used to make the details accessible.
    await tap(`${row}.querySelector('div.flex-1')`);
    await until(`!${detail}`);
    await key('ArrowDown', 'ArrowDown', 40);
    await until(`${row}?.getAttribute('aria-pressed') === 'true' && !!${detail}`);
    await key('Enter', 'Enter', 13);
    await quit();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(`PASS ${width}x${height}: title, producer, bookmark, delete/cancel, detail play, list play, keyboard select/play`);
    scenario++;
  }
} finally {
  await snapshot('home-final');
  await command('Emulation.clearDeviceMetricsOverride');
  ws.close();
}
