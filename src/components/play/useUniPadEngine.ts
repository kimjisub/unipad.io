'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  parseUniPack,
  SoundEngine,
  AUTO_PLAY_INPUT,
  LedRunner,
  AutoPlayRunner,
  ChannelManager,
  Channel,
  MidiConnection,
  Recorder,
  getPadForKeyCode,
  getChainKey,
  argbToRgba,
  loadThemeFromZip,
  getDefaultTheme,
  releaseThemeUrls,
  getSetting,
  setSetting,
} from '@/lib/unipack';
import { PlaybackTicker } from '@/lib/unipack/PlaybackTicker';
import { autoPlayMap } from '@/lib/unipack/AutoPlayMapper';
import { changeChain, ledPushToNum } from '@/lib/unipack/chainChange';
import { PlayerHolds } from '@/lib/unipack/PlayerHolds';
import { LOGO_FUNCTION_KEY } from '@/lib/unipack/MidiConnection';
import { PlayUsageTracker, type PadInputSource } from '@/lib/analytics/usageEvents';
import { logAnalyticsEvent } from '@/lib/analytics/logAnalyticsEvent';
import type {
  UniPackData,
  LedRunnerListener,
  AutoPlayListener,
  MidiControllerListener,
  LaunchpadProfile,
  MidiConnectionStatus,
  ThemeAssets,
} from '@/lib/unipack';

const CHAIN_INDEX_OFFSET = 8;
const CIRCLE_ARRAY_SIZE = 32;
/** The open option panel shows its settings on the top row and its volume on the chain column. */
const OPTION_PANEL_LED_COUNT = CHAIN_INDEX_OFFSET + 8;
// What holds a pad, so a release ends only its own press (screen pointers name themselves in PadGrid,
// auto play uses AUTO_PLAY_INPUT).
const MIDI_INPUT = 'midi';
const keyInput = (code: string) => `key-${code}`;

/** A round button or the logo shows its highest-priority light on the launchpad (Android's
 *  setLedLaunchpadChain), so pack lights stay off them outside Pro light mode as on Android and iOS. */
function roundLedCode(cm: ChannelManager, index: number): number {
  return cm.get(-1, index)?.code ?? 0;
}

/** A pad shows its highest-priority light on the launchpad, as on screen (Android's setLedLaunchpad). */
function padLedCode(cm: ChannelManager, x: number, y: number): number {
  return cm.get(x, y)?.code ?? 0;
}

export interface PadState {
  color: string;
  pressed: boolean;
  /** True when PRESSED channel is the winning (highest-priority) channel */
  pressedIsWinning: boolean;
  guide: boolean;
  guideTargetWallTimeMs: number | null;
}

export interface EngineState {
  loaded: boolean;
  loading: boolean;
  loadProgress: number;
  loadPhase: string;
  unipack: UniPackData | null;
  chain: number;
  padStates: PadState[][];
  chainStates: { color: string; active: boolean; guide?: boolean }[];
  errors: string[];
  midiConnected: boolean;
  midiInputName: string | null;
  midiOutputName: string | null;
  midiRequestedProfile: LaunchpadProfile;
  midiResolvedProfile: Exclude<LaunchpadProfile, 'auto'>;

  feedbackLight: boolean;
  ledEnabled: boolean;
  autoPlayEnabled: boolean;
  autoPlayPlaying: boolean;
  autoPlayControlsVisible: boolean;
  autoPlayProgress: number;
  autoPlayTotal: number;
  volumeLevel: number;
  practiceMode: boolean;
  stepPractice: boolean;
  recording: boolean;
  hideUI: boolean;
  watermark: boolean;
  /** Off: a finger stays on the pad it went down on. On: it plays each pad it is drawn onto. */
  slideMode: boolean;
  traceLog: boolean;
  traceLogStyle: TraceLogStyle;
  traceLogSequence: { x: number; y: number }[][];
  proLightMode: boolean;
  criticalError: boolean;
  theme: ThemeAssets;
  autoMappingActive: boolean;
  autoMappingProgress: number;
  autoMappingTotal: number;
}

export type PlayMode = 'none' | 'autoPlay' | 'guidePlay' | 'stepPractice';

/** How the trace is drawn: the tap order as numbers on each pad, or a line through dots. */
export type TraceLogStyle = 'numbers' | 'lines';

const MAX_VOLUME_LEVEL = 7;

/** Saved playing choices. Only a choice the player makes is written; a missing one keeps its default. */
type PlayPreferenceKey = 'volumeLevel' | 'watermark' | 'slideMode' | 'traceLogStyle';
const PLAY_PREFERENCE_KEYS: readonly PlayPreferenceKey[] = ['volumeLevel', 'watermark', 'slideMode', 'traceLogStyle'];

const clampVolumeLevel = (level: number) => Math.max(0, Math.min(MAX_VOLUME_LEVEL, level));
const parseBoolean = (value: string | null) => (value === 'true' ? true : value === 'false' ? false : null);
const parseVolumeLevel = (value: string | null) => {
  const level = value === null ? NaN : Number(value);
  return Number.isFinite(level) ? clampVolumeLevel(level) : null;
};
const parseTraceLogStyle = (value: string | null): TraceLogStyle | null => (
  value === 'numbers' || value === 'lines' ? value : null
);

const LED_RED_DIM = 1;
const LED_RED = 3;
const LED_RED_BRIGHT = 5;
const LED_WARM = 11;
const LED_ORANGE = 17;
const LED_YELLOW = 19;
const LED_BLUE = 40;
const LED_LAVENDER = 43;
const LED_CYAN = 52;
const LED_LIGHT_BLUE = 55;
const LED_GREEN = 61;

/** The watermark's lights on the top row's buttons 5 to 8, as Android's refreshWatermark. */
const WATERMARK_LEDS: ReadonlyArray<[number, number]> = [[4, LED_GREEN], [5, LED_BLUE], [6, LED_GREEN], [7, LED_BLUE]];

/** The watermark and the selected chain's light show on the round buttons only while the
 *  watermark is on and the option panel is closed, as Android's refreshWatermark. */
function setRoundLightsVisible(cm: ChannelManager, visible: boolean): void {
  cm.setCirIgnore(Channel.UI_UNIPAD, !visible);
  cm.setCirIgnore(Channel.CHAIN, !visible);
}

