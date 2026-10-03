'use client';

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import type { LaunchpadProfile } from '@/lib/unipack';

interface LaunchpadConnectionHelpProps {
  requestedProfile: LaunchpadProfile;
  modelLabel: string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

const MINI_GUIDE = 'https://userguides.novationmusic.com/hc/en-gb/articles/23731330721682-Launchpad-Mini-MK3-s-Settings-menu';

export function LaunchpadConnectionHelp({ requestedProfile, modelLabel, returnFocusRef, onClose }: LaunchpadConnectionHelpProps) {
  const t = useTranslations('play.launchpad.help');
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const mini = requestedProfile === 'launchpad_mini_mk3';
  const pro = requestedProfile === 'launchpad_pro' || requestedProfile === 'launchpad_pro_mk3';
  const other = !mini && !pro && !['launchpad_x', 'launchpad_s', 'launchpad_mk2'].includes(requestedProfile);

  const close = useCallback(() => {
    if (window.history.state?.connectionHelp === id) window.history.back();
    else onClose();
  }, [id, onClose]);

  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    // A same-URL entry lets browser Back dismiss only this help. Preserve Next's
    // existing history fields; no settings or device state is stored here.
    window.history.pushState({ ...window.history.state, connectionHelp: id }, '');
    closeRef.current?.focus({ preventScroll: true });
    const pop = () => onClose();
    const focus = (event: FocusEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) closeRef.current?.focus({ preventScroll: true });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === 'Tab') {
        const targets = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]') ?? []);
        const first = targets[0];
        const last = targets.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key, true);
    window.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('focusin', focus);
      if (window.history.state?.connectionHelp === id) window.history.back();
      returnFocus?.focus({ preventScroll: true });
    };
  }, [close, id, onClose, returnFocusRef]);

  const openGuide = () => {
    try {
      // Opening first allows a blocked popup to be distinguished from a window
      // opened with noopener (whose handle is also null). Detach before loading.
      const external = window.open('about:blank', '_blank');
      if (!external) { setOpenFailed(true); return; }
      external.opener = null;
      external.location.href = MINI_GUIDE;
      setOpenFailed(false);
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-model`} onKeyDown={event => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-[#151c28] text-white shadow-2xl">
        <div className="shrink-0 border-b border-white/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${id}-title`} className="min-w-0 text-sm font-semibold">{t('title')}</h2>
            <button ref={closeRef} onClick={close} className="shrink-0 rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">
              {t('close')}
            </button>
          </div>
          <p id={`${id}-model`} className="mt-2 break-words text-xs text-white/70">{t('selectedModel', { model: modelLabel })}</p>
        </div>
        <div role="region" aria-label={t('title')} tabIndex={0} className="min-h-0 overflow-y-auto overscroll-contain p-4 text-sm leading-relaxed text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">
          <p>{t('common')}</p>
          <section className="mt-4">
            <h3 className="font-semibold text-white">{t('notListedTitle')}</h3>
            <p className="mt-1">{t('notListedBody')}</p>
          </section>
          <section className="mt-4">
            <h3 className="font-semibold text-white">{t('noLightsTitle')}</h3>
            <p className="mt-1">{t('noLightsBody')}</p>
            {mini && <p className="mt-2">{t('mini')}</p>}
          </section>
          <section className="mt-4">
            <h3 className="font-semibold text-white">{t('closesTitle')}</h3>
            <p className="mt-1">{t('closesBody')}</p>
          </section>
          {pro && <p className="mt-4">{t('pro')}</p>}
          {other && <p className="mt-4">{t('other')}</p>}
          <p className="mt-4">{t('web')}</p>
          {mini && <button onClick={openGuide} className="mt-4 rounded-md bg-blue-500/20 px-3 py-2 text-sm text-blue-300 hover:bg-blue-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">{t('guide')}</button>}
          {mini && openFailed && <p role="alert" className="mt-3">{t('openFailed')}</p>}
        </div>
      </div>
    </div>
  );
}
