#!/usr/bin/env node
/**
 * Opens the web player served by a local `next start` in headless Chromium, imports an existing pack,
 * and records pad input, sound starts, lit pads (LED) and rotation (flipping the viewport) per profile.
 *
 * What a pass means: the Chromium build that ships with Playwright, headless, on this computer. It is not
 * Google Chrome, not another operating system and not a phone or tablet: the tablet and phone profiles only
 * change the window size and send touch events. Chromium is the only engine this script can drive, because
 * held touches go through the Chrome DevTools Protocol; it cannot run Firefox or WebKit.
 *
 * Every request that leaves the local server, and the analytics scripts served by it, is aborted; the
 * aborted targets are listed in the result.
 *
 * Usage: PLAYWRIGHT_MODULE=<dir of an installed playwright package> \
 *        node web_check.mjs <BASE_URL> <PACK.zip> <OUT_DIR> [locale] [--no-screenshots]
 * Exit:  0 every profile ran and passed its checks, 1 a profile failed or threw, 2 bad usage or setup.
 * Playwright is not a dependency of this repository; ../README.md says how to get one outside it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [BASE, PACK, OUT, LOCALE = 'en'] = args.filter((a) => !a.startsWith('--'));
const SCREENSHOTS = !flags.has('--no-screenshots');

function stop(message) {
  console.error(message);
  process.exit(2);
}

if (!BASE || !PACK || !OUT) stop('usage: web_check.mjs <BASE_URL> <PACK.zip> <OUT_DIR> [locale] [--no-screenshots]');
if (!fs.existsSync(PACK)) stop(`pack not found: ${PACK}`);

const playwrightDir = process.env.PLAYWRIGHT_MODULE;
if (!playwrightDir || !fs.existsSync(path.join(playwrightDir, 'package.json'))) {
  stop('PLAYWRIGHT_MODULE must name the directory of an installed playwright package (see meta/compatibility/README.md, "Browser check").');
}
const playwrightVersion = JSON.parse(fs.readFileSync(path.join(playwrightDir, 'package.json'), 'utf8')).version;
const { chromium } = await import(pathToFileURL(path.join(playwrightDir, 'index.mjs')).href);

/** The rotate hint is found by the text the site shows in this locale, read from the site's own messages. */
function findMessage(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node[key] === 'string') return node[key];
  for (const child of Object.values(node)) {
    const found = findMessage(child, key);
    if (found) return found;
  }
  return null;
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const messagesFile = path.join(repoRoot, 'src/i18n/messages', `${LOCALE}.json`);
if (!fs.existsSync(messagesFile)) stop(`no messages for locale "${LOCALE}" (${messagesFile})`);
const ROTATE_HINT = findMessage(JSON.parse(fs.readFileSync(messagesFile, 'utf8')), 'rotateToLandscape');
if (!ROTATE_HINT) stop(`locale "${LOCALE}" has no rotateToLandscape message`);

/** Viewport profiles; touch profiles send pointer input as touch events. */
const PROFILES = [
  { id: 'desktop-1280x800', kind: 'desktop', input: 'mouse', first: [1280, 800], rotated: null },
  { id: 'tablet-1024x768', kind: 'tablet-width', input: 'touch', first: [1024, 768], rotated: [768, 1024] },
  { id: 'tablet-834x1194', kind: 'tablet-width', input: 'touch', first: [834, 1194], rotated: [1194, 834] },
  { id: 'phone-390x844', kind: 'phone-width', input: 'touch', first: [390, 844], rotated: [844, 390] },
];

/** In-page hook that counts decoded buffers and sound starts. */
const AUDIO_PROBE = () => {
  const w = window;
  w.__audio = { contexts: 0, decoded: 0, starts: 0, states: [] };
  const Ctx = w.AudioContext || w.webkitAudioContext;
  if (Ctx) {
    const wrapped = function (...args) {
      const ctx = new Ctx(...args);
      w.__audio.contexts += 1;
      w.__audio.last = ctx;
      return ctx;
    };
    wrapped.prototype = Ctx.prototype;
    w.AudioContext = wrapped;
  }
  const decode = w.BaseAudioContext && w.BaseAudioContext.prototype.decodeAudioData;
  if (decode) {
    w.BaseAudioContext.prototype.decodeAudioData = function (...args) {
      w.__audio.decoded += 1;
      return decode.apply(this, args);
    };
  }
  const start = w.AudioBufferSourceNode && w.AudioBufferSourceNode.prototype.start;
  if (start) {
    w.AudioBufferSourceNode.prototype.start = function (...args) {
      w.__audio.starts += 1;
      return start.apply(this, args);
    };
  }
};

