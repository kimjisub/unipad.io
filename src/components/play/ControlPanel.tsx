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
  midiConnected: boolean;
  recording: boolean;
  hideUI: boolean;
  traceLog: boolean;
  practiceMode: boolean;
  autoPlayProgress: number;
  autoPlayTotal: number;
  themeColors?: ThemeColors;
  onToggleFeedbackLight: () => void;
  onToggleLed: () => void;
  onToggleAutoPlay: () => void;
  onAutoPlayPlayPause: () => void;
  onAutoPlayPrev: () => void;
  onAutoPlayNext: () => void;
  onTogglePracticeMode: () => void;
  onToggleRecording: () => void;
  onToggleHideUI: () => void;
  onToggleTraceLog: () => void;
  onClearTraceLog: () => void;
  onConnectMidi: () => void;
  midiConnecting?: boolean;
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
  midiConnected,
  recording,
  hideUI,
  traceLog,
  practiceMode,
  autoPlayProgress,
  autoPlayTotal,
  themeColors,
  onToggleFeedbackLight,
  onToggleLed,
  onToggleAutoPlay,
  onAutoPlayPlayPause,
  onAutoPlayPrev,
  onAutoPlayNext,
  onTogglePracticeMode,
  onToggleRecording,
  onToggleHideUI,
  onToggleTraceLog,
  onClearTraceLog,
  onConnectMidi,
  midiConnecting = false,
}: ControlPanelProps) {
  const cbColor = themeColors?.checkbox || '#a6b4c9';
  const showPerformance = squareButton;
  const showFeedback = squareButton;
  const showLed = squareButton && keyLedExist;
  const showAutoPlay = squareButton && autoPlayExist;
  const showTools = squareButton;

  return (
    <div className="flex flex-col py-2.5 px-1">
      {showPerformance && (
        <>
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
              {!autoPlayControlsVisible && (
                <button
                  className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors"
                  onClick={onTogglePracticeMode}
                  title="Practice Mode"
                >
                  {practiceMode && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                  <span className={`text-[11px] font-medium ${practiceMode ? 'text-green-400' : 'text-white/60'}`}>
                    Practice
                  </span>
                </button>
              )}
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
            </>
          )}
          <div className="my-1.5 mx-1 border-t border-white/[0.06]" />
        </>
      )}

      {showTools && (
        <>
          <CheckItem
            label="Trace"
            checked={traceLog}
            color={cbColor}
            onClick={onToggleTraceLog}
            onLongPress={onClearTraceLog}
          />
          <CheckItem label="Rec" checked={recording} color="#ef4444" onClick={onToggleRecording} />
        </>
      )}
      <CheckItem label="Hide" checked={hideUI} color={cbColor} onClick={onToggleHideUI} />
      <div className="my-1.5 mx-1 border-t border-white/[0.06]" />
      <button
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
        onClick={onConnectMidi}
        disabled={midiConnecting}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${midiConnected ? 'bg-green-500' : 'bg-white/20'}`} />
        <span className="text-[11px] text-white/50 whitespace-nowrap">{midiConnecting ? 'MIDI...' : 'MIDI'}</span>
      </button>
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
