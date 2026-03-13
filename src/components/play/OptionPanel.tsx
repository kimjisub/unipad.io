'use client';

import { useRef, useState, useEffect } from 'react';
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
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [visible, mounted]);

  if (!mounted) return null;

  const handleClose = () => {
    onClose();
  };

  const accentColor = theme.colors.optionWindowCheckbox || '#E8A44A';
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
        className={`fixed inset-0 bg-black/50 z-40 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div role="dialog" aria-modal="true" aria-label="Menu" className={`fixed right-0 top-0 bottom-0 w-[280px] backdrop-blur-md z-50 flex flex-col border-l border-white/[0.06] ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`} style={{ backgroundColor: 'rgba(22,30,43,0.94)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <span className="text-[22px] font-normal text-white">Menu</span>
          <button
            className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#FF6B6B' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {/* UniPack Info */}
        <div className="mx-6 mt-2 mb-2 p-4 rounded-xl bg-white/[0.06]">
          <div className="text-base font-semibold text-white truncate">{unipackInfo.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="text-[13px] text-white/40 truncate flex-1">{unipackInfo.producerName}</div>
            <a
              href={`https://www.youtube.com/results?search_query=UniPad+${encodeURIComponent(unipackInfo.title)}+${encodeURIComponent(unipackInfo.producerName)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-red-400 transition-colors"
              aria-label="YouTube"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
            {unipackInfo.website && (
              <a
                href={unipackInfo.website}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-blue-400 transition-colors"
                aria-label="Website"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </a>
            )}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-white/40">
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
                className="flex items-center justify-between w-full px-6 py-2.5 hover:bg-white/[0.04] transition-colors"
                onClick={() => {
                  onStartPractice();
                  onClose();
                }}
              >
                <span className="text-sm text-white">Practice Mode</span>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: accentColor }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </>
          )}
        </Section>

        {/* Volume Section */}
        <Section title="Volume">
          <div className="flex items-center gap-2.5 px-6 py-2">
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
            className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-white/[0.04] transition-colors"
            onClick={onConnectMidi}
            disabled={midiConnecting}
          >
            <span className="text-sm text-white">{midiConnecting ? 'MIDI Connecting...' : (midiConnected ? 'MIDI Connected' : 'MIDI Connect')}</span>
            <span className={`w-2 h-2 rounded-full ${midiConnected ? 'bg-green-500' : 'bg-white/20'}`} />
          </button>
          <button
            className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-white/[0.04] transition-colors"
            onClick={onOpenLaunchpadSettings}
          >
            <span className="text-sm text-white">Launchpad Settings</span>
            <span className="text-xs text-white/35">Open</span>
          </button>
        </Section>

        </div>

        {/* Quit - fixed at bottom */}
        <div className="shrink-0">
          <button
            className="flex items-center gap-3 w-full px-6 py-4 hover:bg-white/[0.04] transition-colors"
            style={{ color: '#FF6B6B' }}
            onClick={onQuit}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="text-[15px]">Quit</span>
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slide-out-right { from { transform: translateX(0); } to { transform: translateX(100%); } }
        .animate-fade-in { animation: fade-in 200ms ease-out; }
        .animate-fade-out { animation: fade-out 250ms ease-in forwards; }
        .animate-slide-in-right { animation: slide-in-right 300ms ease-out; }
        .animate-slide-out-right { animation: slide-out-right 250ms ease-in forwards; }
      `}</style>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-6 text-[11px] font-bold text-white/40 uppercase tracking-wider mb-1 mt-4">{title}</div>
      <div>{children}</div>
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
      className="flex items-center justify-between w-full px-6 py-2.5 hover:bg-white/[0.04] transition-colors select-none"
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
      <span className="text-sm text-white">{label}</span>
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