const readAudio = (page) =>
  page.evaluate(() => ({
    contexts: window.__audio.contexts,
    decoded: window.__audio.decoded,
    starts: window.__audio.starts,
    state: window.__audio.last ? window.__audio.last.state : null,
  }));

/** Number of pads with a colour overlay (LED on) and whether the whole pad grid lies inside the viewport. */
const readPads = (page) =>
  page.evaluate(() => {
    const pads = [...document.querySelectorAll('[data-pad]')];
    const lit = pads.filter((p) => p.querySelector(':scope > .z-10')).length;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rects = pads.map((p) => p.getBoundingClientRect());
    const inside = rects.every((r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5);
    const minSide = rects.length ? Math.min(...rects.map((r) => Math.min(r.width, r.height))) : 0;
    return { pads: pads.length, lit, allInsideViewport: inside, minPadSidePx: Math.round(minSide * 10) / 10, viewport: [vw, vh] };
  });

const hintVisible = (page) => page.getByText(ROTATE_HINT, { exact: true }).isVisible().catch(() => false);

/**
 * Presses one pad, reads the LEDs while it is held, then releases. Touch goes through CDP touch events
 * because Playwright's tap cannot be measured while held.
 */
async function pressPad(page, cdp, input, padId, holdMs = 180) {
  const box = await page.locator(`[data-pad="${padId}"]`).boundingBox();
  if (!box) throw new Error(`pad ${padId} not visible`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (input === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await page.waitForTimeout(holdMs);
  const held = await readPads(page);
  if (input === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  return held;
}

/** Sweeps the grid until a pad starts a sound; a pack can have silent pads. */
async function findSoundingPad(page, cdp, input) {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const padId = `${x},${y}`;
      const before = (await readAudio(page)).starts;
      const held = await pressPad(page, cdp, input, padId);
      const after = await readAudio(page);
      if (after.starts > before) return { padId, tried: y * 8 + x + 1, held, audio: after };
    }
  }
  return null;
}

/**
 * What the recorded steps amount to, per feature. `null` means the profile does not exercise the feature.
 * Rotation passes when the rotate hint shows in portrait only and the pad grid is still there afterwards.
 */
function checksOf(profile, steps) {
  const press = steps.padPress ?? {};
  const rotate = steps.rotate;
  const portraitFirst = profile.first[1] > profile.first[0];
  return {
    open_pack: steps.packOpened.pads > 0,
    sound: (press.soundStarts ?? 0) > 0 || rotate?.pressedAfterRotate === true,
    led: (press.litWhileHeld ?? 0) > 0 || (rotate?.litWhileHeldAfterRotate ?? 0) > 0,
    rotation: rotate
      ? rotate.portraitHintVisibleBefore === portraitFirst &&
        rotate.portraitHintVisibleAfter === !portraitFirst &&
        rotate.padsAfter.pads === steps.packOpened.pads
      : null,
  };
}

async function runProfile(browser, profile, blocked, requests, errors) {
  const [w, h] = profile.first;
  const touch = profile.input === 'touch';
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
  });
  await ctx.addInitScript(AUDIO_PROBE);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${profile.id}] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`[${profile.id}] PAGEERROR ${String(e.message).slice(0, 200)}`));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url.slice(0, 160));
    const local = url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:');
    if (local && !url.includes('/_vercel/insights') && !url.includes('/_vercel/speed-insights')) return route.continue();
    blocked.add(url.startsWith('http') ? new URL(url).host + (local ? new URL(url).pathname : '') : url.slice(0, 20));
    return route.abort();
  });

  const result = { profile: profile.id, kind: profile.kind, input: profile.input, steps: {} };
  const shot = (name) => (SCREENSHOTS ? page.screenshot({ path: path.join(OUT, `${profile.id}-${name}.png`) }) : null);
  await page.goto(`${BASE}/${LOCALE}/play`, { waitUntil: 'networkidle' });
  await page.locator('input[type=file][accept=".zip,.uni"]').first().setInputFiles(PACK);
  await page.waitForSelector('[data-pad]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  result.steps.packOpened = await readPads(page);
  result.steps.audioAfterOpen = await readAudio(page);
  await shot('01-open');

  const cdp = await ctx.newCDPSession(page);
  const litIdle = (await readPads(page)).lit;
  const found = await findSoundingPad(page, cdp, profile.input);
  result.steps.padPress = found
    ? {
        input: profile.input,
        padId: found.padId,
        padsTried: found.tried,
        soundStarts: found.audio.starts,
        contextState: found.audio.state,
        litIdle,
        litWhileHeld: found.held.lit,
      }
    : { input: profile.input, padId: null, portraitHintVisible: await hintVisible(page), note: 'no pad produced a sound start in the first layout' };
  await shot('02-press');

  if (profile.rotated) {
    const hintFirst = await hintVisible(page);
    await page.setViewportSize({ width: profile.rotated[0], height: profile.rotated[1] });
    await page.waitForTimeout(800);
    const hintRotated = await hintVisible(page);
    const padsRotated = await readPads(page);
    // In portrait the rotate hint covers the pads and the first sweep fails; sweep again after rotating.
    const startsBefore = (await readAudio(page)).starts;
    const foundAfter = hintRotated ? null : (found
      ? { ...found, ...(await pressPad(page, cdp, profile.input, found.padId).then((held) => ({ held }), () => ({ held: null }))) }
      : await findSoundingPad(page, cdp, profile.input));
    const startsAfter = (await readAudio(page)).starts;
    const pressedAfterRotate = foundAfter ? startsAfter > startsBefore : null;
    result.steps.rotate = {
      from: profile.first,
      to: profile.rotated,
      portraitHintVisibleBefore: hintFirst,
      portraitHintVisibleAfter: hintRotated,
      padsAfter: padsRotated,
      pressedAfterRotate,
      padIdAfterRotate: foundAfter ? foundAfter.padId : null,
      litWhileHeldAfterRotate: foundAfter && foundAfter.held ? foundAfter.held.lit : null,
      soundStartsBefore: startsBefore,
      soundStartsAfter: startsAfter,
    };
    await shot('03-rotated');
  }
  await ctx.close();
  result.checks = checksOf(profile, result.steps);
  result.ok = Object.values(result.checks).every((value) => value !== false);
  return result;
}

