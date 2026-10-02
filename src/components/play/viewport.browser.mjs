// Browser regression: run against an offline-configured local dev server and a
// Chrome debugging endpoint (the Android device must be lent by devices.py).
// CDP_URL=http://127.0.0.1:19390 PLAYER_URL=http://localhost:3190/play \
//   node src/components/play/viewport.browser.mjs
// MATRIX=1 also checks portrait, desktop and rotation back to landscape.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const endpoint = process.env.CDP_URL;
const url = process.env.PLAYER_URL;
assert.ok(endpoint && url, 'Provide CDP_URL and PLAYER_URL');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname), 'Use an isolated local test origin; this test clears its storage');
const pages = await fetch(`${endpoint}/json`).then(r => r.json());
const page = pages.find(p => p.type === 'page' && p.url.startsWith(new URL(url).origin));
assert.ok(page, 'Open the local player in Chrome first');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const zip = new JSZip();
zip.file('info', 'title=Viewport test\nproducerName=CI\nbuttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n');
zip.file('keySound', '');
zip.file('keyLED/1 1 1 1', 'on 1 1 5\ndelay 30\noff 1 1');
// Mode changes resync at the current event, so a single note followed by one
// delay can reach the end as soon as Step scans for its next note. Keep many
// pending notes (and more than the transport's 40-event skip) in this fixture.
zip.file('autoPlay', Array.from({length:64}, (_,i) =>
  `o ${i%8+1} ${Math.floor(i/8)+1}\nd 60000\nf ${i%8+1} ${Math.floor(i/8)+1}\nd 60000`
).join('\n'));
const pack = await zip.generateAsync({ type: 'base64' });
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = async e => {
  const message = JSON.parse(e.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.method === 'Fetch.requestPaused') {
    // Only the local download proxy is intercepted. No live pack or store is used.
    await command('Fetch.fulfillRequest', {
      requestId: message.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/zip' }], body: pack,
    });
  }
};
const run = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async expression => {
  for (let i = 0; i < 60; i++) { if (await run(expression)) return; await wait(250); }
  throw new Error(`Timed out: ${expression}`);
};
// Require a real hit target after scrolling, rather than a programmatic click on
// an invisible/clipped button. This catches both overflow and covering overlays.
const tap = async expression => {
  const point = await run(`(() => {
    const e = ${expression}; if (!e) throw Error('Target missing');
    // Scroll only areas the user can scroll. scrollIntoView would also scroll
    // overflow:hidden ancestors and conceal the original store clipping bug.
    for (let parent=e.parentElement; parent; parent=parent.parentElement) {
      if (!['auto','scroll'].includes(getComputedStyle(parent).overflowY)) continue;
      const r=e.getBoundingClientRect(), bounds=parent.getBoundingClientRect();
      if (r.bottom>bounds.bottom) parent.scrollTop+=r.bottom-bounds.bottom;
      if (r.top<bounds.top) parent.scrollTop-=bounds.top-r.top;
    }
    const r=e.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    if (!hit || !(e===hit || e.contains(hit))) throw Error('Target clipped or covered: '+e.textContent);
    return {x,y};
  })()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
};
const button = label => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const snapshot = async name => {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, {recursive:true});
  const result=await command('Page.captureScreenshot', {format:'png'});
  await writeFile(join(process.env.SCREENSHOT_DIR, `${name}.png`), Buffer.from(result.data,'base64'));
};
try {
  await command('Page.bringToFront');
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.setCookie', {name:'NEXT_LOCALE', value:'en', url:new URL(url).origin});
  // The fixture is silent and has no MIDI device; avoid native permission UI.
  await command('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'requestMIDIAccess', {value:undefined, configurable:true});" });
  await command('Fetch.enable', { patterns: [{ urlPattern: `${new URL(url).origin}/api/store/download*` }] });
  const scenarios = process.env.MATRIX ? [[800,300], [390,844], [1280,800], [800,300]] : [null];
  let scenarioIndex = 0;
  for (const size of scenarios) {
    if (size) {
      await command('Emulation.setDeviceMetricsOverride', { width:size[0], height:size[1], deviceScaleFactor:1, mobile:true });
      await wait(600);
    }
    await command('Storage.clearDataForOrigin', { origin:new URL(url).origin, storageTypes:'indexeddb,local_storage' });
    await command('Page.navigate', { url });
    await until(`!!document.querySelector('input[accept=".zip,.uni"]')`);
    await run(`localStorage.setItem('store_items_cache_v1', JSON.stringify(Array.from({length:12},(_,i)=>({
      code:'viewport-'+i,title:'Local pack '+i,producerName:'CI',isLED:true,isAutoPlay:true,downloadCount:12-i
    })))); sessionStorage.removeItem('store_ui_pref_v1');`);
    await run(`(() => {
      const data=Uint8Array.from(atob(${JSON.stringify(pack)}),c=>c.charCodeAt(0));
      const dt=new DataTransfer(); dt.items.add(new File([data],'viewport.zip',{type:'application/zip'}));
      const input=document.querySelector('input[accept=".zip,.uni"]'); input.files=dt.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await until(`document.querySelectorAll('[data-pad]').length===64`);
    await wait(600);
    const geometry = await run(`(() => {
      const pads=[...document.querySelectorAll('[data-pad]')];
      const fits=pads.every(e=>{const r=e.getBoundingClientRect();return r.top>=0 && r.left>=0 && r.bottom<=innerHeight+1 && r.right<=innerWidth+1});
      return {fits,count:pads.length,width:innerWidth,height:innerHeight,last:pads.at(-1).getBoundingClientRect().toJSON()};
    })()`);
    console.log('Pad geometry', JSON.stringify(geometry));
    await snapshot(`play-${scenarioIndex}`);
    assert.equal(geometry.fits, true, 'All 64 pads, including the last row, fit the visible viewport');
    // The existing portrait rotation prompt is intentional; returning to
    // landscape must restore every pad. Store can still be checked from the menu.
    const portrait = size && size[0] < 768 && size[0] < size[1];
    if (portrait) {
      assert.equal(await run(`document.body.textContent.includes('Rotate to landscape')`), true, 'Existing portrait rotation prompt remains');
      await command('Page.navigate', { url });
      await until(`!!document.querySelector('input[accept=".zip,.uni"]') && !document.querySelector('[data-pad]')`);
    } else {
      for (let i=0;i<64;i++) await tap(`document.querySelectorAll('[data-pad]')[${i}]`);
      for (const label of ['Feedback', 'LED', 'Trace', 'Rec']) {
        await tap(button(label)); await tap(button(label));
      }
      for (const label of ['Guide', 'Step', 'Auto']) {
        await tap(button(label));
        await until(`${button(label)}?.getAttribute('aria-pressed')==='true'`);
        const transport = label === 'Step' ? 'Play' : 'Pause';
        await until(`!!document.querySelector('button[aria-label="${transport}"]')`);
        console.log('Mode confirmed:', label, transport);
      }
      const progress = `Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'))`;
      // A selected mode can render before its timer processes the first note.
      await until(`${progress} > 0`);
      await tap(`document.querySelector('button[aria-label="Pause"]')`);
      await until(`!!document.querySelector('button[aria-label="Play"]')`);
      await tap(`document.querySelector('button[aria-label="Play"]')`);
      await until(`!!document.querySelector('button[aria-label="Pause"]')`);
      // Pause before seeking so progress assertions cannot race playback ticks.
      await tap(`document.querySelector('button[aria-label="Pause"]')`);
      await until(`!!document.querySelector('button[aria-label="Play"]')`);
      const beforePrevious = await run(progress);
      assert.ok(beforePrevious > 0, 'Playback has advanced before seeking');
      await tap(`document.querySelector('button[aria-label="Skip to previous"]')`);
      await until(`${progress} < ${beforePrevious}`);
      const beforeNext = await run(progress);
      await tap(`document.querySelector('button[aria-label="Skip to next"]')`);
      await until(`${progress} > ${beforeNext}`);
      console.log('Transport confirmed: pause, resume, previous and next');
      await wait(300);
      await tap(`document.querySelector('button[aria-label="Open menu"]')`);
      await until(`!!document.querySelector('[role="dialog"]')`);
      await wait(400);
      await tap(button('Quit'));
      await until(`!document.querySelector('[data-pad]')`);
    }
    await tap(button('Store'));
    await until(`document.querySelectorAll('[data-store-code]').length===12`);
    await tap(`document.querySelector('[data-store-code="viewport-11"]')`);
    await wait(400);
    await tap(`document.querySelector('[role="dialog"] h3')`);
    await snapshot(`detail-${scenarioIndex}`);
    await tap(`document.querySelector('[data-store-code="viewport-11"]')`);
    await snapshot(`store-${scenarioIndex}`);
    await tap(`document.querySelector('[data-store-code="viewport-11"] button:last-child')`);
    await until(`document.querySelector('[data-store-code="viewport-11"]')?.textContent.includes('Play')`);
    await tap(button('Close'));
    await until(`!document.querySelector('[role="dialog"]')`);
    await tap(button('Store'));
    await until(`document.querySelector('[data-store-code="viewport-11"]')?.textContent.includes('Play')`);
    await tap(`document.querySelector('[data-store-code="viewport-11"] button:last-child')`);
    await until(`document.querySelectorAll('[data-pad]').length===64`);
    console.log('PASS:', portrait ? 'portrait prompt and store' : '64 pad presses, controls and menu', 'store last item, detail, local download and close', size || 'native viewport');
    scenarioIndex++;
  }
} finally {
  await command('Fetch.disable');
  if (process.env.MATRIX) await command('Emulation.clearDeviceMetricsOverride');
  ws.close();
}
