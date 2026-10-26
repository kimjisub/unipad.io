import type { Page } from '@playwright/test';

/** Observe real-clock transitions; optionally hold the loading exit for the regression test. */
export async function recordStoreTransitions(page: Page, pauseLoadingExit = false) {
  await page.addInitScript(({ pauseLoadingExit }) => {
    const events: object[] = [];
    Object.assign(window, { storeTransitions: events });
    const append = (event: object) => { if (events.length < 3000) events.push(event); };
    const stamp = () => ({ performance: performance.now(), timeline: document.timeline.currentTime, wall: Date.now() });
    const animate = Element.prototype.animate;
    let nextId = 0;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      const animation = animate.apply(this, args);
      // Hold only this native exit, keeping both clocks and request handling real.
      const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes();
      if (pauseLoadingExit && this.textContent?.trim() === 'Loading store...' && frames?.at(-1)?.opacity === '0') {
        queueMicrotask(() => animation.pause());
      }
      if (!this.closest('[role="dialog"]')) return animation;
      const id = ++nextId;
      const record = (event: string) => append({ ...stamp(), event, id,
        text: this.textContent?.slice(0, 160), startTime: animation.startTime,
        currentTime: animation.currentTime, playState: animation.playState,
        keyframes: (animation.effect as KeyframeEffect | null)?.getKeyframes(), timing: animation.effect?.getComputedTiming() });
      record('animate');
      animation.addEventListener('finish', () => record('finish'));
      animation.addEventListener('cancel', () => record('cancel'));
      return animation;
    };
    let previous = '';
    setInterval(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Store"]');
      if (!dialog) return;
      const reload = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Reload');
      const state = {
        loading: dialog.textContent?.includes('Loading store...'),
        error: dialog.textContent?.includes('Cannot connect to the store'),
        reloadDisabled: reload?.disabled,
        options: Array.from(dialog.querySelectorAll('[role="option"]')).map(option => option.textContent?.slice(0, 80)),
        animations: dialog.getAnimations({ subtree: true }).filter(a => (a.effect as KeyframeEffect | null)?.getKeyframes().some(k => 'opacity' in k)).map(a => ({
          startTime: a.startTime, currentTime: a.currentTime, playState: a.playState,
          text: (a.effect as KeyframeEffect).target?.textContent?.slice(0, 80),
        })),
      };
      // Infinite pad pulses advance every frame without changing the store state.
      // Preserve their current times in snapshots, but do not use them as change signals.
      const serialized = JSON.stringify(state, (key, value) => key === 'currentTime' ? undefined : value);
      if (previous !== serialized && events.length < 3000) {
        append({ ...stamp(), event: 'state', ...state });
        previous = serialized;
      }
    }, 50);
  }, { pauseLoadingExit });
}
