'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
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
  /** Opens the slide-in OptionPanel. Replaces the previous bottom-right Menu overlay
   *  so the menu icon lives inside the chrome strip and never overlaps a corner pad. */
  onOpenMenu: () => void;
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
  onOpenMenu,
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
  const t = useTranslations('play.control');
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
      {/* Top group: menu + performance controls */}
      <div
        className="flex flex-col px-1.5 py-2 gap-0.5 rounded-xl backdrop-blur-sm"
        style={groupStyle}
      >
        {/* Menu — promoted into the chrome strip so the bottom-right overlay
            (which used to overlap a pad) is no longer needed */}
        <button
          className="flex items-center justify-center p-1.5 rounded-md hover:bg-white/10 transition-colors"
          onClick={onOpenMenu}
          aria-label={t('openMenu')}
          title={t('menu')}
        >
          <svg className="w-5 h-5 text-white/85" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="h-px bg-white/15 mx-2 my-1" />
        {showFeedback && (
          <CheckItem label={t('feedback')} checked={feedbackLight} color={cbColor} onClick={onToggleFeedbackLight} />
        )}
        {showLed && (
          <CheckItem label={t('led')} checked={ledEnabled} color={cbColor} onClick={onToggleLed} />
        )}
        {showAutoPlay && (
          <>
            <PlayModeSegmented
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
            label={t('trace')}
            checked={traceLog}
            color={cbColor}
            onClick={onToggleTraceLog}
            onLongPress={onClearTraceLog}
          />
          <CheckItem label={t('rec')} checked={recording} color="#ef4444" onClick={onToggleRecording} />
        </div>
      )}
    </div>
  );
}

const PLAY_MODES: { mode: PlayMode; labelKey: 'auto' | 'guide' | 'step' }[] = [
  { mode: 'autoPlay', labelKey: 'auto' },
  { mode: 'guidePlay', labelKey: 'guide' },
  { mode: 'stepPractice', labelKey: 'step' },
];

/** Segmented control for play mode. Visualizes the radio relationship
 *  (only one mode active at a time) which the previous list of buttons
 *  did not communicate clearly. */
function PlayModeSegmented({
  playMode,
  color,
  onSwitchPlayMode,
}: {
  playMode: PlayMode;
  color: string;
  onSwitchPlayMode: (mode: PlayMode) => void;
}) {
  const t = useTranslations('play.playMode');

  return (
    <div
      className="flex items-stretch gap-0.5 mt-1 mx-0.5 rounded-md p-0.5"
      style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
    >
      {PLAY_MODES.map(({ mode, labelKey }) => {
        const active = playMode === mode;
        const label = t(labelKey);
        return (
          <button
            key={mode}
            className="flex-1 px-1 py-1.5 rounded text-[10px] font-semibold transition-colors select-none"
            style={{
              backgroundColor: active ? color : 'transparent',
              color: active ? '#000000' : 'rgba(255,255,255,0.6)',
            }}
            onClick={() => onSwitchPlayMode(mode)}
            aria-pressed={active}
            aria-label={t('ariaLabel', { mode: label })}
          >
            {label}
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
