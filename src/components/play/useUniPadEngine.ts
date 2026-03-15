'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseUniPack,
  SoundEngine,
  LedRunner,
  AutoPlayRunner,
  ChannelManager,
  Channel,
  MidiConnection,
  Recorder,
  getKeyboardMapping,
  getChainKey,
  argbToRgba,
  loadThemeFromZip,
  getDefaultTheme,
  releaseThemeUrls,
} from '@/lib/unipack';
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
  recording: boolean;
  hideUI: boolean;
  watermark: boolean;
  traceLog: boolean;
  traceLogSequence: { x: number; y: number }[][];
  proLightMode: boolean;
  criticalError: boolean;
  theme: ThemeAssets;
}

export type PlayMode = 'none' | 'autoPlay' | 'guidePlay' | 'stepPractice';

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
    volumeLevel: 7,
    practiceMode: false,
    recording: false,
    hideUI: false,
    watermark: true,
    traceLog: false,
    traceLogSequence: [],
    proLightMode: false,
    criticalError: false,
    theme: getDefaultTheme(),
  });

  const playMode: PlayMode = !state.autoPlayEnabled ? 'none'
    : !state.practiceMode ? 'autoPlay'
    : state.autoPlayPlaying ? 'guidePlay'
    : 'stepPractice';

  const soundEngineRef = useRef<SoundEngine | null>(null);
  const ledRunnerRef = useRef<LedRunner | null>(null);
  const autoPlayRunnerRef = useRef<AutoPlayRunner | null>(null);
  const channelManagerRef = useRef<ChannelManager | null>(null);
  const midiRef = useRef<MidiConnection | null>(null);
  const recorderRef = useRef<Recorder>(new Recorder());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const chainRef = useRef(0);
  const unipackRef = useRef<UniPackData | null>(null);
  const padStatesRef = useRef<PadState[][]>([]);
  const chainStatesRef = useRef<{ color: string; active: boolean; guide?: boolean }[]>([]);
  const feedbackLightRef = useRef(true);
  const traceLogRef = useRef(false);
  const traceLogSequenceRef = useRef<{ x: number; y: number }[][]>([]);
  const pressedKeysRef = useRef(new Set<string>());
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
  const volumeLevelRef = useRef(7);
  const stateRef = useRef(state);
  const midiOptionPanelOpenRef = useRef(false);
  const midiToggleOptionPanelRef = useRef<(() => void) | null>(null);
  const midiQuitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const syncMidiFunctionLeds = useCallback(() => {
    const midi = midiRef.current;
    if (!midi || !midi.connected) return;

    const current = stateRef.current;
    const topBar = new Array<number>(8).fill(0);
    if (!midiOptionPanelOpenRef.current) {
      if (current.watermark) {
        topBar[4] = LED_GREEN;
        topBar[5] = LED_BLUE;
        topBar[6] = LED_GREEN;
        topBar[7] = LED_BLUE;
      }
    } else {
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
    const volumeRangeStart = 8 - volumeLevel;
    for (let i = 0; i < 8; i++) {
      const velocity = midiOptionPanelOpenRef.current && i >= volumeRangeStart && i <= 7 ? LED_BLUE : 0;
      midi.sendFunctionKeyLed(i + 8, velocity);
    }
  }, []);

  const syncMidiStateToDevice = useCallback(() => {
    const midi = midiRef.current;
    const unipack = unipackRef.current;
    const cm = channelManagerRef.current;
    if (!midi || !unipack || !cm || !midi.connected) return;

    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        const item = cm.get(x, y);
        midi.sendPadLed(x, y, item ? item.code : 0);
      }
    }
    for (let c = 0; c < unipack.info.chain; c++) {
      const item = cm.get(-1, c);
      midi.sendChainLed(c, item ? item.code : 0);
    }
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

  const updatePadVisual = useCallback((x: number, y: number) => {
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
  }, []);

  const updateChainVisual = useCallback((c: number) => {
    const cm = channelManagerRef.current;
    if (!cm) return;
    const item = cm.get(-1, c);
    if (chainStatesRef.current[c]) {
      chainStatesRef.current[c] = {
        ...chainStatesRef.current[c],
        color: item ? argbToRgba(item.color) : 'transparent',
        active: c === chainRef.current,
      };
    }
  }, []);

  const flushVisualState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      padStates: padStatesRef.current.map((row) => row.map((p) => ({ ...p }))),
      chainStates: chainStatesRef.current.map((c) => ({ ...c })),
    }));
  }, []);

  const visualTimerRef = useRef<number | null>(null);
  const scheduleFlush = useCallback(() => {
    if (visualTimerRef.current === null) {
      visualTimerRef.current = window.requestAnimationFrame(() => {
        visualTimerRef.current = null;
        flushVisualState();
      });
    }
  }, [flushVisualState]);

  const refreshChainVisuals = useCallback(() => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    for (let c = 0; c < unipack.info.chain; c++) {
      updateChainVisual(c);
    }
    scheduleFlush();
  }, [scheduleFlush, updateChainVisual]);

  const applyChainSelectionVisibility = useCallback(() => {
    const cm = channelManagerRef.current;
    const current = stateRef.current;
    if (!cm) return;
    cm.setCirIgnore(Channel.CHAIN, midiOptionPanelOpenRef.current || !current.watermark);
    refreshChainVisuals();
  }, [refreshChainVisuals]);

  useEffect(() => {
    applyChainSelectionVisibility();
  }, [applyChainSelectionVisibility, state.watermark]);

  const setChain = useCallback((c: number) => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    // Android: ChainObserver clamps to valid range instead of ignoring
    c = Math.max(0, Math.min(c, unipack.info.chain - 1));

    const prevChain = chainRef.current;
    chainRef.current = c;

    // Android: chain 변경 시 sound/LED 인덱스를 0으로 리셋
    const se = soundEngineRef.current;
    if (se) {
      for (let x = 0; x < unipack.info.buttonX; x++) {
        for (let y = 0; y < unipack.info.buttonY; y++) {
          se.soundPushToNum(c, x, y, 0);
        }
      }
    }
    const table = unipack.ledAnimationTable;
    if (table) {
      for (let x = 0; x < unipack.info.buttonX; x++) {
        for (let y = 0; y < unipack.info.buttonY; y++) {
          const anims = table[c]?.[x]?.[y];
          if (anims && anims.length > 0) {
            for (let i = 0; i < anims.length; i++) {
              if (anims[0].num === 0) break;
              const first = anims.shift()!;
              anims.push(first);
            }
          }
        }
      }
    }

    recorderRef.current.recordChain(c);

    const cm = channelManagerRef.current;
    if (cm) {
      cm.remove(-1, prevChain + CHAIN_INDEX_OFFSET, Channel.CHAIN);
      cm.add(-1, c + CHAIN_INDEX_OFFSET, Channel.CHAIN, -1, 3);
      updateChainVisual(prevChain + CHAIN_INDEX_OFFSET);
      updateChainVisual(c + CHAIN_INDEX_OFFSET);
    }

    setState((prev) => ({ ...prev, chain: c }));
    scheduleFlush();
  }, [updateChainVisual, scheduleFlush]);

  const padTouchOn = useCallback((x: number, y: number) => {
    const se = soundEngineRef.current;
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;

    if (autoPlayRunnerRef.current?.stepMode) {
      autoPlayRunnerRef.current.stepPadPressed(x, y);
    }

    se?.soundOn(x, y);
    lr?.eventOn(x, y);
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
      updatePadVisual(x, y);
    }

    if (padStatesRef.current[x]?.[y]) {
      padStatesRef.current[x][y] = { ...padStatesRef.current[x][y], pressed: true };
    }

    scheduleFlush();
  }, [updatePadVisual, scheduleFlush]);

  const padTouchOff = useCallback((x: number, y: number) => {
    const se = soundEngineRef.current;
    const lr = ledRunnerRef.current;
    const cm = channelManagerRef.current;

    se?.soundOff(x, y);
    lr?.eventOff(x, y);
    recorderRef.current.recordOff(x, y);

    if (cm) {
      cm.remove(x, y, Channel.PRESSED);
      updatePadVisual(x, y);
    }

    if (padStatesRef.current[x]?.[y]) {
      padStatesRef.current[x][y] = {
        ...padStatesRef.current[x][y],
        pressed: false,
        pressedIsWinning: false,
      };
    }

    scheduleFlush();
  }, [updatePadVisual, scheduleFlush]);

  // Keyboard input handler
  useEffect(() => {
    const unipack = unipackRef.current;
    if (!unipack || !state.loaded) return;

    const keyMap = getKeyboardMapping(unipack.info.buttonX, unipack.info.buttonY);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      // Chain switching
      const chainIdx = getChainKey(e.key);
      if (chainIdx !== null && chainIdx < (unipackRef.current?.info.chain ?? 0)) {
        e.preventDefault();
        setChain(chainIdx);
        return;
      }

      // Space = toggle AutoPlay
      if (e.key === ' ') {
        e.preventDefault();
        toggleAutoPlayRef.current();
        return;
      }

      const pad = keyMap[e.key];
      if (pad && !pressedKeysRef.current.has(e.key)) {
        e.preventDefault();
        pressedKeysRef.current.add(e.key);
        padTouchOn(pad[0], pad[1]);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const pad = keyMap[e.key];
      if (pad && pressedKeysRef.current.has(e.key)) {
        pressedKeysRef.current.delete(e.key);
        padTouchOff(pad[0], pad[1]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state.loaded, padTouchOn, padTouchOff, setChain]);

  const padInit = useCallback(() => {
    const unipack = unipackRef.current;
    if (!unipack) return;
    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        padTouchOff(x, y);
      }
    }
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
        updatePadVisual(x, y);
      }
    }
    const chainLedCount = Math.max(unipack.info.chain, 36);
    for (let c = 0; c < chainLedCount; c++) {
      if (lr) lr.eventOff(-1, c);
      cm.remove(-1, c, Channel.LED);
      if (c < unipack.info.chain) updateChainVisual(c);
    }
    scheduleFlush();
  }, [updatePadVisual, updateChainVisual, scheduleFlush]);

  const autoPlayRemoveGuide = useCallback(() => {
    const unipack = unipackRef.current;
    const cm = channelManagerRef.current;
    if (!unipack || !cm) return;
    for (let x = 0; x < unipack.info.buttonX; x++) {
      for (let y = 0; y < unipack.info.buttonY; y++) {
        cm.remove(x, y, Channel.GUIDE);
        updatePadVisual(x, y);
        const item = cm.get(x, y);
        midiRef.current?.sendPadLed(x, y, item ? item.code : 0);
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
      const item = cm.get(-1, cirIdx);
      const midiChain = cirIdx >= CHAIN_INDEX_OFFSET ? cirIdx - CHAIN_INDEX_OFFSET : cirIdx;
      midiRef.current?.sendChainLed(midiChain, item ? item.code : 0);
      if (chainStatesRef.current[cirIdx]) {
        chainStatesRef.current[cirIdx] = { ...chainStatesRef.current[cirIdx], guide: false };
      }
      updateChainVisual(cirIdx);
    }
    scheduleFlush();
  }, [updatePadVisual, updateChainVisual, scheduleFlush]);

  const applyModeFlags = useCallback((runner: InstanceType<typeof AutoPlayRunner>, targetMode: PlayMode) => {
    if (targetMode === 'autoPlay') {
      runner.practiceGuide = false;
      runner.stepMode = false;
      runner.resetStepState();
      autoPlayRemoveGuide();
      runner.playmode = true;
      runner.beforeStartPlaying = true;
    } else if (targetMode === 'guidePlay') {
      runner.practiceGuide = true;
      runner.stepMode = false;
      runner.resetStepState();
      autoPlayRemoveGuide();
      runner.playmode = true;
      runner.beforeStartPlaying = true;
    } else if (targetMode === 'stepPractice') {
      runner.practiceGuide = true;
      runner.playmode = false;
      runner.stepMode = true;
    }
  }, [autoPlayRemoveGuide]);

  const switchPlayMode = useCallback((targetMode: PlayMode) => {
    const runner = autoPlayRunnerRef.current;
    if (!runner) return;
    const unipack = unipackRef.current;
    const prev = stateRef.current;

    const currentMode: PlayMode = !prev.autoPlayEnabled ? 'none'
      : !prev.practiceMode ? 'autoPlay'
      : prev.autoPlayPlaying ? 'guidePlay'
      : 'stepPractice';

    const mode = targetMode === currentMode ? 'none' : targetMode;

    if (mode === 'none') {
      runner.practiceGuide = false;
      runner.stepMode = false;
      runner.resetStepState();
      runner.pause();
      if (runner.active) runner.stop();
      padInit();
      ledInit();
      autoPlayRemoveGuide();
      if (unipack?.keyLedExist) {
        feedbackLightRef.current = false;
      } else {
        feedbackLightRef.current = true;
      }
      setState((s) => ({
        ...s,
        autoPlayEnabled: false, autoPlayPlaying: false, autoPlayControlsVisible: false,
        autoPlayProgress: 0, practiceMode: false,
        ledEnabled: unipack?.keyLedExist ? true : s.ledEnabled,
        feedbackLight: !unipack?.keyLedExist,
      }));
      return;
    }

    const isPractice = mode === 'guidePlay' || mode === 'stepPractice';
    const isPlaying = mode !== 'stepPractice';

    if (currentMode === 'none') {
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
        practiceMode: isPractice,
        ledEnabled: unipack?.keyLedExist ? true : s.ledEnabled,
        feedbackLight: !unipack?.keyLedExist,
      }));
    } else {
      applyModeFlags(runner, mode);
      runner.resyncToProgress();
      setState((s) => ({ ...s, autoPlayPlaying: isPlaying, practiceMode: isPractice }));
    }
  }, [padInit, ledInit, autoPlayRemoveGuide, applyModeFlags]);
  toggleAutoPlayRef.current = () => switchPlayMode('autoPlay');

  const autoPlayPlayPause = useCallback(() => {
    const runner = autoPlayRunnerRef.current;
    const unipack = unipackRef.current;
    if (!runner || !runner.active) return;
    if (runner.isPlaying) {
      runner.pause();
      padInit();
      ledInit();
      autoPlayRemoveGuide();
      if (stateRef.current.practiceMode) {
        runner.stepMode = true;
      }
      setState((prev) => ({ ...prev, autoPlayPlaying: false }));
    } else {
      runner.stepMode = false;
      runner.resetStepState();
      autoPlayRemoveGuide();
      padInit();
      ledInit();
      runner.play();
      runner.beforeStartPlaying = true;
      if (unipack?.keyLedExist) {
        feedbackLightRef.current = false;
        if (!stateRef.current.ledEnabled) ledRunnerRef.current?.launch();
      } else {
        feedbackLightRef.current = true;
      }
      setState((prev) => ({
        ...prev,
        autoPlayPlaying: true,
        ledEnabled: unipack?.keyLedExist ? true : prev.ledEnabled,
        feedbackLight: !unipack?.keyLedExist,
      }));
    }
  }, [padInit, ledInit, autoPlayRemoveGuide]);

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

  const loadUniPack = useCallback(async (zipData: ArrayBuffer) => {
    soundEngineRef.current?.destroy();
    ledRunnerRef.current?.stop();
    autoPlayRunnerRef.current?.stop();

    setState((prev) => ({ ...prev, loading: true, loadProgress: 0, loadPhase: 'Reading archive...', errors: [] }));

    try {
      const unipack = await parseUniPack(zipData, (phase) => {
        setState((prev) => ({ ...prev, loadPhase: phase }));
      });
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
      // Android: proLightMode defaults to false → LED channel ignored on chain buttons
      cm.setCirIgnore(Channel.LED, true);

      setState((prev) => ({ ...prev, loadPhase: 'Loading audio...' }));

      const soundEngine = new SoundEngine(
        unipack,
        () => chainRef.current,
        setChain,
        (loaded, total) => {
          setState((prev) => ({
            ...prev,
            loadProgress: Math.round((loaded / total) * 100),
            loadPhase: `Loading audio... (${loaded}/${total})`,
          }));
        },
      );
      soundEngineRef.current = soundEngine;
      const failedSounds = await soundEngine.load();
      soundEngine.setVolume(volumeLevelRef.current, 7);

      if (failedSounds.length > 0) {
        const allFailed = failedSounds.length === Array.from(unipack.soundFiles.keys()).length;
        setState((prev) => ({
          ...prev,
          errors: [...prev.errors, `${failedSounds.length} audio file(s) failed to decode`],
          criticalError: allFailed,
        }));
        if (allFailed) return;
      }

      const ledListener: LedRunnerListener = {
        onPadLedTurnOn: (x: number, y: number, color: number, velocity: number) => {
          cm.add(x, y, Channel.LED, color, velocity);
          updatePadVisual(x, y);
          scheduleFlush();
          midiRef.current?.sendPadLed(x, y, velocity);
        },
        onPadLedTurnOff: (x: number, y: number) => {
          cm.remove(x, y, Channel.LED);
          updatePadVisual(x, y);
          scheduleFlush();
          midiRef.current?.sendPadLed(x, y, 0);
        },
        onChainLedTurnOn: (c: number, color: number, velocity: number) => {
          cm.add(-1, c, Channel.LED, color, velocity);
          updateChainVisual(c);
          scheduleFlush();
          midiRef.current?.sendChainLed(c, velocity);
        },
        onChainLedTurnOff: (c: number) => {
          cm.remove(-1, c, Channel.LED);
          updateChainVisual(c);
          scheduleFlush();
          midiRef.current?.sendChainLed(c, 0);
        },
      };

      const ledRunner = new LedRunner(
        unipack,
        ledListener,
        () => chainRef.current,
        setChain,
      );
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
              : current.autoPlayPlaying ? 'guidePlay'
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
          onPadTouchOn: (x: number, y: number) => { padTouchOn(x, y); },
          onPadTouchOff: (x: number, y: number) => { padTouchOff(x, y); },
          onChainChange: (c: number) => { setChain(c); },
          onGuidePadOn: (x: number, y: number, targetWallTimeMs: number) => {
            cm.add(x, y, Channel.GUIDE, -1, 17);
            updatePadVisual(x, y);
            const item = cm.get(x, y);
            midiRef.current?.sendPadLed(x, y, item ? item.code : 0);
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
            updatePadVisual(x, y);
            const item = cm.get(x, y);
            midiRef.current?.sendPadLed(x, y, item ? item.code : 0);
            if (padStatesRef.current[x]?.[y]) {
              padStatesRef.current[x][y] = {
                ...padStatesRef.current[x][y],
                guide: false,
                guideTargetWallTimeMs: null,
              };
            }
            scheduleFlush();
          },
          onGuideLedUpdate: (x: number, y: number, velocity: number) => {
            cm.add(x, y, Channel.GUIDE, -1, velocity);
            updatePadVisual(x, y);
            scheduleFlush();
            midiRef.current?.sendPadLed(x, y, velocity);
          },
          onGuideChainOn: (c: number) => {
            const cirIdx = c + CHAIN_INDEX_OFFSET;
            cm.add(-1, cirIdx, Channel.GUIDE, -1, 17);
            if (chainStatesRef.current[cirIdx]) {
              chainStatesRef.current[cirIdx] = { ...chainStatesRef.current[cirIdx], guide: true };
            }
            updateChainVisual(cirIdx);
            const item = cm.get(-1, cirIdx);
            midiRef.current?.sendChainLed(c, item ? item.code : 0);
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
            }
            padInit();
            ledInit();
            autoPlayRemoveGuide();
            setState((prev) => ({
              ...(unipack.keyLedExist
                ? {
                    ...prev,
                    autoPlayEnabled: false,
                    autoPlayPlaying: false,
                    autoPlayControlsVisible: false,
                    autoPlayProgress: 0,
                    practiceMode: false,
                    ledEnabled: true,
                    feedbackLight: false,
                  }
                : {
                    ...prev,
                    autoPlayEnabled: false,
                    autoPlayPlaying: false,
                    autoPlayControlsVisible: false,
                    autoPlayProgress: 0,
                    practiceMode: false,
                    feedbackLight: true,
                  }),
            }));
            if (unipack.keyLedExist) {
              feedbackLightRef.current = false;
              ledRunnerRef.current?.launch();
            } else {
              feedbackLightRef.current = true;
            }
          },
        };

        const soundPushToNum = (c: number, x: number, y: number, num: number) => {
          soundEngine.soundPushToNum(c, x, y, num);
        };
        const ledPushToNum = (c: number, x: number, y: number, num: number) => {
          const table = unipack.ledAnimationTable;
          if (!table) return;
          const anims = table[c]?.[x]?.[y];
          if (!anims || anims.length === 0) return;
          const targetNum = num % anims.length;
          for (let i = 0; i < anims.length; i++) {
            if (anims[0].num === targetNum) break;
            const first = anims.shift()!;
            anims.push(first);
          }
        };

        const autoPlayRunner = new AutoPlayRunner(
          unipack,
          autoPlayListener,
          () => chainRef.current,
          setChain,
          soundPushToNum,
          ledPushToNum,
        );
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
          errors: unipack.errors,
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

      // 화면 꺼짐 방지 (Android: FLAG_KEEP_SCREEN_ON)
      navigator.wakeLock?.request('screen').then((lock) => {
        wakeLockRef.current = lock;
      }).catch(() => {});

      // MIDI 연결은 비동기로 처리 (권한 다이얼로그가 로딩을 차단하지 않도록)
      const midi = new MidiConnection();
      midiRef.current = midi;
      const midiListener: MidiControllerListener = {
        onPadTouch: (x: number, y: number, pressed: boolean) => {
          if (midiOptionPanelOpenRef.current) return;
          if (pressed) padTouchOn(x, y);
          else padTouchOff(x, y);
        },
        onChainTouch: (c: number) => {
          if (midiOptionPanelOpenRef.current) return;
          setChain(c);
        },
        onFunctionKey: (key: number) => {
          if (!midiOptionPanelOpenRef.current) {
            switch (key) {
              case 0: toggleFeedbackLightRef.current(); break;
              case 1: toggleLedRef.current(); break;
              case 2: toggleAutoPlayRef.current(); break;
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
            case 2: toggleAutoPlayRef.current(); break;
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
        onStatusChange: applyMidiStatus,
      }).then((connected) => {
        const status = midi.getStatus();
        applyMidiStatus({ ...status, connected });
      });
    } catch (err) {
      console.error('Failed to load UniPack:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        criticalError: true,
        errors: [err instanceof Error ? err.message : String(err)],
      }));
    }
  }, [
    setChain,
    padTouchOn,
    padTouchOff,
    updatePadVisual,
    updateChainVisual,
    scheduleFlush,
    padInit,
    ledInit,
    autoPlayRemoveGuide,
    applyMidiStatus,
  ]);

  const toggleFeedbackLight = useCallback(() => {
    padInit();
    setState((prev) => {
      feedbackLightRef.current = !prev.feedbackLight;
      return { ...prev, feedbackLight: !prev.feedbackLight };
    });
  }, [padInit]);
  toggleFeedbackLightRef.current = toggleFeedbackLight;

  const setVolumeLevel = useCallback((level: number) => {
    const next = Math.max(0, Math.min(7, level));
    volumeLevelRef.current = next;
    soundEngineRef.current?.setVolume(next, 7);
    setState((prev) => ({ ...prev, volumeLevel: next }));
  }, []);
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
      a.click();
      URL.revokeObjectURL(url);
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

  const toggleWatermark = useCallback(() => {
    setState((prev) => ({ ...prev, watermark: !prev.watermark }));
  }, []);
  toggleWatermarkRef.current = toggleWatermark;

  const toggleProLightMode = useCallback(() => {
    const cm = channelManagerRef.current;
    setState((prev) => {
      const next = !prev.proLightMode;
      if (cm) {
        cm.setCirIgnore(Channel.LED, !next);
      }
      return { ...prev, proLightMode: next };
    });
  }, []);
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

  const unload = useCallback(() => {
    soundEngineRef.current?.destroy();
    ledRunnerRef.current?.stop();
    autoPlayRunnerRef.current?.stop();
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    soundEngineRef.current = null;
    ledRunnerRef.current = null;
    autoPlayRunnerRef.current = null;
    channelManagerRef.current = null;
    unipackRef.current = null;
    midiRef.current?.disconnect();
    midiRef.current = null;
    midiListenerRef.current = null;
    setState((prev) => {
      if (prev.theme) releaseThemeUrls(prev.theme);
      return {
        ...prev,
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
  }, []);

  const setMidiProfile = useCallback((profile: LaunchpadProfile) => {
    midiProfileRef.current = profile;
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
      onStatusChange: applyMidiStatus,
    });
    const status = midi.getStatus();
    applyMidiStatus({ ...status, connected });
    return connected;
  }, [applyMidiStatus]);

  const disconnectMidi = useCallback(() => {
    midiRef.current?.disconnect();
    setState((prev) => ({
      ...prev,
      midiConnected: false,
      midiInputName: null,
      midiOutputName: null,
      midiResolvedProfile: 'none',
    }));
  }, []);

  const setMidiUiContext = useCallback((context: {
    optionPanelOpen: boolean;
    onToggleOptionPanel?: (() => void) | null;
    onQuit?: (() => void) | null;
  }) => {
    midiOptionPanelOpenRef.current = context.optionPanelOpen;
    midiToggleOptionPanelRef.current = context.onToggleOptionPanel ?? null;
    midiQuitRef.current = context.onQuit ?? null;
    syncMidiFunctionLeds();
    applyChainSelectionVisibility();
  }, [applyChainSelectionVisibility, syncMidiFunctionLeds]);

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

  // Android onPause/onResume: 탭 전환 시 wake lock 관리 및 MIDI LED 클리어
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // onPause: wake lock 해제, MIDI LED 클리어
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
        midiRef.current?.clearAllLeds?.();
      } else {
        // onResume: wake lock 재취득, MIDI LED 상태 복원
        if (soundEngineRef.current) {
          navigator.wakeLock?.request('screen').then((lock) => {
            wakeLockRef.current = lock;
          }).catch(() => {});
          soundEngineRef.current.resume();
          syncMidiStateToDevice();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [syncMidiStateToDevice]);

  useEffect(() => {
    return () => {
      soundEngineRef.current?.destroy();
      ledRunnerRef.current?.stop();
      autoPlayRunnerRef.current?.stop();
      midiRef.current?.disconnect();
      wakeLockRef.current?.release().catch(() => {});
      if (visualTimerRef.current !== null) {
        cancelAnimationFrame(visualTimerRef.current);
      }
    };
  }, []);

  return {
    state,
    loadUniPack,
    unload,
    padTouchOn,
    padTouchOff,
    setChain,
    playMode,
    switchPlayMode,
    autoPlayPlayPause,
    autoPlayPrev,
    autoPlayNext,
    toggleFeedbackLight,
    toggleLed,
    toggleRecording,
    toggleHideUI,
    toggleWatermark,
    toggleTraceLog,
    clearTraceLog,
    toggleProLightMode,
    loadTheme,
    setMidiProfile,
    connectMidi,
    disconnectMidi,
    setMidiUiContext,
    setVolumeLevel,
    resumeAudio: () => soundEngineRef.current?.resume(),
  };
}