{
  fs.mkdirSync(OUT, { recursive: true });
  const startedUtc = new Date().toISOString();
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const version = browser.version();
  const blocked = new Set();
  const requests = [];
  const errors = [];
  const results = [];
  for (const profile of PROFILES) {
    try {
      results.push(await runProfile(browser, profile, blocked, requests, errors));
    } catch (e) {
      results.push({ profile: profile.id, kind: profile.kind, ok: false, error: String(e.message).slice(0, 300) });
    }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).map((r) => r.profile);
  const summary = {
    base: BASE,
    pack: path.basename(PACK),
    locale: LOCALE,
    rotateHintText: ROTATE_HINT,
    startedUtc,
    browser: `Chromium ${version} headless (--mute-audio)`,
    playwright: playwrightVersion,
    host: { platform: os.platform(), release: os.release(), arch: os.arch() },
    scope: 'Playwright Chromium, headless, on this host only. Not Google Chrome, not another operating system. '
      + 'Tablet and phone profiles are mocked window sizes with touch events, not devices. Output is muted: sound is counted as starts, never heard.',
    blockedExternalOrAnalyticsHosts: [...blocked].sort(),
    requestCount: requests.length,
    consoleErrors: errors,
    failedProfiles: failed,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) {
    console.error(`FAILED profiles: ${failed.join(', ')}`);
    process.exit(1);
  }
}
