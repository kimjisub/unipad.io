'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface PackErrorDialogProps {
  errors: string[];
  /** A pack that could not open: the dialog stays until its Quit button returns to the list. */
  critical: boolean;
  onClose: () => void;
}

/** The problems found while opening a pack, as a warning over the player or an error that ends the load. */
export function PackErrorDialog({ errors, critical, onClose }: PackErrorDialogProps) {
  const t = useTranslations('play.player');

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={() => {
        if (!critical) onClose();
      }} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" role="alertdialog" aria-modal="true" aria-label={critical ? t('error') : t('warning')}>
        <div className="bg-[var(--card)] rounded-xl p-5 w-[360px] max-h-[60vh] flex flex-col pointer-events-auto shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-sm font-bold ${critical ? 'text-red-400' : 'text-yellow-400'}`}>
              {critical ? t('error') : t('warning')}
            </h2>
            <span className="text-[10px] text-white/40">
              {errors.length} {errors.length === 1 ? 'issue' : 'issues'}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 mb-4">
            {errors.map((err, i) => (
              <ErrorMessageItem key={i} message={err} />
            ))}
          </div>
          <button
            className={`w-full py-2 rounded-lg text-sm font-medium ${
              critical
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
            onClick={onClose}
          >
            {critical ? t('quit') : t('ok')}
          </button>
        </div>
      </div>
    </>
  );
}

const ERROR_MSG_TRUNCATE = 120;

function ErrorMessageItem({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > ERROR_MSG_TRUNCATE;
  const label = message.split(':')[0] || 'Error';
  const detail = message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : message;

  return (
    <div className="rounded-md bg-white/5 px-3 py-2">
      <div className="text-[11px] font-medium text-white/80 mb-0.5">{label}</div>
      <div
        className={`text-[10px] text-white/50 font-mono break-all leading-relaxed ${
          !expanded && isLong ? 'line-clamp-3' : ''
        }`}
      >
        {detail}
      </div>
      {isLong && (
        <button
          className="text-[10px] text-blue-400 hover:text-blue-300 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
