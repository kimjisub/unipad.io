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

/**
 * A page expression that is true once `target` exists and neither it nor any ancestor has a CSS
 * or Web Animations animation running or waiting to start, e.g. once a sliding menu has come to
 * rest. Movement driven by script frame by frame is not seen. Animations inside the target (a
 * spinner) do not count: they do not move the target itself.
 * @param {string} target
 */
export const settled = target => `(() => {
  const subject = ${target};
  if (!subject) return false;
  for (let p = subject; p; p = p.parentElement)
    if (p.getAnimations().some(a => a.pending || a.playState === 'running')) return false;
  return true;
})()`;

let recorded = 0;

/**
 * Fails with the report when the target is not reachable, after saving the report and a
 * screenshot (into `dir` when given) and re-reading the same target once without acting on it.
 * Neither saving nor the second reading changes the verdict. `reread` reads the target again;
 * pass the caller's own check when it judges more than `hitReport` (a clipping area, say), so
 * a target that is still clipped does not read as reachable after the screenshot.
 * @param {{ report: any, target: string, label: string, dir?: string,
 *   run: (expression: string) => Promise<any>,
 *   command: (method: string, params?: object) => Promise<any>,
 *   reread?: () => Promise<any> }} options
 */
export async function assertReachable({ report, target, label, dir, run, command, reread = () => run(hitReport(target)) }) {
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
    record.afterScreenshot = await reread();
  } catch (error) {
    record.afterScreenshot = `read failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (dir) await writeFile(join(dir, `${name}.json`), JSON.stringify(record, null, 2)).catch(() => {});
  const what = report.missing ? 'Target missing' : 'Target clipped or covered';
  throw new Error(`${what}: ${label}\n${JSON.stringify(record, null, 2)}`);
}
