'use client';

import { useEffect, useRef } from 'react';

const INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
const ALIGNMENT_WINDOW_MS = 3000;

export function useHashSectionAlignment(pathname: string, locale: string) {
  const historyHref = useRef<string | undefined>(undefined);

  useEffect(() => {
    let stopAlignment: (() => void) | undefined;

    const startAlignment = () => {
      stopAlignment?.();
      // Browser history restores the reader's scroll position itself. Keep the
      // marker through hashchange, which can follow popstate for the same entry.
      if (historyHref.current === window.location.href) return;
      historyHref.current = undefined;
      const hash = window.location.hash;
      if (!hash) return;

      let stopped = false;
      let frame: number | undefined;
      let deadline: number | undefined;
      let observer: ResizeObserver | undefined;

      const stop = () => {
        stopped = true;
        observer?.disconnect();
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        if (deadline !== undefined) window.clearTimeout(deadline);
        window.removeEventListener('load', onLoad);
        window.removeEventListener('pagehide', stop);
        for (const event of INPUT_EVENTS) window.removeEventListener(event, stop, true);
      };

      const queueAlignment = () => {
        if (stopped || frame !== undefined) return;
        frame = window.requestAnimationFrame(() => {
          frame = undefined;
          if (stopped) return;
          if (window.location.hash !== hash) { stop(); return; }
          document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start', behavior: 'instant' });
        });
      };

      const onLoad = () => {
        // Bound the work from load, including any wait for fonts. This is a
        // cleanup deadline, never a delay before the first alignment.
        deadline = window.setTimeout(stop, ALIGNMENT_WINDOW_MS);
        void document.fonts.ready.then(() => {
          if (stopped) return;
          observer = new ResizeObserver(queueAlignment);
          // The content can resize after fonts.ready, particularly WebKit tables.
          // Observing content instead of the viewport also catches a shrinking page.
          observer.observe(document.querySelector('main') ?? document.body);
          queueAlignment();
        });
      };

      stopAlignment = stop;
      for (const event of INPUT_EVENTS) window.addEventListener(event, stop, { capture: true, passive: true });
      window.addEventListener('pagehide', stop);
      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });
    };

    const onHistoryNavigation = () => {
      historyHref.current = window.location.href;
      stopAlignment?.();
    };

    startAlignment();
    // Run before the router can synchronously render and replace this effect.
    window.addEventListener('popstate', onHistoryNavigation, true);
    window.addEventListener('hashchange', startAlignment);
    return () => {
      stopAlignment?.();
      window.removeEventListener('popstate', onHistoryNavigation, true);
      window.removeEventListener('hashchange', startAlignment);
    };
  }, [pathname, locale]);
}
