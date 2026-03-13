'use client';

import { useRef } from 'react';
import type { ThemeColors } from '@/lib/unipack';
import { AutoPlayControls } from './AutoPlayControls';

interface ControlPanelProps {
  squareButton: boolean;
  keyLedExist: boolean;
  feedbackLight: boolean;
  ledEnabled: boolean;
  autoPlayEnabled: boolean;
  autoPlayPlaying: boolean;
  autoPlayControlsVisible: boolean;
  autoPlayExist: boolean;
  recording: boolean;
  traceLog: boolean;
  practiceMode: boolean;
  autoPlayProgress: number;
  autoPlayTotal: number;
  themeColors?: ThemeColors;
  panelBgColor?: string;
  onToggleFeedbackLight: () => void;
  onToggleLed: () => void;
  onToggleAutoPlay: () => void;
  onAutoPlayPlayPause: () => void;
  onAutoPlayPrev: () => void;
  onAutoPlayNext: () => void;
  onTogglePracticeMode: () => void;
  onToggleRecording: () => void;
  onToggleTraceLog: () => void;
  onClearTraceLog: () => void;
}

export function ControlPanel({
  squareButton,
  keyLedExist,
  feedbackLight,
  ledEnabled,
  autoPlayEnabled,
  autoPlayPlaying,
  autoPlayControlsVisible,
  autoPlayExist,
  recording,
  traceLog,
  practiceMode,
  autoPlayProgress,
  autoPlayTotal,
  themeColors,
  panelBgColor = 'rgba(0,0,0,0.35)',
  onToggleFeedbackLight,
  onToggleLed,
  onToggleAutoPlay,
  onAutoPlayPlayPause,
  onAutoPlayPrev,
  onAutoPlayNext,
  onTogglePracticeMode,
  onToggleRecording,
  onToggleTraceLog,
  onClearTraceLog,
}: ControlPanelProps) {
  const cbColor = themeColors?.checkbox || '#a6b4c9';
  const showFeedback = squareButton;
  const showLed = squareButton && keyLedExist;
  const showAutoPlay = squareButton && autoPlayExist;
  const showTools = squareButton;

  const groupStyle = {
    backgroundColor: panelBgColor,
  };

  return (
    <div className="flex flex-col justify-between h-full py-1 gap-1.5">
      {/* Top group: performance controls */}
      <div
        className="flex flex-col px-1.5 py-2 gap-0.5 rounded-xl backdrop-blur-sm"
        style={groupStyle}
      >
        {showFeedback && (
          <CheckItem label="Feedback" checked={feedbackLight} color={cbColor} onClick={onToggleFeedbackLight} />
        )}
        {showLed && (
          <CheckItem label="LED" checked={ledEnabled} color={cbColor} onClick={onToggleLed} />
        )}
        {showAutoPlay && (
          <>
            <CheckItem
              label="AutoPlay"
              checked={autoPlayEnabled}
              color={cbColor}
              onClick={onToggleAutoPlay}
            />
            {autoPlayControlsVisible && (
              <div className="mt-1 px-1">
                <AutoPlayControls
                  playing={autoPlayPlaying}
                  progress={autoPlayProgress}
                  total={autoPlayTotal}
                  practiceMode={practiceMode}
                  themeColor={cbColor}
                  onPlayPause={onAutoPlayPlayPause}
                  onPrev={onAutoPlayPrev}
                  onNext={onAutoPlayNext}
                  onTogglePractice={onTogglePracticeMode}
                />
              </div>
            )}
            {!autoPlayControlsVisible && (
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition-colors origin-top-left scale-75"
                onClick={onTogglePracticeMode}
                title="Practice Mode"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24" style={{ color: cbColor }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-[13px] font-medium whitespace-nowrap" style={{ color: cbColor }}>
                  Practice Mode
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Bottom group: tools */}
      {showTools && (
        <div
          className="flex flex-col px-1.5 py-2 gap-0.5 rounded-xl backdrop-blur-sm"
          style={groupStyle}
        >
          <CheckItem
            label="Trace"
            checked={traceLog}
            color={cbColor}
            onClick={onToggleTraceLog}
            onLongPress={onClearTraceLog}
          />
          <CheckItem label="Rec" checked={recording} color="#ef4444" onClick={onToggleRecording} />
        </div>
      )}
    </div>
  );
}

function CheckItem({
  label,
  checked,
  color,
  onClick,
  onLongPress,
}: {
  label: string;
  checked: boolean;
  color: string;
  onClick: () => void;
  onLongPress?: () => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  return (
    <button
      className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-white/5 transition-colors select-none"
      onClick={() => {
        if (didLongPress.current) {
          didLongPress.current = false;
          return;
        }
        onClick();
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
      {/* Dot indicator (Android style) */}
      <div
        className="w-2 h-2 rounded-full shrink-0 transition-colors"
        style={{
          backgroundColor: checked ? color : `${color}40`,
        }}
      />
      <span
        className="text-[11px] font-medium transition-colors whitespace-nowrap"
        style={{
          color: checked ? '#ffffff' : 'rgba(255,255,255,0.5)',
        }}
      >
        {label}
      </span>
    </button>
  );
}
