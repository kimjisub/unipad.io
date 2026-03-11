'use client';

import { useRef } from 'react';
import type { UniPackInfo } from '@/lib/unipack/types';
import type { ThemeAssets } from '@/lib/unipack';

interface OptionPanelProps {
  visible: boolean;
  unipackInfo: UniPackInfo;
  keyLedExist: boolean;
  autoPlayExists: boolean;
  theme: ThemeAssets;
  feedbackLight: boolean;
  ledEnabled: boolean;
  autoPlayEnabled: boolean;
  practiceMode: boolean;
  recording: boolean;
  hideUI: boolean;
  watermark: boolean;
  traceLog: boolean;
  proLightMode: boolean;
  midiConnected: boolean;
  midiConnecting?: boolean;
  onToggleFeedbackLight: () => void;
  onToggleLed: () => void;
  onToggleAutoPlay: () => void;
  onStartPractice: () => void;
  onToggleRecording: () => void;
  onToggleHideUI: () => void;
  onToggleWatermark: () => void;
  onToggleTraceLog: () => void;
  onClearTraceLog: () => void;
  onToggleProLightMode: () => void;
  volumeLevel: number;
  onVolumeChange: (level: number) => void;
  onConnectMidi: () => void;
  onOpenLaunchpadSettings: () => void;
  onClose: () => void;
  onQuit: () => void;
}