export function useUniPadEngine() {
  const [state, setState] = useState<EngineState>({
    loaded: false,
    loading: false,
    loadProgress: 0,
    loadPhase: '',
    unipack: null,
    chain: 0,
    padStates: [],
    chainStates: [],
    errors: [],
    midiConnected: false,
    midiInputName: null,
    midiOutputName: null,
    midiRequestedProfile: 'auto',
    midiResolvedProfile: 'none',
    feedbackLight: true,
    ledEnabled: true,
    autoPlayEnabled: false,
    autoPlayPlaying: false,
    autoPlayControlsVisible: false,
    autoPlayProgress: 0,
    autoPlayTotal: 0,
    volumeLevel: MAX_VOLUME_LEVEL,
    practiceMode: false,
    stepPractice: false,
    recording: false,
    hideUI: false,
    watermark: true,
    slideMode: false,
    traceLog: false,
    traceLogStyle: 'numbers',
    traceLogSequence: [],
    proLightMode: false,
    criticalError: false,
    theme: getDefaultTheme(),
    autoMappingActive: false,
    autoMappingProgress: 0,
    autoMappingTotal: 0,
  });

  const playMode: PlayMode = !state.autoPlayEnabled ? 'none'
    : !state.practiceMode ? 'autoPlay'
    : !state.stepPractice ? 'guidePlay'
    : 'stepPractice';

  const soundEngineRef = useRef<SoundEngine | null>(null);
  const playbackTicker = useRef<PlaybackTicker | null>(null);
  playbackTicker.current ??= new PlaybackTicker();
  const ledRunnerRef = useRef<LedRunner | null>(null);
  const autoPlayRunnerRef = useRef<AutoPlayRunner | null>(null);
  const channelManagerRef = useRef<ChannelManager | null>(null);
  const midiRef = useRef<MidiConnection | null>(null);
  const recorderRef = useRef<Recorder>(new Recorder());
  const [usageTracker] = useState(() => new PlayUsageTracker(logAnalyticsEvent));
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestRef = useRef<Promise<WakeLockSentinel> | null>(null);
  const chainRef = useRef(0);
  const unipackRef = useRef<UniPackData | null>(null);
  const padStatesRef = useRef<PadState[][]>([]);
  const chainStatesRef = useRef<{ color: string; active: boolean; guide?: boolean }[]>([]);
  const feedbackLightRef = useRef(true);
  const watermarkRef = useRef(true);
  // Read once per visit. A choice made in this visit is newer than anything the read returns.
  const playPreferencesReadRef = useRef<Promise<void> | null>(null);
  const chosenPlayPreferencesRef = useRef(new Set<PlayPreferenceKey>());
  const traceLogRef = useRef(false);
  const traceLogSequenceRef = useRef<{ x: number; y: number }[][]>([]);
  // physical key code -> pad it is holding down ("x,y"), so the release goes to the same pad
  // even if Shift changed in between
  const pressedKeysRef = useRef(new Map<string, [number, number]>());
  const playerHoldsRef = useRef(new PlayerHolds());
  const autoPlayPadsRef = useRef(new Set<string>());
  // pad held on a controller ("x,y") -> the pad, released when its own release can no longer come
  const controllerPadsRef = useRef(new Map<string, [number, number]>());
  // A dialog over the player owns the keyboard; see setKeyboardBlocked.
  const keyboardBlockedRef = useRef(false);
  const interruptedRef = useRef(false);
  const interruptionRevisionRef = useRef(0);
  // Each unload ends the pack load in progress; see loadUniPack.
  const loadRevisionRef = useRef(0);
  const interruptPlaybackRef = useRef<() => void>(() => {});
  const cyclePlayModeRef = useRef<(() => void) | null>(null);
  const toggleAutoPlayRef = useRef<() => void>(() => {});
  const toggleFeedbackLightRef = useRef<() => void>(() => {});
  const toggleLedRef = useRef<() => void>(() => {});
  const toggleHideUiRef = useRef<() => void>(() => {});
  const toggleWatermarkRef = useRef<() => void>(() => {});
  const toggleTraceLogRef = useRef<() => void>(() => {});
  const toggleProLightModeRef = useRef<() => void>(() => {});
  const setVolumeLevelRef = useRef<(level: number) => void>(() => {});
  const midiProfileRef = useRef<LaunchpadProfile>('auto');
  const midiListenerRef = useRef<MidiControllerListener | null>(null);
  const autoPlayListenerRef = useRef<AutoPlayListener | null>(null);
  const volumeLevelRef = useRef(MAX_VOLUME_LEVEL);
  const stateRef = useRef(state);
  const midiOptionPanelOpenRef = useRef(false);
  const midiToggleOptionPanelRef = useRef<(() => void) | null>(null);
  const midiQuitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const requestScreenWakeLock = useCallback(() => {
    const pack = unipackRef.current;
    if (!pack || document.hidden || keyboardBlockedRef.current || wakeLockRef.current || wakeLockRequestRef.current) return;
    const pending = navigator.wakeLock?.request('screen');
    if (!pending) return;
    // Audio authorization can change while this request is pending without invalidating the screen lock.
    // Only a replaced request, pack lifecycle or current screen coverage makes its reply obsolete.
    wakeLockRequestRef.current = pending;
    void pending.then(lock => {
      if (wakeLockRequestRef.current !== pending || pack !== unipackRef.current || document.hidden || keyboardBlockedRef.current) {
        void lock.release().catch(() => {});
        return;
      }
      wakeLockRef.current = lock;
      lock.addEventListener?.('release', () => { if (wakeLockRef.current === lock) wakeLockRef.current = null; });
    }).catch(() => {}).finally(() => {
      if (wakeLockRequestRef.current === pending) wakeLockRequestRef.current = null;
    });
  }, []);

  const syncMidiFunctionLeds = useCallback(() => {
    const midi = midiRef.current;
    if (!midi || !midi.connected) return;

    const current = stateRef.current;
    const cm = channelManagerRef.current;
    const topBar = new Array<number>(8).fill(0);
    if (!midiOptionPanelOpenRef.current || current.hideUI) {
      for (let i = 0; i < 8; i++) {
        topBar[i] = cm ? roundLedCode(cm, i) : 0;
      }
    } else if (!current.hideUI) {
      const unipack = unipackRef.current;
      const sq = unipack?.info.squareButton ?? true;
      // Android: locked 상태면 LED 0 (squareButton=false이거나 기능 미존재)
      topBar[0] = sq ? (current.feedbackLight ? LED_RED : LED_RED_DIM) : 0;
      topBar[1] = (sq && (unipack?.keyLedExist ?? false)) ? (current.ledEnabled ? LED_CYAN : LED_LIGHT_BLUE) : 0;
      topBar[2] = (sq && (unipack?.autoPlayExist ?? false)) ? (current.autoPlayEnabled ? LED_ORANGE : LED_YELLOW) : 0;
      topBar[4] = current.hideUI ? LED_RED : LED_RED_DIM;
      topBar[5] = current.watermark ? LED_GREEN : LED_WARM;
      topBar[6] = current.proLightMode ? LED_BLUE : LED_LAVENDER;
      topBar[7] = LED_RED_BRIGHT;
    }

    for (let i = 0; i < 8; i++) {
      midi.sendFunctionKeyLed(i, topBar[i] ?? 0);
    }

    const volumeLevel = volumeLevelRef.current;
    const volumeRangeStart = 7 - volumeLevel;
    for (let i = 0; i < 8; i++) {
      const c = i + CHAIN_INDEX_OFFSET;
      if (midiOptionPanelOpenRef.current && !current.hideUI) {
        midi.sendFunctionKeyLed(c, volumeLevel > 0 && i >= volumeRangeStart ? LED_BLUE : 0);
      } else {
        midi.sendFunctionKeyLed(c, cm ? roundLedCode(cm, c) : 0);
      }
    }
  }, []);

  const syncMidiStateToDevice = useCallback(() => {
    const midi = midiRef.current;
    const unipack = unipackRef.current;
    const cm = channelManagerRef.current;
    if (!midi || !unipack || !cm || !midi.connected) return;

    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        midi.sendPadLed(x, y, padLedCode(cm, x, y));
      }
    }
    // The ring is addressed by circle index 0..31 (Android redrawAllLaunchpadLeds); the CHAIN
    // channel writes at c + CHAIN_INDEX_OFFSET, so reading chain indices found nothing.
    for (let i = 0; i < CIRCLE_ARRAY_SIZE; i++) {
      midi.sendFunctionKeyLed(i, roundLedCode(cm, i));
    }
    midi.sendFunctionKeyLed(LOGO_FUNCTION_KEY, roundLedCode(cm, LOGO_FUNCTION_KEY));
    syncMidiFunctionLeds();
  }, [syncMidiFunctionLeds]);

  useEffect(() => {
    syncMidiFunctionLeds();
  }, [
    syncMidiFunctionLeds,
    state.feedbackLight,
    state.ledEnabled,
    state.autoPlayEnabled,
    state.hideUI,
    state.watermark,
    state.traceLog,
    state.proLightMode,
    state.volumeLevel,
    state.midiConnected,
  ]);
  const applyMidiStatus = useCallback((status: MidiConnectionStatus) => {
    if (status.connected) {
      syncMidiStateToDevice();
    }
    setState((prev) => ({
      ...prev,
      midiConnected: status.connected,
      midiInputName: status.inputName,
      midiOutputName: status.outputName,
      midiRequestedProfile: status.requestedProfile,
      midiResolvedProfile: status.resolvedProfile,
    }));
  }, [syncMidiStateToDevice]);

  /** Draws a pad's highest-priority light on screen and sends the same light to the launchpad,
   *  as Android's setLedPad; every change to a pad's channels goes through here. */
  const refreshPad = useCallback((x: number, y: number) => {
    const cm = channelManagerRef.current;
    if (!cm) return;
    const item = cm.get(x, y);
    if (padStatesRef.current[x]?.[y]) {
      padStatesRef.current[x][y] = {
        ...padStatesRef.current[x][y],
        color: item ? argbToRgba(item.color) : 'transparent',
        pressedIsWinning: item?.channel === Channel.PRESSED,
      };
    }
    midiRef.current?.sendPadLed(x, y, padLedCode(cm, x, y));
  }, []);

  const updateChainVisual = useCallback((c: number) => {
    const cm = channelManagerRef.current;
    if (!cm) return;
    // The watermark lights only the launchpad, as Android's setLedUIChain draws nothing for it.
    const winner = cm.get(-1, c);
    const item = winner?.channel === Channel.UI_UNIPAD ? null : winner;
    if (chainStatesRef.current[c]) {
      chainStatesRef.current[c] = {
        ...chainStatesRef.current[c],
        color: item ? argbToRgba(item.color) : 'transparent',
        active: c === chainRef.current,
      };
    }
  }, []);

  /** Draws a round button's highest-priority light on screen and sends the same light to the
   *  launchpad, as Android's setLedChain; every change to a round button's channels goes through
   *  here. The open option panel keeps its buttons until syncMidiFunctionLeds redraws them. */
  const refreshChain = useCallback((c: number) => {
    const cm = channelManagerRef.current;
    if (!cm) return;
    updateChainVisual(c);
    if (midiOptionPanelOpenRef.current && !stateRef.current.hideUI && c < OPTION_PANEL_LED_COUNT) return;
    midiRef.current?.sendFunctionKeyLed(c, roundLedCode(cm, c));
  }, [updateChainVisual]);

  const flushVisualState = useCallback(() => {
    setState((prev) => {
      const chains = chainStatesRef.current;
      // A pad-only light must not pull unchanged chain bars into a synchronous commit.
      const sameChains = prev.chainStates.length === chains.length && chains.every((chain, i) => {
        const previous = prev.chainStates[i];
        return chain.color === previous.color && chain.active === previous.active && chain.guide === previous.guide;
      });
      return {
        ...prev,
        padStates: padStatesRef.current.map((row) => row.map((p) => ({ ...p }))),
        chainStates: sameChains ? prev.chainStates : chains.map((chain) => ({ ...chain })),
      };
    });
  }, []);

  const visualFlushRef = useRef<object | null>(null);
  const scheduleFlush = useCallback(() => {
    if (visualFlushRef.current !== null) return;
    const pending = {};
    visualFlushRef.current = pending;
    // Batch a runner tick's lights, then commit in this microtask. A concurrent React
    // render can otherwise wait for another browser task while sound keeps playing.
    queueMicrotask(() => {
      if (visualFlushRef.current !== pending) return;
      visualFlushRef.current = null;
      flushSync(flushVisualState);
    });
  }, [flushVisualState]);

  /** Redraws every round button and the logo after a channel is shown or hidden on them, as
   *  Android's chainBtnsRefresh: the selected chain from the ninth on sits on the bottom and left
   *  columns, and pack lights can sit on any of them. */
  const refreshAllChains = useCallback(() => {
    // chainStates holds circle indices (the selected chain sits at c + CHAIN_INDEX_OFFSET), so a
    // loop over chain indices refreshed the top row and left the chain bar stale.
    for (let i = 0; i < CIRCLE_ARRAY_SIZE; i++) {
      refreshChain(i);
    }
    refreshChain(LOGO_FUNCTION_KEY);
    scheduleFlush();
  }, [refreshChain, scheduleFlush]);

  const applyChainSelectionVisibility = useCallback(() => {
    const cm = channelManagerRef.current;
    if (cm) {
      setRoundLightsVisible(cm, !midiOptionPanelOpenRef.current && watermarkRef.current);
      refreshAllChains();
    }
    syncMidiFunctionLeds();
  }, [refreshAllChains, syncMidiFunctionLeds]);

  useEffect(() => {
    applyChainSelectionVisibility();
  }, [applyChainSelectionVisibility, state.watermark]);

  const setChain = useCallback((c: number) => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    const next = changeChain(unipack, c, soundEngineRef.current);
    if (next === null) return;
    c = next;

    const prevChain = chainRef.current;
    chainRef.current = c;

    recorderRef.current.recordChain(c);

    const cm = channelManagerRef.current;
    if (cm) {
      cm.remove(-1, prevChain + CHAIN_INDEX_OFFSET, Channel.CHAIN);
      cm.add(-1, c + CHAIN_INDEX_OFFSET, Channel.CHAIN, -1, 3);
      refreshChain(prevChain + CHAIN_INDEX_OFFSET);
      refreshChain(c + CHAIN_INDEX_OFFSET);
    }

    setState((prev) => ({ ...prev, chain: c }));
    scheduleFlush();
  }, [refreshChain, scheduleFlush]);

  const selectChain = useCallback((c: number) => {
    const unipack = unipackRef.current;
    if (!unipack || !Number.isInteger(c) || c < 0 || c >= unipack.info.chain) return;
    soundEngineRef.current?.cancelPendingChainChanges();
    setChain(c);
  }, [setChain]);

  const applyVolumeLevel = useCallback((level: number) => {
    const next = clampVolumeLevel(level);
    volumeLevelRef.current = next;
    soundEngineRef.current?.setVolume(next, MAX_VOLUME_LEVEL);
    setState((prev) => ({ ...prev, volumeLevel: next }));
  }, []);

  const applyWatermark = useCallback((enabled: boolean) => {
    watermarkRef.current = enabled;
    setState((prev) => ({ ...prev, watermark: enabled }));
  }, []);

  const readPlayPreferences = useCallback(() => {
    playPreferencesReadRef.current ??= Promise.allSettled(PLAY_PREFERENCE_KEYS.map((key) => getSetting(key)))
      .then((results) => {
        const saved = (key: PlayPreferenceKey) => {
          if (chosenPlayPreferencesRef.current.has(key)) return null;
          const result = results[PLAY_PREFERENCE_KEYS.indexOf(key)];
          return result.status === 'fulfilled' ? result.value : null;
        };
        const volumeLevel = parseVolumeLevel(saved('volumeLevel'));
        if (volumeLevel !== null) applyVolumeLevel(volumeLevel);
        const watermark = parseBoolean(saved('watermark'));
        if (watermark !== null) applyWatermark(watermark);
        const slideMode = parseBoolean(saved('slideMode'));
        const traceLogStyle = parseTraceLogStyle(saved('traceLogStyle'));
        setState((prev) => ({
          ...prev,
          slideMode: slideMode ?? prev.slideMode,
          traceLogStyle: traceLogStyle ?? prev.traceLogStyle,
        }));
      });
    return playPreferencesReadRef.current;
  }, [applyVolumeLevel, applyWatermark]);

  const choosePlayPreference = useCallback((key: PlayPreferenceKey, value: string) => {
    chosenPlayPreferencesRef.current.add(key);
    setSetting(key, value).catch(() => {});
  }, []);

  /** `input` names what holds the pad (a pointer, a key, the Launchpad, auto-play); see SoundEngine.soundOn. */
  const padTouchOn = useCallback((x: number, y: number, input?: string, eventAt = performance.now()) => {
    if (document.hidden || keyboardBlockedRef.current || (interruptedRef.current && autoPlayRunnerRef.current?.active)) return;
    const se = soundEngineRef.current;
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;

    if (autoPlayRunnerRef.current?.stepMode) {
      autoPlayRunnerRef.current.stepPadPressed(x, y);
    }

    // Each contact owns its sound and pack lights; only the pressed overlay shares holds.
    if (input === AUTO_PLAY_INPUT) autoPlayPadsRef.current.add(`${x},${y}`);
    se?.soundOn(x, y, input);
    lr?.eventOn(x, y, eventAt, input);
    recorderRef.current.recordOn(x, y);

    if (traceLogRef.current) {
      const chain = chainRef.current;
      const seq = traceLogSequenceRef.current[chain];
      if (seq) {
        seq.push({ x, y });
        setState((prev) => ({
          ...prev,
          traceLogSequence: traceLogSequenceRef.current.map((s) => [...s]),
        }));
      }
    }

    if (cm && feedbackLightRef.current) {
      cm.add(x, y, Channel.PRESSED, -1, 3);
      refreshPad(x, y);
    }

    if (padStatesRef.current[x]?.[y]) {
      padStatesRef.current[x][y] = { ...padStatesRef.current[x][y], pressed: true };
    }

    scheduleFlush();
  }, [refreshPad, scheduleFlush]);

  /** A pad pressed by the player; autoplay presses pads through `padTouchOn` directly. */
  const userPadTouchOn = useCallback((x: number, y: number, source: PadInputSource, input: string) => {
    if (document.hidden || keyboardBlockedRef.current || (interruptedRef.current && autoPlayRunnerRef.current?.active)) return;
    if (!autoPlayRunnerRef.current?.active) {
      if (stateRef.current.ledEnabled) ledRunnerRef.current?.launch();
    }
    usageTracker.padPressed(source);
    playerHoldsRef.current.press(x, y);
    padTouchOn(x, y, input);
  }, [usageTracker, padTouchOn]);

  /** A pad pressed on screen, by touch or mouse. */
  const screenPadTouchOn = useCallback((x: number, y: number, input: string) => {
    userPadTouchOn(x, y, 'screen', input);
  }, [userPadTouchOn]);

  /** Without `input`, every press of the pad is released. */
  const padTouchOff = useCallback((x: number, y: number, input?: string, eventAt = performance.now()) => {
    const se = soundEngineRef.current;
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;

    if (input === AUTO_PLAY_INPUT || input === undefined) autoPlayPadsRef.current.delete(`${x},${y}`);
    se?.soundOff(x, y, input);
    lr?.eventOff(x, y, eventAt, input);
    recorderRef.current.recordOff(x, y);

    if (playerHoldsRef.current.isHeld(x, y) || autoPlayPadsRef.current.has(`${x},${y}`)) return;

    // A pad pressed with the press light off has nothing to clear on the launchpad.
    if (cm?.remove(x, y, Channel.PRESSED)) refreshPad(x, y);

    if (padStatesRef.current[x]?.[y]) {
      padStatesRef.current[x][y] = {
        ...padStatesRef.current[x][y],
        pressed: false,
        pressedIsWinning: false,
      };
    }

    scheduleFlush();
  }, [refreshPad, scheduleFlush]);

  /** The player's last release of a pad autoPlay stopped over also ends autoPlay's press there. */
  const userPadTouchOff = useCallback((x: number, y: number, input: string) => {
    const releasesAutoPlay = playerHoldsRef.current.release(x, y);
    padTouchOff(x, y, releasesAutoPlay ? undefined : input);
  }, [padTouchOff]);

  const releaseKeyboardPads = useCallback(() => {
    for (const [code, pad] of pressedKeysRef.current) userPadTouchOff(pad[0], pad[1], keyInput(code));
    pressedKeysRef.current.clear();
  }, [userPadTouchOff]);

  /** A controller sends no release for the pads it holds once it is disconnected, unplugged or its
   *  option panel takes its pads, and after a change of model its releases are read as other pads,
   *  so they are released here. */
  const releaseControllerPads = useCallback(() => {
    for (const [x, y] of controllerPadsRef.current.values()) userPadTouchOff(x, y, MIDI_INPUT);
    controllerPadsRef.current.clear();
  }, [userPadTouchOff]);

  /** The connection reports its status whenever a controller comes or goes, one of several too, and
   *  when the model changes, so the pads held before are released. */
  const applyControllerStatus = useCallback((status: MidiConnectionStatus) => {
    if (status.releaseHeldPads !== false) releaseControllerPads();
    applyMidiStatus(status);
  }, [releaseControllerPads, applyMidiStatus]);

  /** While a dialog is open its keys (Space on a button, typing, clicks on its text leaving focus on
   *  the body) must not play pads, switch chains or toggle auto-play behind it. Pads held when it
   *  opens are released, since their keyup may land in the dialog. */
  const setKeyboardBlocked = useCallback((blocked: boolean) => {
    keyboardBlockedRef.current = blocked;
    if (blocked) interruptPlaybackRef.current();
    else if (!document.hidden) {
      void soundEngineRef.current?.setSuspended(false).catch(() => {});
      requestScreenWakeLock();
      syncMidiStateToDevice();
    }
  }, [requestScreenWakeLock, syncMidiStateToDevice]);

  // Keyboard input handler
  useEffect(() => {
    const unipack = unipackRef.current;
    if (!unipack || !state.loaded) return;

    const { buttonX, buttonY } = unipack.info;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || keyboardBlockedRef.current) return;
      // Alt/Ctrl/Meta chords belong to PlayPage's shortcuts (alt+a = autoPlay); on Windows/Linux
      // Alt+A still reports key 'a' and used to press pad [2,0] as well.
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      // Chain switching
      const chainIdx = getChainKey(e.key);
      if (chainIdx !== null && chainIdx < (unipackRef.current?.info.chain ?? 0)) {
        e.preventDefault();
        selectChain(chainIdx);
        return;
      }

      // Space = toggle AutoPlay
      if (e.key === ' ') {
        e.preventDefault();
        toggleAutoPlayRef.current();
        return;
      }

      const pad = getPadForKeyCode(e.code, e.shiftKey, buttonX, buttonY);
      if (pad && !pressedKeysRef.current.has(e.code)) {
        e.preventDefault();
        pressedKeysRef.current.set(e.code, pad);
        userPadTouchOn(pad[0], pad[1], 'keyboard', keyInput(e.code));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const pad = pressedKeysRef.current.get(e.code);
      if (pad) {
        pressedKeysRef.current.delete(e.code);
        userPadTouchOff(pad[0], pad[1], keyInput(e.code));
      }
    };

    // Alt-Tab or a hidden tab swallows the keyup; without this the pad (and an infinite-loop
    // sample) stayed on.
    const handleBlur = () => releaseKeyboardPads();
    const handleVisibility = () => { if (document.hidden) releaseKeyboardPads(); };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      releaseKeyboardPads();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [state.loaded, userPadTouchOn, releaseKeyboardPads, userPadTouchOff, selectChain]);

  /** Releases every pad the player is not holding, which includes each pad autoplay still holds. */
  const padInit = useCallback(() => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    playerHoldsRef.current.releaseOthers(unipack.info.buttonX, unipack.info.buttonY, padTouchOff);
  }, [padTouchOff]);

  const ledInit = useCallback(() => {
    const unipack = unipackRef.current;
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;
    if (!unipack || !cm) return;
    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        if (lr) lr.eventOff(x, y);
        cm.remove(x, y, Channel.LED);
        refreshPad(x, y);
      }
    }
    const chainLedCount = Math.max(unipack.info.chain, 36);
    for (let c = 0; c < chainLedCount; c++) {
      if (lr) lr.eventOff(-1, c);
      cm.remove(-1, c, Channel.LED);
      refreshChain(c);
    }
    scheduleFlush();
  }, [refreshPad, refreshChain, scheduleFlush]);

  const autoPlayRemoveGuide = useCallback(() => {
    const unipack = unipackRef.current;
    const cm = channelManagerRef.current;
    if (!unipack || !cm) return;
    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        cm.remove(x, y, Channel.GUIDE);
        refreshPad(x, y);
        if (padStatesRef.current[x]?.[y]) {
          padStatesRef.current[x][y] = {
            ...padStatesRef.current[x][y],
            guide: false,
            guideTargetWallTimeMs: null,
          };
        }
      }
    }
    const cirLedCount = Math.max(unipack.info.chain + CHAIN_INDEX_OFFSET, 36);
    for (let cirIdx = 0; cirIdx < cirLedCount; cirIdx++) {
      cm.remove(-1, cirIdx, Channel.GUIDE);
      if (chainStatesRef.current[cirIdx]) {
        chainStatesRef.current[cirIdx] = { ...chainStatesRef.current[cirIdx], guide: false };
      }
      refreshChain(cirIdx);
    }
    scheduleFlush();
  }, [refreshPad, refreshChain, scheduleFlush]);

  const interruptPlayback = useCallback(() => {
    const interruptedAt = performance.now();
    interruptedRef.current = true;
    interruptionRevisionRef.current++;
    const sound = soundEngineRef.current;
    // Mute first, before callbacks or rendering can delay the request.
    void sound?.setSuspended(true).catch(() => {});
    sound?.stopAll();
    autoPlayRunnerRef.current?.setSuspended(true, 0, interruptedAt);
    autoPlayRunnerRef.current?.clearGuideOutput();
    ledRunnerRef.current?.stop();
    playerHoldsRef.current.clear();
    pressedKeysRef.current.clear();
    controllerPadsRef.current.clear();
    const pack = unipackRef.current;
    if (pack) for (let x = 0; x < pack.info.buttonX; x++) {
      for (let y = 0; y < pack.info.buttonY; y++) padTouchOff(x, y);
    }
    ledInit();
    autoPlayRemoveGuide();
    setState(prev => ({ ...prev, autoPlayPlaying: false }));
    midiRef.current?.clearAllLeds();
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, [padTouchOff, ledInit, autoPlayRemoveGuide]);
  interruptPlaybackRef.current = interruptPlayback;

  const activatePlaybackAudio = useCallback(async () => {
    if (document.hidden || keyboardBlockedRef.current) return false;
    const revision = ++interruptionRevisionRef.current;
    const sound = soundEngineRef.current;
    if (!sound) return false;
    try { await sound.setSuspended(false); } catch { return false; }
    const ready = revision === interruptionRevisionRef.current && sound === soundEngineRef.current &&
      !document.hidden && !keyboardBlockedRef.current && sound.context.state === 'running';
    if (ready) requestScreenWakeLock();
    return ready;
  }, [requestScreenWakeLock]);

  const applyModeFlags = useCallback((runner: InstanceType<typeof AutoPlayRunner>, targetMode: PlayMode) => {
    if (targetMode === 'autoPlay' || targetMode === 'guidePlay') {
      autoPlayRemoveGuide();
      runner.play(targetMode === 'guidePlay');
    } else if (targetMode === 'stepPractice') {
      runner.practiceGuide = true;
      runner.playmode = false;
      runner.stepMode = true;
    }
  }, [autoPlayRemoveGuide]);

  const switchPlayMode = useCallback(async (targetMode: PlayMode) => {
    const runner = autoPlayRunnerRef.current;
    if (!runner) return;
    const unipack = unipackRef.current;
    const prev = stateRef.current;

    const currentMode: PlayMode = !prev.autoPlayEnabled ? 'none'
      : !prev.practiceMode ? 'autoPlay'
      : !prev.stepPractice ? 'guidePlay'
      : 'stepPractice';

    const mode = targetMode === currentMode ? 'none' : targetMode;
    if (mode === 'autoPlay') usageTracker.autoplayStarted();

    if (mode === 'none') {
      interruptionRevisionRef.current++;
      runner.practiceGuide = false;
      runner.stepMode = false;
      runner.resetStepState();
      runner.pause();
      if (runner.active) runner.stop();
      padInit();
      ledInit();
      autoPlayRemoveGuide();
      const feedback = !unipack?.keyLedExist;
      feedbackLightRef.current = feedback;
      setState((s) => ({
        ...s,
        autoPlayEnabled: false, autoPlayPlaying: false, autoPlayControlsVisible: false,
        autoPlayProgress: 0, practiceMode: false,
        ledEnabled: unipack?.keyLedExist ? true : s.ledEnabled,
        feedbackLight: feedback,
      }));
      return;
    }

    if (!await activatePlaybackAudio()) return;
    interruptedRef.current = false;
    runner.setSuspended(false);
    ledRunnerRef.current?.setSuspended(false);
    if (stateRef.current.ledEnabled) ledRunnerRef.current?.launch();

    const isPractice = mode === 'guidePlay' || mode === 'stepPractice';
    const isPlaying = mode !== 'stepPractice';

    if (!runner.active) {
      applyModeFlags(runner, mode);
      runner.launch();
      if (unipack?.keyLedExist) {
        feedbackLightRef.current = false;
        if (!prev.ledEnabled) ledRunnerRef.current?.launch();
      } else {
        feedbackLightRef.current = true;
      }
      setState((s) => ({
        ...s,
        autoPlayEnabled: true, autoPlayPlaying: isPlaying,
        autoPlayControlsVisible: unipack?.info.squareButton ?? false,
        practiceMode: isPractice, stepPractice: mode === 'stepPractice',
        ledEnabled: unipack?.keyLedExist ? true : s.ledEnabled,
        feedbackLight: !unipack?.keyLedExist,
      }));
    } else {
      // Guide and step practice do not press pads, so autoplay would never release what it holds.
      if (!stateRef.current.practiceMode) padInit();
      applyModeFlags(runner, mode);
      setState((s) => ({ ...s, autoPlayPlaying: isPlaying, practiceMode: isPractice, stepPractice: mode === 'stepPractice' }));
    }
  }, [usageTracker, padInit, ledInit, autoPlayRemoveGuide, applyModeFlags, activatePlaybackAudio]);
  toggleAutoPlayRef.current = () => switchPlayMode('autoPlay');

  /** none -> autoPlay -> guidePlay -> stepPractice -> none, as Android's cyclePlayMode. */
  const cyclePlayMode = useCallback(() => {
    const current: PlayMode = !stateRef.current.autoPlayEnabled ? 'none'
      : !stateRef.current.practiceMode ? 'autoPlay'
      : !stateRef.current.stepPractice ? 'guidePlay'
      : 'stepPractice';
    const next: PlayMode = current === 'none' ? 'autoPlay'
      : current === 'autoPlay' ? 'guidePlay'
      : current === 'guidePlay' ? 'stepPractice'
      : 'none';
    switchPlayMode(next === 'none' ? current : next);
  }, [switchPlayMode]);
  cyclePlayModeRef.current = cyclePlayMode;

  const autoPlayPlayPause = useCallback(async () => {
    const runner = autoPlayRunnerRef.current;
    const unipack = unipackRef.current;
    if (!runner || !runner.active) return;
    if (interruptedRef.current) {
      if (!await activatePlaybackAudio()) return;
      interruptedRef.current = false;
      runner.setSuspended(false);
      if (!runner.isPlaying && !runner.stepMode) runner.play();
      ledRunnerRef.current?.setSuspended(false);
      runner.restoreGuideOutput();
      syncMidiStateToDevice();
      if (stateRef.current.ledEnabled) ledRunnerRef.current?.launch();
      setState(prev => ({ ...prev, autoPlayPlaying: runner.isPlaying }));
      return;
    }
    if (runner.isPlaying) {
      runner.pause();
      padInit();
      ledInit();
      autoPlayRemoveGuide();
      if (stateRef.current.practiceMode) {
        runner.stepMode = true;
      }
      setState((prev) => ({ ...prev, autoPlayPlaying: false, stepPractice: prev.practiceMode }));
    } else {
      if (!await activatePlaybackAudio()) return;
      autoPlayRemoveGuide();
      padInit();
      ledInit();
      runner.play();
      if (unipack?.keyLedExist) {
        feedbackLightRef.current = false;
        if (!stateRef.current.ledEnabled) ledRunnerRef.current?.launch();
      } else {
        feedbackLightRef.current = true;
      }
      setState((prev) => ({
        ...prev,
        autoPlayPlaying: true,
        stepPractice: false,
        ledEnabled: unipack?.keyLedExist ? true : prev.ledEnabled,
        feedbackLight: !unipack?.keyLedExist,
      }));
    }
  }, [padInit, ledInit, autoPlayRemoveGuide, activatePlaybackAudio, syncMidiStateToDevice]);

  const autoPlayPrev = useCallback(() => {
    padInit();
    ledInit();
    autoPlayRemoveGuide();
    autoPlayRunnerRef.current?.progressOffset(-40);
  }, [padInit, ledInit, autoPlayRemoveGuide]);

  const autoPlayNext = useCallback(() => {
    padInit();
    ledInit();
    autoPlayRemoveGuide();
    autoPlayRunnerRef.current?.progressOffset(40);
  }, [padInit, ledInit, autoPlayRemoveGuide]);

  const unload = useCallback(() => {
    usageTracker.unloaded();
    loadRevisionRef.current++;
    interruptionRevisionRef.current++;
    interruptedRef.current = false;
    soundEngineRef.current?.destroy();
    playerHoldsRef.current.clear();
    autoPlayPadsRef.current.clear();
    pressedKeysRef.current.clear();
    recorderRef.current = new Recorder();
    traceLogRef.current = false;
    traceLogSequenceRef.current = [];
    autoPlayListenerRef.current = null;
    chainRef.current = 0;
    controllerPadsRef.current.clear();
    ledRunnerRef.current?.stop();
    autoPlayRunnerRef.current?.stop();
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    wakeLockRequestRef.current = null;
    soundEngineRef.current = null;
    ledRunnerRef.current = null;
    autoPlayRunnerRef.current = null;
    channelManagerRef.current = null;
    unipackRef.current = null;
    midiRef.current?.release();
    midiRef.current = null;
    midiListenerRef.current = null;
    setState((prev) => {
      if (prev.theme) releaseThemeUrls(prev.theme);
      return {
        ...prev,
        autoPlayEnabled: false,
        autoPlayPlaying: false,
        autoPlayControlsVisible: false,
        autoPlayProgress: 0,
        autoPlayTotal: 0,
        practiceMode: false,
        stepPractice: false,
        proLightMode: false,
        recording: false,
        traceLog: false,
        traceLogSequence: [],
        autoMappingActive: false,
        autoMappingProgress: 0,
        autoMappingTotal: 0,
        hideUI: false,
        chain: 0,
        loaded: false,
        loading: false,
        unipack: null,
        padStates: [],
        chainStates: [],
        errors: [],
        midiConnected: false,
        midiInputName: null,
        midiOutputName: null,
        midiRequestedProfile: midiProfileRef.current,
        midiResolvedProfile: 'none',
        theme: getDefaultTheme(),
      };
    });
  }, [usageTracker]);

  /**
   * Resolves false when the pack could not be opened; the reason is left in `errors`. Resolves null
   * when a later load or a quit replaced this one: the player belongs to that, so leave it alone.
   */
  const loadUniPack = useCallback(async (zipData: ArrayBuffer): Promise<boolean | null> => {
    unload();
    // A later load or a quit unloads this one, and that unload already destroyed the sound engine
    // this load made. Going on would set up a second pack whose keyboard and timers nobody owns.
    const revision = loadRevisionRef.current;
    const superseded = () => revision !== loadRevisionRef.current;
    const playPreferences = readPlayPreferences();

    setState((prev) => ({ ...prev, loading: true, loadProgress: 0, loadPhase: 'Reading archive...', errors: [] }));

    try {
      const unipack = await parseUniPack(zipData, (phase) => {
        if (!superseded()) setState((prev) => ({ ...prev, loadPhase: phase }));
      });
      // Nothing plays before a lowered volume is known: opening a pack must not raise it.
      await playPreferences;
      if (superseded()) return null;
      unipackRef.current = unipack;

      const { buttonX, buttonY, chain: chainCount } = unipack.info;

      padStatesRef.current = Array.from({ length: buttonX }, () =>
        Array.from({ length: buttonY }, () => ({
          color: 'transparent',
          pressed: false,
          pressedIsWinning: false,
          guide: false,
          guideTargetWallTimeMs: null,
        })),
      );
      chainStatesRef.current = Array.from({ length: CIRCLE_ARRAY_SIZE }, (_, i) => ({
        color: 'transparent',
        active: i === CHAIN_INDEX_OFFSET,
        guide: false,
      }));

      traceLogSequenceRef.current = Array.from({ length: chainCount }, () => []);

      const cm = new ChannelManager(buttonX, buttonY);
      channelManagerRef.current = cm;
      chainRef.current = 0;
      cm.add(-1, CHAIN_INDEX_OFFSET, Channel.CHAIN, -1, 3);
      for (const [c, code] of WATERMARK_LEDS) cm.add(-1, c, Channel.UI_UNIPAD, -1, code);
      setRoundLightsVisible(cm, !midiOptionPanelOpenRef.current && watermarkRef.current);
      // Android: proLightMode defaults to false → LED channel ignored on chain buttons
      cm.setCirIgnore(Channel.LED, true);

      setState((prev) => ({ ...prev, loadPhase: 'Loading audio...' }));

      const soundEngine = new SoundEngine(
        unipack,
        () => chainRef.current,
        setChain,
        (loaded, total) => {
          if (superseded()) return;
          setState((prev) => ({
            ...prev,
            loadProgress: Math.round((loaded / total) * 100),
            loadPhase: `Loading audio... (${loaded}/${total})`,
          }));
        },
      );
      soundEngineRef.current = soundEngine;
      const failedSounds = await soundEngine.load();
      if (superseded()) return null;
      soundEngine.setVolume(volumeLevelRef.current, MAX_VOLUME_LEVEL);

      soundEngine.onInterrupted = () => interruptPlaybackRef.current();
      const soundWarnings = failedSounds.length > 0 ? [`${failedSounds.length} audio file(s) failed to decode`] : [];
      if (failedSounds.length > 0 && failedSounds.length === unipack.soundFiles.size) {
        throw new Error(soundWarnings[0]);
      }

      const ledListener: LedRunnerListener = {
        onPadLedTurnOn: (x: number, y: number, color: number, velocity: number) => {
          cm.add(x, y, Channel.LED, color, velocity);
          refreshPad(x, y);
          scheduleFlush();
        },
        onPadLedTurnOff: (x: number, y: number) => {
          cm.remove(x, y, Channel.LED);
          refreshPad(x, y);
          scheduleFlush();
        },
        // `c` is a circle index (keyLed `o * n`), which Android sends with sendFunctionKeyLed;
        // sendChainLed added 8 and dropped indices above 7.
        onChainLedTurnOn: (c: number, color: number, velocity: number) => {
          cm.add(-1, c, Channel.LED, color, velocity);
          refreshChain(c);
          scheduleFlush();
        },
        onChainLedTurnOff: (c: number) => {
          cm.remove(-1, c, Channel.LED);
          refreshChain(c);
          scheduleFlush();
        },
      };

      const ledRunner = new LedRunner(
        unipack,
        ledListener,
        () => chainRef.current,
        setChain,
        playbackTicker.current!,
      );
      ledRunner.setSuspended(document.hidden);
      ledRunnerRef.current = ledRunner;

      if (unipack.keyLedExist) {
        ledRunner.launch();
      }

      if (unipack.autoPlayExist && unipack.autoPlay) {
        const autoPlayListener: AutoPlayListener = {
          onStart: () => {
            const current = stateRef.current;
            const startingMode: PlayMode = !current.autoPlayEnabled ? 'none'
              : !current.practiceMode ? 'autoPlay'
              : !current.stepPractice ? 'guidePlay'
              : 'stepPractice';

            if (startingMode === 'stepPractice') {
              autoPlayRunnerRef.current?.pause();
              if (autoPlayRunnerRef.current) {
                autoPlayRunnerRef.current.stepMode = true;
              }
            }

            setState((prev) => ({
              ...prev,
              autoPlayControlsVisible: unipack.info.squareButton,
              autoPlayProgress: 0,
              autoPlayTotal: unipack.autoPlay?.elements.length ?? 0,
              autoPlayPlaying: startingMode === 'stepPractice' ? false : prev.autoPlayPlaying,
            }));
          },
          onPadTouchOn: (x: number, y: number, pressedAt: number) => {
            playerHoldsRef.current.autoPlayPressed(x, y);
            padTouchOn(x, y, AUTO_PLAY_INPUT, pressedAt);
          },
          onPadTouchOff: (x: number, y: number, releasedAt: number) => { padTouchOff(x, y, AUTO_PLAY_INPUT, releasedAt); },
          onChainChange: (c: number) => { setChain(c); },
          onGuidePadOn: (x: number, y: number, targetWallTimeMs: number) => {
            cm.add(x, y, Channel.GUIDE, -1, 17);
            refreshPad(x, y);
            if (padStatesRef.current[x]?.[y]) {
              padStatesRef.current[x][y] = {
                ...padStatesRef.current[x][y],
                guide: true,
                guideTargetWallTimeMs: targetWallTimeMs,
              };
            }
            scheduleFlush();
          },
          onGuidePadOff: (x: number, y: number) => {
            cm.remove(x, y, Channel.GUIDE);
            refreshPad(x, y);
            if (padStatesRef.current[x]?.[y]) {
              padStatesRef.current[x][y] = {
                ...padStatesRef.current[x][y],
                guide: false,
                guideTargetWallTimeMs: null,
              };
            }
            scheduleFlush();
          },
          // The countdown ramp goes to the launchpad only, as on Android; writing it into the
          // GUIDE channel faded the on-screen guide pad from orange to white and green.
          onGuideLedUpdate: (x: number, y: number, velocity: number) => {
            midiRef.current?.sendPadLed(x, y, velocity);
          },
          onGuideChainOn: (c: number) => {
            const cirIdx = c + CHAIN_INDEX_OFFSET;
            cm.add(-1, cirIdx, Channel.GUIDE, -1, 17);
            if (chainStatesRef.current[cirIdx]) {
              chainStatesRef.current[cirIdx] = { ...chainStatesRef.current[cirIdx], guide: true };
            }
            refreshChain(cirIdx);
            scheduleFlush();
          },
          onRemoveGuide: () => {
            autoPlayRemoveGuide();
          },
          onProgressUpdate: (progress: number) => {
            setState((prev) => ({ ...prev, autoPlayProgress: progress }));
          },
          onEnd: () => {
            if (autoPlayRunnerRef.current) {
              autoPlayRunnerRef.current.practiceGuide = false;
              // stepMode stayed on, so pad presses were still consumed as step input.
              autoPlayRunnerRef.current.stepMode = false;
              autoPlayRunnerRef.current.resetStepState();
            }
            for (let x = 0; x < unipack.info.buttonX; x++) {
              for (let y = 0; y < unipack.info.buttonY; y++) padTouchOff(x, y, AUTO_PLAY_INPUT);
            }
            autoPlayRemoveGuide();
            const feedback = !unipack.keyLedExist;
            feedbackLightRef.current = feedback;
            setState((prev) => ({
              ...prev,
              autoPlayEnabled: false,
              autoPlayPlaying: false,
              autoPlayControlsVisible: false,
              autoPlayProgress: 0,
              practiceMode: false,
              stepPractice: false,
              ledEnabled: unipack.keyLedExist ? true : prev.ledEnabled,
              feedbackLight: feedback,
            }));
            if (unipack.keyLedExist) ledRunnerRef.current?.launch();
          },
        };

        const soundPushToNum = (c: number, x: number, y: number, num: number) => {
          soundEngine.soundPushToNum(c, x, y, num);
        };

        autoPlayListenerRef.current = autoPlayListener;
        const autoPlayRunner = new AutoPlayRunner(
          unipack,
          autoPlayListener,
          () => chainRef.current,
          setChain,
          soundPushToNum,
          (c, x, y, num) => ledPushToNum(unipack, c, x, y, num),
          playbackTicker.current!,
        );
        autoPlayRunner.setSuspended(document.hidden);
        autoPlayRunnerRef.current = autoPlayRunner;

        setState((prev) => ({
          ...prev,
          autoPlayTotal: unipack.autoPlay!.elements.length,
        }));
      }

      // Android initSetting(): keyLedExist에 따라 초기 상태 설정
      const initFeedbackLight = !unipack.keyLedExist;
      const initLedEnabled = unipack.keyLedExist;
      feedbackLightRef.current = initFeedbackLight;

      setState((prev) => {
        if (prev.theme) releaseThemeUrls(prev.theme);
        return {
          ...prev,
          loaded: true,
          loading: false,
          loadPhase: '',
          unipack,
          chain: 0,
          padStates: padStatesRef.current.map((row) => row.map((p) => ({ ...p }))),
          chainStates: chainStatesRef.current.map((c) => ({ ...c })),
          errors: [...unipack.errors, ...soundWarnings],
          criticalError: false,
          traceLogSequence: traceLogSequenceRef.current.map((seq) => [...seq]),
          feedbackLight: initFeedbackLight,
          ledEnabled: initLedEnabled,
          midiConnected: false,
          midiInputName: null,
          midiOutputName: null,
          midiRequestedProfile: midiProfileRef.current,
          midiResolvedProfile: 'none',
          theme: getDefaultTheme(),
        };
      });

      usageTracker.packLoadSucceeded();

      requestScreenWakeLock();

      // MIDI 연결은 비동기로 처리 (권한 다이얼로그가 로딩을 차단하지 않도록)
      const midi = new MidiConnection();
      midiRef.current = midi;
      const midiListener: MidiControllerListener = {
        onPadTouch: (x: number, y: number, pressed: boolean) => {
          if (midiOptionPanelOpenRef.current) return;
          const info = unipackRef.current?.info;
          if (!info || x < 0 || y < 0 || x >= info.buttonX || y >= info.buttonY) return;
          const pads = controllerPadsRef.current;
          const key = `${x},${y}`;
          if (pressed) {
            // A press without a release in between replaces the first, as in the sound engine.
            if (pads.has(key)) userPadTouchOff(x, y, MIDI_INPUT);
            pads.set(key, [x, y]);
            userPadTouchOn(x, y, 'midi', MIDI_INPUT);
          } else if (pads.delete(key)) {
            userPadTouchOff(x, y, MIDI_INPUT);
          }
        },
        onChainTouch: (c: number) => {
          if (midiOptionPanelOpenRef.current) return;
          selectChain(c);
        },
        onResync: syncMidiStateToDevice,
        onFunctionKey: (key: number) => {
          if (!midiOptionPanelOpenRef.current) {
            switch (key) {
              case 0: toggleFeedbackLightRef.current(); break;
              case 1: toggleLedRef.current(); break;
              // Cycles none -> autoPlay -> guidePlay -> stepPractice like Android/iOS; it used to
              // toggle autoPlay only, so the hardware could never reach guide or step practice.
              case 2: cyclePlayModeRef.current?.(); break;
              case 3: midiToggleOptionPanelRef.current?.(); break;
              case 4:
              case 5:
              case 6:
              case 7:
                toggleWatermarkRef.current();
                break;
            }
            return;
          }

          switch (key) {
            case 0: toggleFeedbackLightRef.current(); break;
            case 1: toggleLedRef.current(); break;
            case 2: cyclePlayModeRef.current?.(); break;
            case 3: midiToggleOptionPanelRef.current?.(); break;
            case 4: toggleHideUiRef.current(); break;
            case 5: toggleWatermarkRef.current(); break;
            case 6: toggleProLightModeRef.current(); break;
            case 7: midiQuitRef.current?.(); break;
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
              setVolumeLevelRef.current(15 - key);
              break;
          }
        },
      };
      midiListenerRef.current = midiListener;
      midi.connect(midiListener, {
        profile: midiProfileRef.current,
        onStatusChange: status => { if (midiRef.current === midi) applyControllerStatus(status); },
      });
      return true;
    } catch (err) {
      if (superseded()) return null;
      console.error('Failed to load UniPack:', err);
      usageTracker.packLoadFailed();
      setState((prev) => ({
        ...prev,
        loading: false,
        criticalError: true,
        errors: [err instanceof Error ? err.message : String(err)],
      }));
      return false;
    }
  }, [
    unload,
    readPlayPreferences,
    setChain,
    selectChain,
    usageTracker,
    padTouchOn,
    userPadTouchOn,
    userPadTouchOff,
    padTouchOff,
    refreshPad,
    refreshChain,
    scheduleFlush,
    autoPlayRemoveGuide,
    applyControllerStatus,
    requestScreenWakeLock,
    syncMidiStateToDevice,
  ]);

  const applyFeedbackLight = useCallback((enabled: boolean) => {
    if (feedbackLightRef.current !== enabled) padInit();
    feedbackLightRef.current = enabled;
    setState((prev) => ({ ...prev, feedbackLight: enabled }));
  }, [padInit]);

  /** Not saved: each pack opens, and each auto-play ends, with the pack's own rule (light off
   *  when the pack has its own lights), so a choice lasts until then. */
  const setFeedbackLight = applyFeedbackLight;

  const toggleFeedbackLight = useCallback(() => {
    setFeedbackLight(!feedbackLightRef.current);
  }, [setFeedbackLight]);
  toggleFeedbackLightRef.current = toggleFeedbackLight;

  const setVolumeLevel = useCallback((level: number) => {
    applyVolumeLevel(level);
    choosePlayPreference('volumeLevel', String(volumeLevelRef.current));
  }, [applyVolumeLevel, choosePlayPreference]);
  setVolumeLevelRef.current = setVolumeLevel;

  const toggleLed = useCallback(() => {
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;
    if (!lr || !cm) return;

    setState((prev) => {
      const newEnabled = !prev.ledEnabled;
      if (newEnabled) {
        lr.launch();
      } else {
        lr.stop();
        ledInit();
      }
      return { ...prev, ledEnabled: newEnabled };
    });
  }, [ledInit]);
  toggleLedRef.current = toggleLed;

  const toggleRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder.recording) {
      recorder.stop();
      const autoPlayText = recorder.exportAsAutoPlay();
      // Android: 클립보드에 복사 + 파일 다운로드
      navigator.clipboard?.writeText(autoPlayText).catch(() => {});
      const blob = new Blob([autoPlayText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'autoPlay';
      // Firefox needs the anchor in the document, and revoking synchronously after click() let
      // Firefox/Safari abort the download before it started.
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
      setState((prev) => ({ ...prev, recording: false }));
    } else {
      recorder.start(chainRef.current);
      setState((prev) => ({ ...prev, recording: true }));
    }
  }, []);

  const toggleHideUI = useCallback(() => {
    setState((prev) => ({ ...prev, hideUI: !prev.hideUI }));
  }, []);
  toggleHideUiRef.current = toggleHideUI;

  const setWatermark = useCallback((enabled: boolean) => {
    applyWatermark(enabled);
    choosePlayPreference('watermark', String(enabled));
  }, [applyWatermark, choosePlayPreference]);

  const toggleWatermark = useCallback(() => {
    setWatermark(!watermarkRef.current);
  }, [setWatermark]);
  toggleWatermarkRef.current = toggleWatermark;

  const setSlideMode = useCallback((enabled: boolean) => {
    setState((prev) => ({ ...prev, slideMode: enabled }));
    choosePlayPreference('slideMode', String(enabled));
  }, [choosePlayPreference]);

  const setTraceLogStyle = useCallback((style: TraceLogStyle) => {
    setState((prev) => ({ ...prev, traceLogStyle: style }));
    choosePlayPreference('traceLogStyle', style);
  }, [choosePlayPreference]);

  const toggleProLightMode = useCallback(() => {
    const cm = channelManagerRef.current;
    setState((prev) => {
      const next = !prev.proLightMode;
      if (cm) {
        cm.setCirIgnore(Channel.LED, !next);
        refreshAllChains();
      }
      return { ...prev, proLightMode: next };
    });
  }, [refreshAllChains]);
  toggleProLightModeRef.current = toggleProLightMode;

  const toggleTraceLog = useCallback(() => {
    setState((prev) => {
      const next = !prev.traceLog;
      traceLogRef.current = next;
      return { ...prev, traceLog: next };
    });
  }, []);
  toggleTraceLogRef.current = toggleTraceLog;

  const clearTraceLog = useCallback(() => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    const { chain: chainCount } = unipack.info;
    traceLogSequenceRef.current = Array.from({ length: chainCount }, () => []);
    setState((prev) => ({
      ...prev,
      traceLogSequence: traceLogSequenceRef.current.map((seq) => [...seq]),
    }));
  }, []);

  const setMidiProfile = useCallback((profile: LaunchpadProfile) => {
    midiProfileRef.current = profile;
    // Applied at once as on Android and iOS; the connection then reports the model now in use
    // through applyControllerStatus, which releases the pads held before and redraws the board on
    // the device.
    midiRef.current?.setProfile(profile);
    setState((prev) => ({
      ...prev,
      midiRequestedProfile: profile,
    }));
  }, []);

  const connectMidi = useCallback(async (): Promise<boolean> => {
    if (!midiListenerRef.current) return false;
    const midi = midiRef.current ?? new MidiConnection();
    midiRef.current = midi;
    const connected = await midi.connect(midiListenerRef.current, {
      profile: midiProfileRef.current,
      onStatusChange: status => { if (midiRef.current === midi) applyControllerStatus(status); },
    });
    if (midiRef.current !== midi) return false;
    return connected;
  }, [applyControllerStatus]);

  const disconnectMidi = useCallback(() => {
    releaseControllerPads();
    midiRef.current?.disconnect();
    setState((prev) => ({
      ...prev,
      midiConnected: false,
      midiInputName: null,
      midiOutputName: null,
      midiResolvedProfile: 'none',
    }));
  }, [releaseControllerPads]);

  const setMidiUiContext = useCallback((context: {
    optionPanelOpen: boolean;
    onToggleOptionPanel?: (() => void) | null;
    onQuit?: (() => void) | null;
  }) => {
    if (context.optionPanelOpen && !midiOptionPanelOpenRef.current) releaseControllerPads();
    midiOptionPanelOpenRef.current = context.optionPanelOpen;
    midiToggleOptionPanelRef.current = context.onToggleOptionPanel ?? null;
    midiQuitRef.current = context.onQuit ?? null;
    applyChainSelectionVisibility();
  }, [applyChainSelectionVisibility, releaseControllerPads]);

  const loadTheme = useCallback(async (zipData: ArrayBuffer) => {
    try {
      const theme = await loadThemeFromZip(zipData);
      setState((prev) => {
        if (prev.theme) releaseThemeUrls(prev.theme);
        return { ...prev, theme };
      });
    } catch (err) {
      console.error('Failed to load theme:', err);
      const defaultTheme = getDefaultTheme();
      setState((prev) => {
        if (prev.theme) releaseThemeUrls(prev.theme);
        return { ...prev, theme: defaultTheme };
      });
      throw err;
    }
  }, []);

  const startAutoMapping = useCallback(() => {
    const unipack = unipackRef.current;
    if (!unipack || !unipack.autoPlay) return;

    setState((prev) => ({ ...prev, autoMappingActive: true, autoMappingProgress: 0, autoMappingTotal: 0 }));

    autoPlayMap(unipack.autoPlay, unipack.soundTable, {
      onStart: () => {},
      onGetWorkSize: (size) => {
        setState((prev) => ({ ...prev, autoMappingTotal: size }));
      },
      onProgress: (progress) => {
        setState((prev) => ({ ...prev, autoMappingProgress: progress }));
      },
      onDone: (mappedAutoPlay) => {
        unipack.autoPlay = mappedAutoPlay;
        unipackRef.current = unipack;

        const runner = autoPlayRunnerRef.current;
        const listener = autoPlayListenerRef.current;
        if (runner && listener) {
          runner.stop();
          const soundEngine = soundEngineRef.current;
          if (soundEngine) {
            const soundPushToNum = (c: number, x: number, y: number, num: number) => {
              soundEngine.soundPushToNum(c, x, y, num);
            };
            const newRunner = new AutoPlayRunner(
              unipack,
              listener,
              () => chainRef.current,
              setChain,
              soundPushToNum,
              (c, x, y, num) => ledPushToNum(unipack, c, x, y, num),
              playbackTicker.current!,
            );
            newRunner.setSuspended(document.hidden);
            autoPlayRunnerRef.current = newRunner;
          }
        }

        setState((prev) => ({ ...prev, autoMappingActive: false, unipack }));
      },
      onError: (error) => {
        console.error('Auto mapping failed:', error);
        setState((prev) => ({ ...prev, autoMappingActive: false }));
      },
    });
  }, [setChain]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) interruptPlayback();
      else {
        ledRunnerRef.current?.setSuspended(false);
        requestScreenWakeLock();
        // Restoring an audio connection never releases the sequencer or restores old sources.
        void soundEngineRef.current?.setSuspended(false).catch(() => {});
        syncMidiStateToDevice();
      }
    };
    const handleBlur = () => interruptPlayback();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const restoreVisibleAudio = () => {
      if (document.hidden || keyboardBlockedRef.current || !interruptedRef.current) return;
      const sound = soundEngineRef.current;
      const revision = interruptionRevisionRef.current;
      requestScreenWakeLock();
      syncMidiStateToDevice();
      if (!sound) return;
      void sound.setSuspended(false).then(() => {
        if (sound !== soundEngineRef.current || revision !== interruptionRevisionRef.current || document.hidden || keyboardBlockedRef.current) return;
        if (sound.context.state !== 'running') sound.stopAll();
        else if (!autoPlayRunnerRef.current?.active) interruptedRef.current = false;
      }).catch(() => {
        if (sound === soundEngineRef.current && revision === interruptionRevisionRef.current) sound.stopAll();
      });
    };
    const handleFocus = restoreVisibleAudio;
    for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
      document.addEventListener(type, restoreVisibleAudio, { capture: true, passive: true });
    }

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handleBlur);
    const revisionRef = interruptionRevisionRef;
    return () => {
      revisionRef.current++;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
        document.removeEventListener(type, restoreVisibleAudio, { capture: true });
      }
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handleBlur);
    };
  }, [interruptPlayback, requestScreenWakeLock, syncMidiStateToDevice]);

  useEffect(() => {
    return () => {
      soundEngineRef.current?.destroy();
      ledRunnerRef.current?.stop();
      autoPlayRunnerRef.current?.stop();
      midiRef.current?.release();
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      wakeLockRequestRef.current = null;
      visualFlushRef.current = null;
    };
  }, []);

  return {
    state,
    loadUniPack,
    unload,
    padTouchOn: screenPadTouchOn,
    padTouchOff: userPadTouchOff,
    setChain: selectChain,
    playMode,
    switchPlayMode,
    autoPlayPlayPause,
    autoPlayPrev,
    autoPlayNext,
    toggleFeedbackLight,
    setFeedbackLight,
    toggleLed,
    toggleRecording,
    toggleHideUI,
    toggleWatermark,
    setWatermark,
    setSlideMode,
    toggleTraceLog,
    setTraceLogStyle,
    clearTraceLog,
    toggleProLightMode,
    loadTheme,
    setMidiProfile,
    connectMidi,
    disconnectMidi,
    setMidiUiContext,
    setKeyboardBlocked,
    setVolumeLevel,
    resumeAudio: () => soundEngineRef.current?.resume(),
    startAutoMapping,
  };
}
