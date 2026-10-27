'use client';

import { useTranslations } from 'next-intl';
import { SOUND_FAILURE_REASONS, soundFailureCounts, type SoundLoadReport } from '@/lib/unipack/soundLoading';

interface SoundLoadNoticeProps {
  report: SoundLoadReport;
  /** Every used sound failed and the pack did not open; otherwise it plays without the failed sounds. */
  failed: boolean;
  /** Dismisses a notice over the player, or returns to the pack list from a pack that did not open. */
  onClose: () => void;
  /** Opens the pack again from the start. */
  onRetry: () => void;
  /** The file list replaces the notice; it owns the keyboard like any dialog. */
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}

/** Why some or all of a pack's sounds did not load, counted by cause, with each file on request. */
export function SoundLoadNotice({ report, failed, onClose, onRetry, detailsOpen, onDetailsOpenChange }: SoundLoadNoticeProps) {
  const t = useTranslations('play.soundLoad');
  const counts = soundFailureCounts(report);
  const summary = SOUND_FAILURE_REASONS.filter(reason => counts[reason] > 0).map(reason => (
    <p key={reason}>{t(reason, { count: counts[reason] })}</p>
  ));
  const button = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/85 hover:bg-white/20';

  if (detailsOpen) {
    return (
      <>
        <div className="fixed inset-0 bg-black/60 z-[60]" />
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none" role="dialog" aria-modal="true" aria-label={t('details')}>
          <div className="bg-[var(--card)] rounded-xl p-5 w-[360px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col pointer-events-auto shadow-2xl">
            <h2 className="text-sm font-bold text-white/90 mb-3">{t('details')}</h2>
            <ul className="flex-1 overflow-y-auto space-y-1.5 mb-4">
              {report.failures.map(({ file, reason }) => (
                <li key={file} className="rounded-md bg-white/5 px-3 py-2">
                  <div className="text-[11px] text-white/80 font-mono break-all" title={file}>{file.split('/').at(-1)}</div>
                  <div className="text-[10px] text-white/50">{t(`reason.${reason}`)}</div>
                </li>
              ))}
            </ul>
            {/* Closing the list goes back to playing, or to the notice of a pack that did not open. */}
            <button className={button} onClick={failed ? () => onDetailsOpenChange(false) : onClose}>{t('close')}</button>
          </div>
        </div>
      </>
    );
  }

  if (failed) {
    return (
      <>
        <div className="fixed inset-0 bg-black/60 z-50" />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" role="alertdialog" aria-modal="true" aria-label={t('failedTitle')}>
          <div className="bg-[var(--card)] rounded-xl p-5 w-[360px] max-w-[calc(100vw-2rem)] flex flex-col gap-3 pointer-events-auto shadow-2xl">
            <h2 className="text-sm font-bold text-red-400">{t('failedTitle')}</h2>
            <div className="text-xs text-white/70 space-y-1">{summary}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <button className={button} onClick={() => onDetailsOpenChange(true)}>{t('details')}</button>
              <button className={button} onClick={onRetry}>{t('retry')}</button>
              <button className={button} onClick={onClose}>{t('packList')}</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 w-[min(420px,calc(100%-2rem))] rounded-xl bg-black/80 border border-white/15 px-4 py-3 text-white shadow-2xl backdrop-blur-md" role="status">
      <div className="text-xs text-yellow-300 space-y-1 mb-2">{summary}</div>
      <div className="flex justify-end gap-2">
        <button className={button} onClick={() => onDetailsOpenChange(true)}>{t('details')}</button>
        <button className={button} onClick={onClose}>{t('close')}</button>
      </div>
    </div>
  );
}