export function OptionPanel({
  visible,
  unipackInfo,
  keyLedExist,
  autoPlayExists,
  theme,
  feedbackLight,
  ledEnabled,
  autoPlayEnabled,
  practiceMode,
  recording,
  hideUI,
  watermark,
  traceLog,
  proLightMode,
  midiConnected,
  midiConnecting = false,
  onToggleFeedbackLight,
  onToggleLed,
  onToggleAutoPlay,
  onStartPractice,
  onToggleRecording,
  onToggleHideUI,
  onToggleWatermark,
  onToggleTraceLog,
  onClearTraceLog,
  onToggleProLightMode,
  volumeLevel,
  onVolumeChange,
  onConnectMidi,
  onOpenLaunchpadSettings,
  onClose,
  onQuit,
}: OptionPanelProps) {
  if (!visible) return null;

  const accentColor = theme.colors.checkbox || '#a6b4c9';
  const squareButton = unipackInfo.squareButton;
  const showFeedback = squareButton;
  const showLed = squareButton && keyLedExist;
  const showAutoPlay = squareButton && autoPlayExists;
  const showTrace = squareButton;
  const showRecord = squareButton;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed right-0 top-0 bottom-0 w-[280px] bg-[#141c28]/95 backdrop-blur-md z-50 flex flex-col animate-slide-in-right border-l border-white/[0.06]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2.5 shrink-0 border-b border-white/[0.06]">
          <span className="text-sm font-bold text-white">Menu</span>
          <button
            className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {/* UniPack Info */}
        <div className="mx-4 mt-3 mb-2 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <div className="text-sm font-bold text-white truncate">{unipackInfo.title}</div>
          <div className="text-xs text-white/50 truncate mt-0.5">{unipackInfo.producerName}</div>
          <div className="flex gap-3 mt-2 text-[10px] text-white/30">
            <span>{unipackInfo.buttonX}×{unipackInfo.buttonY}</span>
            <span>{unipackInfo.chain} {unipackInfo.chain === 1 ? 'chain' : 'chains'}</span>
          </div>
        </div>

        {/* Performance Section */}
        <Section title="Performance">
          {showFeedback && (
            <OptionSwitch label="Feedback Light" checked={feedbackLight} color={accentColor} onChange={onToggleFeedbackLight} />
          )}
          {showLed && (
            <OptionSwitch label="LED" checked={ledEnabled} color={accentColor} onChange={onToggleLed} />
          )}
          {showAutoPlay && (
            <>
              <OptionSwitch label="AutoPlay" checked={autoPlayEnabled} color={accentColor} onChange={onToggleAutoPlay} />
              <button
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                onClick={() => {
                  onStartPractice();
                  onClose();
                }}
              >
                <span className="text-xs text-white/80">Practice Mode</span>
                {practiceMode ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    On
                  </span>
                ) : (
                  <span className="text-[10px] text-white/45">Play</span>
                )}
              </button>
            </>
          )}
        </Section>

        {/* Volume Section */}
        <Section title="Volume">
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            <svg className="w-3.5 h-3.5 text-white/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6l-4 4H4v4h4l4 4V6z" />
            </svg>
            <input
              type="range"
              min={0}
              max={7}
              step={1}
              value={volumeLevel}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="flex-1 h-1 accent-white/80 cursor-pointer"
            />
            <span className="text-[10px] text-white/40 w-3 text-right font-mono">{volumeLevel}</span>
          </div>
        </Section>

        {/* Display Section */}
        <Section title="Display">
          <OptionSwitch label="Hide UI" checked={hideUI} color={accentColor} onChange={onToggleHideUI} />
          <OptionSwitch label="Watermark" checked={watermark} color={accentColor} onChange={onToggleWatermark} />
          <OptionSwitch label="Pro Light Mode" checked={proLightMode} color={accentColor} onChange={onToggleProLightMode} />
        </Section>

        {/* Tools Section */}
        <Section title="Tools">
          {showTrace && (
            <OptionSwitch label="Trace Log" checked={traceLog} color={accentColor} onChange={onToggleTraceLog} onLongPress={onClearTraceLog} />
          )}
          {showRecord && (
            <OptionSwitch label="Record" checked={recording} color="#ef4444" onChange={onToggleRecording} />
          )}
          <button
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
            onClick={onConnectMidi}
            disabled={midiConnecting}
          >
            <span className="text-xs text-white/80">{midiConnecting ? 'MIDI Connecting...' : (midiConnected ? 'MIDI Connected' : 'MIDI Connect')}</span>
            <span className={`w-2 h-2 rounded-full ${midiConnected ? 'bg-green-500' : 'bg-white/20'}`} />
          </button>
          <button
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
            onClick={onOpenLaunchpadSettings}
          >
            <span className="text-xs text-white/80">Launchpad Settings</span>
            <span className="text-[10px] text-white/35">Open</span>
          </button>
        </Section>

        </div>

        {/* Quit - fixed at bottom */}
        <div className="mx-4 my-3 shrink-0 border-t border-white/[0.06] pt-3">
          <button
            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/10 text-white/50 hover:text-red-400 transition-colors"
            onClick={onQuit}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="text-xs font-medium">Quit</span>
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-fade-in { animation: fade-in 200ms ease-out; }
        .animate-slide-in-right { animation: slide-in-right 300ms ease-out; }
      `}</style>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 mb-1">
      <div className="text-[9px] font-bold text-white/25 uppercase tracking-widest mb-1.5 mt-3">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function OptionSwitch({
  label,
  checked,
  color,
  onChange,
  onLongPress,
}: {
  label: string;
  checked: boolean;
  color: string;
  onChange: () => void;
  onLongPress?: () => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  return (
    <button
      className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors select-none"
      onClick={() => {
        if (didLongPress.current) {
          didLongPress.current = false;
          return;
        }
        onChange();
      }}
      onPointerDown={() => {
        if (!onLongPress) return;
        didLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
          didLongPress.current = true;
          onLongPress();
        }, 600);
      }}
      onPointerUp={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
      onPointerCancel={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
      onPointerLeave={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
    >
      <span className="text-xs text-white/80">{label}</span>
      {/* Toggle switch */}
      <div
        className="w-9 h-5 rounded-full relative transition-colors"
        style={{
          backgroundColor: checked ? `${color}80` : 'rgba(255,255,255,0.1)',
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all shadow-sm"
          style={{
            left: checked ? '18px' : '2px',
            backgroundColor: checked ? '#ffffff' : 'rgba(255,255,255,0.7)',
          }}
        />
      </div>
    </button>
  );
}
