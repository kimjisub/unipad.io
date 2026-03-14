'use client';

import { useRef } from 'react';
import type { ThemeColors } from '@/lib/unipack';
import type { PlayMode } from './useUniPadEngine';
import { AutoPlayControls } from './AutoPlayControls';

interface ControlPanelProps {
  squareButton: boolean;
  keyLedExist: boolean;
  feedbackLight: boolean;
  ledEnabled: boolean;
  autoPlayControlsVisible: boolean;
  autoPlayExist: boolean;
  recording: boolean;
  traceLog: boolean;
  playMode: PlayMode;
  autoPlayPlaying: boolean;
  autoPlayProgress: number;
  autoPlayTotal: number;
  themeColors?: ThemeColors;
  panelBgColor?: string;
  onToggleFeedbackLight: () => void;
  onToggleLed: () => void;
  onSwitchPlayMode: (mode: PlayMode) => void;
  onAutoPlayPlayPause: () => void;
  onAutoPlayPrev: () => void;
  onAutoPlayNext: () => void;
  onToggleRecording: () => void;
  onToggleTraceLog: () => void;
  onClearTraceLog: () => void;
}

export function ControlPanel({
  squareButton,
  keyLedExist,
  feedbackLight,
  ledEnabled,
  autoPlayControlsVisible,
  autoPlayExist,
  recording,
  traceLog,
  playMode,
  autoPlayPlaying,
  autoPlayProgress,
  autoPlayTotal,
  themeColors,
  panelBgColor = 'rgba(0,0,0,0.35)',
  onToggleFeedbackLight,
  onToggleLed,
  onSwitchPlayMode,
  onAutoPlayPlayPause,
  onAutoPlayPrev,
  onAutoPlayNext,
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
            <PlayModeSelector
              playMode={playMode}
              color={cbColor}
              onSwitchPlayMode={onSwitchPlayMode}
            />
            {autoPlayControlsVisible && (
              <div className="mt-1 px-1">
                <AutoPlayControls
                  playing={autoPlayPlaying}
                  progress={autoPlayProgress}
                  total={autoPlayTotal}
                  themeColor={cbColor}
                  onPlayPause={onAutoPlayPlayPause}
                  onPrev={onAutoPlayPrev}
                  onNext={onAutoPlayNext}
                />
              </div>
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

const PLAY_MODES: { mode: PlayMode; label: string }[] = [
  { mode: 'autoPlay', label: 'Auto' },
  { mode: 'guidePlay', label: 'Guide' },
  { mode: 'stepPractice', label: 'Step' },
];

function PlayModeSelector({
  playMode,
  color,
  onSwitchPlayMode,
}: {
  playMode: PlayMode;
  color: string;
  onSwitchPlayMode: (mode: PlayMode) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {PLAY_MODES.map(({ mode, label }) => {
        const active = playMode === mode;
        return (
          <button
            key={mode}
            className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-white/5 transition-colors select-none"
            onClick={() => onSwitchPlayMode(mode)}
          >
            <div
              className="w-2 h-2 rounded-full shrink-0 transition-colors"
              style={{
                backgroundColor: active ? color : `${color}40`,
              }}
            />
            <span
              className="text-[11px] font-medium transition-colors whitespace-nowrap"
              style={{
                color: active ? '#ffffff' : 'rgba(255,255,255,0.5)',
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
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
