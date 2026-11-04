// Shared by the CDP browser regressions (viewport.browser.mjs, mainScreenViewport.browser.mjs).
// When a control cannot be hit at its centre, the failure keeps what is needed to tell overflow,
// a covering element and a target still moving apart, without reproducing the run.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A page expression for the element `target` (a page expression itself; it may name a variable
 * of the enclosing page code, but not `subject`) evaluating to its
 * centre, the topmost element there and the viewport. `reachable` is the only verdict: the
 * centre's topmost element is the target or inside it.
 * @param {string} target
 */
export const hitReport = target => `(() => {
  const describe = e => e && {
    tag: e.tagName.toLowerCase(),
    attributes: Object.fromEntries([...e.attributes].map(a => [a.name, a.value.slice(0, 160)])),
    text: (e.textContent || '').trim().slice(0, 80),
    rect: e.getBoundingClientRect().toJSON(),
  };
  const brief = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
    + [...e.attributes].filter(a => a.name === 'role' || a.name === 'aria-label' || a.name.startsWith('data-')).map(a => '[' + a.name + '=' + JSON.stringify(a.value.slice(0, 40)) + ']').join('');
  const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio,
    visual: visualViewport && { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } };
  const subject = ${target};
  if (!subject) return { reachable: false, missing: true, viewport };
  const r = subject.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  // Ancestors that are still being moved or faded, as an opening dialog is.
  const moving = [];
  for (let p = subject; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.transform !== 'none' || s.opacity !== '1') moving.push({ element: brief(p), transform: s.transform, opacity: s.opacity });
  }
  return {
    reachable: !!hit && (subject === hit || subject.contains(hit)),
    point: { x, y },
    target: describe(subject),
    hit: describe(hit),
    hitAncestors: hit ? (() => { const path = []; for (let p = hit.parentElement; p && path.length < 6; p = p.parentElement) path.push(brief(p)); return path; })() : [],
    stack: document.elementsFromPoint(x, y).slice(0, 8).map(brief),
    moving,
    animations: document.getAnimations().filter(a => a.playState === 'running').slice(0, 10)
      .map(a => ({ element: a.effect && a.effect.target ? brief(a.effect.target) : null, currentTime: a.currentTime })),
    viewport,
  };
})()`;

let recorded = 0;

/**
 * Fails with the report when the target is not reachable, after saving the report and a
 * screenshot (into `dir` when given) and re-reading the same target once without acting on it.
 * Neither saving nor the second reading changes the verdict.
 * @param {{ report: any, target: string, label: string, dir?: string,
 *   run: (expression: string) => Promise<any>,
 *   command: (method: string, params?: object) => Promise<any> }} options
 */
export async function assertReachable({ report, target, label, dir, run, command }) {
  if (report.reachable) return;
  const record = { label, at: new Date().toISOString(), report, screenshot: null, afterScreenshot: null };
  const name = `unreachable-${++recorded}`;
  try {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    if (dir) {
      await mkdir(dir, { recursive: true });
      record.screenshot = join(dir, `${name}.png`);
      await writeFile(record.screenshot, Buffer.from(data, 'base64'));
    } else record.screenshot = 'not saved: set SCREENSHOT_DIR';
  } catch (error) {
    record.screenshot = `capture failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    record.afterScreenshot = await run(hitReport(target));
  } catch (error) {
    record.afterScreenshot = `read failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (dir) await writeFile(join(dir, `${name}.json`), JSON.stringify(record, null, 2)).catch(() => {});
  const what = report.missing ? 'Target missing' : 'Target clipped or covered';
  throw new Error(`${what}: ${label}\n${JSON.stringify(record, null, 2)}`);
}

/**
 * A page expression that resolves true when `target` is at rest: neither it nor an ancestor is
 * faded or has an animation running or waiting to start, and it is at the same place in the
 * viewport at the start and the end of `ms` milliseconds.
 * A press is only whole when the target stays under the pointer from press to release; if it
 * moves away in between, the browser sends the click to whatever holds both points (a list row,
 * say), not to the target. Rows fading in and a list scrolling itself to a selection both move a
 * target with no input. The scroll is not an animation `getAnimations` reports, so the place is
 * read twice; the fade is required to have ended first because a busy page can hold every motion
 * back for longer than `ms`, before any of it starts.
 * @param {string} target
 * @param {number} [ms]
 */
export const still = (target, ms = 200) => `(async () => {
  const place = () => {
    const subject = ${target};
    if (!subject) return null;
    for (let p = subject; p; p = p.parentElement)
      if (getComputedStyle(p).opacity !== '1' || p.getAnimations().some(a => a.pending || a.playState === 'running')) return null;
    return JSON.stringify(subject.getBoundingClientRect());
  };
  const before = place();
  if (!before) return false;
  await new Promise(resolve => setTimeout(resolve, ${ms}));
  return place() === before;
})()`;
