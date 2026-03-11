'use client';

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

const PROFILE_OPTIONS: Array<{ value: LaunchpadProfile; label: string }> = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'launchpad_s', label: 'Launchpad S' },
  { value: 'launchpad_mk2', label: 'Launchpad MK2' },
  { value: 'launchpad_pro', label: 'Launchpad Pro (Original)' },
  { value: 'launchpad_x', label: 'Launchpad X' },
  { value: 'launchpad_mini_mk3', label: 'Launchpad Mini MK3' },
  { value: 'launchpad_pro_mk3', label: 'Launchpad Pro MK3' },
  { value: 'midifighter', label: 'Midi Fighter' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'master_keyboard', label: 'Master Keyboard' },
  { value: 'none', label: 'No Init SysEx' },
];

const PROFILE_NOTES: Partial<Record<LaunchpadProfile, string>> = {
  auto: 'Uses the connected output name to resolve the Android driver profile.',
  launchpad_s: 'Classic Launchpad S mapping with Launchpad S color-code conversion.',
  launchpad_mk2: 'Launchpad MK2 / X-style note grid with top-row and right-side function LEDs.',
  launchpad_pro: 'Original Launchpad Pro session mapping with X-style pad and chain layout.',
  launchpad_x: 'Launchpad X programmer mode mapping.',
  launchpad_mini_mk3: 'Launchpad Mini MK3 programmer mode mapping.',
  launchpad_pro_mk3: 'Launchpad Pro MK3 programmer mode mapping.',
  midifighter: '8x8 pad grid only. No chain LEDs or function LEDs.',
  matrix: '4-bank grid mapping with 32 function LED slots.',
  master_keyboard: 'Input-only keyboard mapping. No LED output.',
  none: 'Generic fallback. No device-specific SysEx or Android driver mapping.',
};

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
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[85]" role="dialog" aria-modal="true" aria-label="Launchpad Settings">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-x-4 top-12 mx-auto max-w-md rounded-xl border border-white/10 bg-[#151c28] p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Launchpad Settings</h3>
          <button className="text-xs text-white/60 hover:text-white/80" onClick={onClose}>Close</button>
        </div>

        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-white/5 p-3 text-xs text-white/70">
            <div className="flex items-center justify-between">
              <span>Status</span>
              <span className={midiConnected ? 'text-emerald-300' : 'text-white/50'}>
                {midiConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="mt-1">Input: {midiInputName ?? '-'}</div>
            <div className="mt-1">Output: {midiOutputName ?? '-'}</div>
            <div className="mt-1">Requested Type: {requestedProfile}</div>
            <div className="mt-1">Resolved Type: {resolvedProfile}</div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/55">Launchpad Type</label>
            <select
              className="w-full rounded-md border border-white/15 bg-black/25 px-2 py-2 text-xs text-white outline-none"
              value={requestedProfile}
              onChange={(e) => onChangeProfile(e.target.value as LaunchpadProfile)}
            >
              {PROFILE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-white/40">
              Auto Detect uses the connected output name. Type change is applied on next MIDI connect.
            </p>
            <p className="mt-2 text-[10px] leading-4 text-white/45">
              {PROFILE_NOTES[requestedProfile]}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded-md bg-blue-500/20 px-3 py-2 text-xs text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
              onClick={onConnect}
              disabled={connecting}
            >
              {connecting ? 'Connecting...' : (midiConnected ? 'Reconnect' : 'Connect')}
            </button>
            <button
              className="flex-1 rounded-md bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/20 disabled:opacity-50"
              onClick={onDisconnect}
              disabled={!midiConnected || connecting}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
