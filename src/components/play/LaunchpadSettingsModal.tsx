'use client';

import { useTranslations } from 'next-intl';

import type { LaunchpadProfile } from '@/lib/unipack';

interface LaunchpadSettingsModalProps {
  visible: boolean;
  midiConnected: boolean;
  midiInputName: string | null;
  midiOutputName: string | null;
  requestedProfile: LaunchpadProfile;
  resolvedProfile: Exclude<LaunchpadProfile, 'auto'>;
  connecting?: boolean;
  onClose: () => void;
  onChangeProfile: (profile: LaunchpadProfile) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

/** Device names stay untranslated; the two descriptive entries carry a key
 *  so they read in the user's language. */
const PROFILE_OPTIONS: Array<{ value: LaunchpadProfile; label: string; labelKey?: 'autoDetect' | 'noInitSysEx' }> = [
  { value: 'auto', label: 'Auto Detect', labelKey: 'autoDetect' },
  { value: 'launchpad_s', label: 'Launchpad S' },
  { value: 'launchpad_mk2', label: 'Launchpad MK2' },
  { value: 'launchpad_pro', label: 'Launchpad Pro (Original)' },
  { value: 'launchpad_x', label: 'Launchpad X' },
  { value: 'launchpad_mini_mk3', label: 'Launchpad Mini MK3' },
  { value: 'launchpad_pro_mk3', label: 'Launchpad Pro MK3' },
  { value: 'midifighter', label: 'Midi Fighter' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'master_keyboard', label: 'Master Keyboard' },
  { value: 'none', label: 'No Init SysEx', labelKey: 'noInitSysEx' },
];


export function LaunchpadSettingsModal({
  visible,
  midiConnected,
  midiInputName,
  midiOutputName,
  requestedProfile,
  resolvedProfile,
  connecting = false,
  onClose,
  onChangeProfile,
  onConnect,
  onDisconnect,
}: LaunchpadSettingsModalProps) {
  const t = useTranslations('play.launchpad');

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[85]" role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-x-4 top-12 mx-auto max-w-md rounded-xl border border-white/10 bg-[#151c28] p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
          <button className="text-xs text-white/60 hover:text-white/80" onClick={onClose}>{t('close')}</button>
        </div>

        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-white/5 p-3 text-xs text-white/70">
            <div className="flex items-center justify-between">
              <span>{t('status')}</span>
              <span className={midiConnected ? 'text-emerald-300' : 'text-white/50'}>
                {midiConnected ? t('connected') : t('disconnected')}
              </span>
            </div>
            <div className="mt-1">{t('input')}: {midiInputName ?? '-'}</div>
            <div className="mt-1">{t('output')}: {midiOutputName ?? '-'}</div>
            <div className="mt-1">{t('requestedType')}: {requestedProfile}</div>
            <div className="mt-1">{t('resolvedType')}: {resolvedProfile}</div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/55">{t('typeLabel')}</label>
            <select
              className="w-full rounded-md border border-white/15 bg-black/25 px-2 py-2 text-xs text-white outline-none"
              value={requestedProfile}
              onChange={(e) => onChangeProfile(e.target.value as LaunchpadProfile)}
            >
              {PROFILE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.labelKey ? t(opt.labelKey) : opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-white/40">
              {t('typeHint')}
            </p>
            <p className="mt-2 text-[10px] leading-4 text-white/45">
              {t(`notes.${requestedProfile}`)}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded-md bg-blue-500/20 px-3 py-2 text-xs text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
              onClick={onConnect}
              disabled={connecting}
            >
              {connecting ? t('connecting') : (midiConnected ? t('reconnect') : t('connect'))}
            </button>
            <button
              className="flex-1 rounded-md bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/20 disabled:opacity-50"
              onClick={onDisconnect}
              disabled={!midiConnected || connecting}
            >
              {t('disconnect')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
