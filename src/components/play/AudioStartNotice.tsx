'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

import { useModalKeyboard } from '@/hooks/useModalKeyboard';

import type { AudioStartNotice as Notice } from './audioStart';

interface AudioStartNoticeProps {
  notice: Notice;
  onRetry: () => void;
  /** Cancel, Dismiss and Escape alike: nothing that was asked for starts. */
  onCancel: () => void;
  /** Where focus goes once the notice closes. */
  returnFocusTarget: () => HTMLElement | null;
}

// The dialog's text follows the root size (the page body's is fixed in pixels), and the
// [@container(max-width:…em)] classes below measure the dialog in that size, so doubled text gets the
// narrow layout (stacked buttons, tighter padding, no symbol) at any screen width.

/** Shown while the audio a start needs is prepared for longer than a moment, or when it failed. */
export function AudioStartNotice({ notice, onRetry, onCancel, returnFocusTarget }: AudioStartNoticeProps) {
  const t = useTranslations('play.audioStart');
  const id = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pending = notice.phase === 'preparing';
  const copy = pending ? (notice.retry ? 'retrying' : 'preparing') : notice.phase;
  const title = t(`${copy}.title`);
  const body = t(`${copy}.body`);

  // The dialog's name and description announce the first state; later ones go to the status line once.
  const [announcement, setAnnouncement] = useState('');
  const [announcedCopy, setAnnouncedCopy] = useState(copy);
  if (copy !== announcedCopy) {
    setAnnouncedCopy(copy);
    setAnnouncement(`${title}. ${body}`);
  }
  useEffect(() => {
    if (copyRef.current) copyRef.current.scrollTop = 0;
  }, [copy]);

  useModalKeyboard({
    dialogRef, layerRef, initialFocusRef: cancelRef, returnFocusTarget,
    ignoreRepeatedActivation: true, onEscape: onCancel,
  });

  const button = 'min-h-[48px] min-w-0 flex-1 rounded-[10px] border px-[14px] py-[11px] text-[0.9375rem] leading-[1.4] [overflow-wrap:anywhere] '
    + '[@container(max-width:20em)]:px-[12px] [@container(max-width:20em)]:py-[10px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-white';

  return createPortal(
    // The backdrop takes presses outside the notice: they neither close it nor reach the player.
    <div ref={layerRef} className="fixed inset-0 flex items-center justify-center bg-black/[0.64]" data-audio-start-notice={notice.phase}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
        className="flex max-h-[calc(100dvh-32px)] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-[#414147] bg-[#1b1b1f] text-[1rem] text-[#f4f4f5] shadow-[0_24px_80px_#0009] [container-type:inline-size] max-[360px]:rounded-[16px]">
        <div ref={copyRef} className="min-h-0 overflow-auto overscroll-contain px-[28px] pt-[28px] [@container(max-width:20em)]:px-[20px] [@container(max-width:20em)]:pt-[20px] [@media(max-height:420px)]:pt-[20px]">
          <div aria-hidden="true" className="mb-[18px] flex h-[44px] w-[44px] items-center justify-center rounded-[12px] bg-[#ff8f0014] text-[#ff8f00] [@container(max-width:16em)]:hidden [@media(max-height:420px)]:hidden">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              {!pending && <path d="m16 9 5 6m0-6-5 6" />}
            </svg>
          </div>
          <h2 id={`${id}-title`} className="mb-[10px] text-[1.375rem] font-[650] leading-[1.35] tracking-[-0.025em] [overflow-wrap:anywhere]">{title}</h2>
          <p id={`${id}-body`} className="text-[0.9375rem] leading-[1.6] text-[#bdbdc5] [overflow-wrap:anywhere]">{body}</p>
        </div>
        <div className="flex shrink-0 gap-[10px] bg-[#1b1b1f] px-[28px] pb-[28px] pt-[24px] [@container(max-width:20em)]:flex-col [@container(max-width:20em)]:p-[20px] [@media(max-height:420px)]:pb-[20px] [@media(max-height:420px)]:pt-[18px]">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${button} border-[#66666f] bg-[#29292e] text-[#f4f4f5]`}>
            {pending ? t('cancel') : t('dismiss')}
          </button>
          {!pending && (
            <button type="button" className={`${button} border-[#ff8f00] bg-[#ff8f00] font-[650] text-[#17120b]`}
              onClick={() => {
                // Try again disappears while preparing; focus stays in the notice on Cancel.
                cancelRef.current?.focus({ preventScroll: true });
                onRetry();
              }}>
              {t('retry')}
            </button>
          )}
        </div>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</span>
      </div>
    </div>,
    document.body,
  );
}
