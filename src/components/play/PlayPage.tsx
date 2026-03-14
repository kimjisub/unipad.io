'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { logEvent } from 'firebase/analytics';
import { AnimatePresence, motion } from 'framer-motion';
import { useUniPadEngine } from './useUniPadEngine';
import { PadGrid } from './PadGrid';
import { ChainBar } from './ChainBar';
import { ControlPanel } from './ControlPanel';
import { OptionPanel } from './OptionPanel';
import { MainScreen } from './MainScreen';
import { StoreModal } from './StoreModal';
import { LaunchpadSettingsModal } from './LaunchpadSettingsModal';
import {
  parseUniPack,
  saveUniPack,
  getUniPack,
  listUniPacks,
  deleteUniPack,
  updateUniPackLastOpened,
  toggleUniPackBookmark,
  saveTheme,
  getTheme,
  listThemes,
  deleteTheme,
  setSetting,
  getSetting,
} from '@/lib/unipack';
import {
  downloadStoreItem,
  fetchStoreItems,
  fetchStoreCount,
  getStoreYoutubeSearchUrl,
  subscribeStoreCount,
  subscribeStoreItems,
  type StoreItem,
} from '@/lib/store';
import type { StoredUniPack, StoredTheme } from '@/lib/unipack';
import type { LaunchpadProfile } from '@/lib/unipack';
import { initFirebaseServices } from '@/lib/firebase';

const PACK_QUERY_KEY = 'pack';
const CODE_QUERY_KEY = 'code';
const MIDI_PROFILE_SETTING_KEY = 'midiProfile';
const CHAIN_INDEX_OFFSET = 8;
const CIRCLE_ARRAY_SIZE = 32;

export function PlayPage() {
  const {
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
    resumeAudio,
  } = useUniPadEngine();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [savedPacks, setSavedPacks] = useState<StoredUniPack[]>([]);
  const [savedThemes, setSavedThemes] = useState<StoredTheme[]>([]);
  const [restoringFromStorage, setRestoringFromStorage] = useState(true);
  const [optionPanelOpen, setOptionPanelOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeWarning, setStoreWarning] = useState<string | null>(null);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [downloadingStoreCode, setDownloadingStoreCode] = useState<string | null>(null);
  const [failedStoreCode, setFailedStoreCode] = useState<string | null>(null);
  const [preferredStoreCode, setPreferredStoreCode] = useState<string | null>(null);
  const [storeProgress, setStoreProgress] = useState(0);
  const [storeCount, setStoreCount] = useState(0);
  const [hasStoreUpdate, setHasStoreUpdate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errorDialogShown, setErrorDialogShown] = useState(false);
  const [midiConnecting, setMidiConnecting] = useState(false);
  const [launchpadSettingsOpen, setLaunchpadSettingsOpen] = useState(false);
  const [lastPlayedPackId, setLastPlayedPackId] = useState<string | null>(null);
  const [loadingPackTitle, setLoadingPackTitle] = useState<string | null>(null);
  const centerStageRef = useRef<HTMLDivElement | null>(null);
  const [centerStageSize, setCenterStageSize] = useState({ width: 0, height: 0 });
  const prevLoadedRef = useRef(false);
  const prevRecordingRef = useRef(false);
  const currentPackIdRef = useRef<string | null>(null);
  const currentThemeIdRef = useRef<string | null>(null);
  const storeUnsubscribeRef = useRef<(() => void) | null>(null);
  const storeCountUnsubscribeRef = useRef<(() => void) | null>(null);
  const storeItemsRef = useRef<StoreItem[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const storeDownloadAbortRef = useRef<AbortController | null>(null);
  const triedUrlPackRestoreRef = useRef(false);

  const syncPackUrl = useCallback((packId: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (packId) {
      url.searchParams.set(PACK_QUERY_KEY, packId);
    } else {
      url.searchParams.delete(PACK_QUERY_KEY);
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const getPackIdFromUrl = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get(PACK_QUERY_KEY);
    return value?.trim() || null;
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  const normalizeStoreError = useCallback((error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error);
    if (/aborted|canceled/i.test(raw)) return 'Download canceled.';
    if (/HTTP 403|Host not allowed/i.test(raw)) return 'Download source is blocked by server policy.';
    if (/HTTP 404/i.test(raw)) return 'Pack not found on server.';
    if (/HTTP 5\d\d/i.test(raw)) return 'Store server is temporarily unavailable.';
    if (/Network error/i.test(raw)) return 'Network error. Please check your connection.';
    if (/Invalid UniPack|parse/i.test(raw)) return 'Downloaded file is not a valid UniPack.';
    return raw;
  }, []);

  const trackStoreEvent = useCallback((name: string, params?: Record<string, string | number | boolean>) => {
    initFirebaseServices().then((services) => {
      if (!services?.analytics) return;
      logEvent(services.analytics, name, params);
    }).catch(() => {
      // ignore analytics failures
    });
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const [packs, themes] = await Promise.all([listUniPacks(), listThemes()]);
      setSavedPacks(packs);
      setSavedThemes(themes);
    } catch {
      /* IndexedDB unavailable */
    }
  }, []);

  // 페이지 로드 시 목록만 불러오기 (자동 재생 하지 않음)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLists();
        const savedMidiProfile = await getSetting(MIDI_PROFILE_SETTING_KEY);
        if (
          savedMidiProfile === 'auto'
          || savedMidiProfile === 'none'
          || savedMidiProfile === 'launchpad_x'
          || savedMidiProfile === 'launchpad_mini_mk3'
          || savedMidiProfile === 'launchpad_pro_mk3'
          || savedMidiProfile === 'launchpad_pro'
        ) {
          setMidiProfile(savedMidiProfile);
        }
        const [savedLastPackId, countResult] = await Promise.all([
          getSetting('lastUniPackId'),
          fetchStoreCount(),
        ]);
        const prev = Number(await getSetting('prevStoreCount') ?? '0');
        if (!cancelled) {
          if (savedLastPackId) setLastPlayedPackId(savedLastPackId);
          setStoreCount(countResult);
          setHasStoreUpdate(countResult > prev);
        }
      } catch {
        /* storage unavailable */
      }
      if (!cancelled) setRestoringFromStorage(false);
    })();
    return () => { cancelled = true; };
  }, [refreshLists, setMidiProfile]);

  useEffect(() => {
    subscribeStoreCount(
      async (count) => {
        setStoreCount(count);
        const prev = Number(await getSetting('prevStoreCount') ?? '0');
        setHasStoreUpdate(count > prev);
      },
    ).then((unsub) => {
      storeCountUnsubscribeRef.current = unsub;
    }).catch(() => {
      // ignore
    });

    return () => {
      storeCountUnsubscribeRef.current?.();
      storeCountUnsubscribeRef.current = null;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (storeItems.length > 0 && storeError) {
      setStoreError(null);
    }
    storeItemsRef.current = storeItems;
  }, [storeItems, storeError]);

  useEffect(() => {
    if (!downloadingStoreCode) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [downloadingStoreCode]);

  // 로딩 완료 후 에러가 있으면 다이얼로그 표시
  useEffect(() => {
    if (state.loaded && !prevLoadedRef.current && state.errors.length > 0) {
      setErrorDialogShown(true);
    }
    prevLoadedRef.current = state.loaded;
  }, [state.loaded, state.errors]);

  // 로딩 완료 시 저장된 설정 복원
  const settingsRestoredRef = useRef(false);
  useEffect(() => {
    if (!state.loaded || settingsRestoredRef.current) return;
    settingsRestoredRef.current = true;
    (async () => {
      try {
        const [vol, fb, wm] = await Promise.all([
          getSetting('volumeLevel'),
          getSetting('feedbackLight'),
          getSetting('watermark'),
        ]);
        if (vol !== null) setVolumeLevel(Number(vol));
        if (fb === 'false') toggleFeedbackLight();
        if (wm === 'false') toggleWatermark();
      } catch { /* storage unavailable */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded]);

  // 설정 변경 시 저장
  useEffect(() => {
    if (!state.loaded) return;
    setSetting('volumeLevel', String(state.volumeLevel)).catch(() => {});
  }, [state.loaded, state.volumeLevel]);
  useEffect(() => {
    if (!state.loaded) return;
    setSetting('feedbackLight', String(state.feedbackLight)).catch(() => {});
  }, [state.loaded, state.feedbackLight]);
  useEffect(() => {
    if (!state.loaded) return;
    setSetting('watermark', String(state.watermark)).catch(() => {});
  }, [state.loaded, state.watermark]);

  const handleImportFile = useCallback(
    async (file: File) => {
      await resumeAudio();
      const buffer = await file.arrayBuffer();
      await loadUniPack(buffer);

      try {
        const parsed = await parseUniPack(buffer.slice(0));
        const id = await saveUniPack(buffer, {
          ...parsed.info,
          keyLedExist: parsed.keyLedExist,
          autoPlayExist: parsed.autoPlayExist,
          soundCount: parsed.soundCount,
          ledCount: parsed.ledCount,
        });
        currentPackIdRef.current = id;
        await setSetting('lastUniPackId', id);
        syncPackUrl(id);
        await refreshLists();

        // 마지막 테마도 적용
        const lastThemeId = await getSetting('lastThemeId');
        if (lastThemeId) {
          const theme = await getTheme(lastThemeId);
          if (theme) {
            currentThemeIdRef.current = lastThemeId;
            try {
              await loadTheme(theme.zipData);
            } catch {
              showToast('Failed to apply skin. Reset skin.');
              currentThemeIdRef.current = null;
              await setSetting('lastThemeId', '');
            }
          }
        }
      } catch {
        /* storage error */
      }
    },
    [loadUniPack, loadTheme, resumeAudio, refreshLists, syncPackUrl, showToast],
  );

  const handleImportThemeFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      try {
        if (state.loaded) {
          await loadTheme(buffer);
        }

        const { loadThemeFromZip } = await import('@/lib/unipack');
        const parsed = await loadThemeFromZip(buffer.slice(0));
        const id = await saveTheme(buffer, parsed.metadata);
        currentThemeIdRef.current = id;
        await setSetting('lastThemeId', id);
        await refreshLists();
      } catch {
        showToast('Failed to apply skin. Reset skin.');
        currentThemeIdRef.current = null;
        await setSetting('lastThemeId', '').catch(() => {});
      }
    },
    [loadTheme, refreshLists, state.loaded, showToast],
  );

  const handlePlay = useCallback(
    async (id: string) => {
      try {
        await resumeAudio();
        const pack = await getUniPack(id);
        if (!pack) return false;
        currentPackIdRef.current = id;
        setLoadingPackTitle(pack.title);
        await setSetting('lastUniPackId', id);
        syncPackUrl(id);
        await updateUniPackLastOpened(id);
        await loadUniPack(pack.zipData);

        const lastThemeId = await getSetting('lastThemeId');
        if (lastThemeId) {
          const theme = await getTheme(lastThemeId);
          if (theme) {
            currentThemeIdRef.current = lastThemeId;
            try {
              await loadTheme(theme.zipData);
            } catch {
              showToast('Failed to apply skin. Reset skin.');
              currentThemeIdRef.current = null;
              await setSetting('lastThemeId', '');
            }
          }
        }
        return true;
      } catch {
        /* error */
        return false;
      }
    },
    [loadUniPack, loadTheme, resumeAudio, syncPackUrl, showToast],
  );

  const getCodeFromUrl = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(CODE_QUERY_KEY)?.trim() || null;
  }, []);

  // Restore from ?pack=<localId> URL parameter
  useEffect(() => {
    if (restoringFromStorage || state.loaded || state.loading) return;
    if (triedUrlPackRestoreRef.current) return;
    const packId = getPackIdFromUrl();
    if (!packId) return;

    triedUrlPackRestoreRef.current = true;
    handlePlay(packId).then((ok) => {
      if (!ok) syncPackUrl(null);
    }).catch(() => {
      syncPackUrl(null);
    });
  }, [getPackIdFromUrl, handlePlay, restoringFromStorage, state.loaded, state.loading, syncPackUrl]);

  const handleDeletePack = useCallback(
    async (id: string) => {
      await deleteUniPack(id);
      if (currentPackIdRef.current === id) {
        await setSetting('lastUniPackId', '');
        syncPackUrl(null);
      }
      await refreshLists();
    },
    [refreshLists, syncPackUrl],
  );

  const handleDeleteTheme = useCallback(
    async (id: string) => {
      await deleteTheme(id);
      if (currentThemeIdRef.current === id) {
        currentThemeIdRef.current = null;
        await setSetting('lastThemeId', '');
      }
      await refreshLists();
    },
    [refreshLists],
  );

  const handleApplyTheme = useCallback(
    async (id: string) => {
      try {
        const theme = await getTheme(id);
        if (!theme) return;
        currentThemeIdRef.current = id;
        await setSetting('lastThemeId', id);
        if (state.loaded) {
          try {
            await loadTheme(theme.zipData);
          } catch {
            showToast('Failed to apply skin. Reset skin.');
            currentThemeIdRef.current = null;
            await setSetting('lastThemeId', '');
          }
        }
        await refreshLists();
      } catch {
        showToast('Failed to apply theme.');
      }
    },
    [loadTheme, refreshLists, showToast, state.loaded],
  );

  const handleClearTheme = useCallback(
    async () => {
      currentThemeIdRef.current = null;
      await setSetting('lastThemeId', '');
      await refreshLists();
    },
    [refreshLists],
  );

  const handleToggleBookmark = useCallback(
    async (id: string) => {
      await toggleUniPackBookmark(id);
      await refreshLists();
    },
    [refreshLists],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleImportFile(file);
    },
    [handleImportFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
      e.target.value = '';
    },
    [handleImportFile],
  );

  const handleThemeInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportThemeFile(file);
      e.target.value = '';
    },
    [handleImportThemeFile],
  );

  // Android: back toggles option menu, quit exits to main
  const handleBack = useCallback(() => {
    if (optionPanelOpen) {
      setOptionPanelOpen(false);
    } else {
      setOptionPanelOpen(true);
    }
  }, [optionPanelOpen]);

  const handleQuit = useCallback(() => {
    setOptionPanelOpen(false);
    setLastPlayedPackId(currentPackIdRef.current);
    setLoadingPackTitle(null);
    unload();
    currentPackIdRef.current = null;
    syncPackUrl(null);
    refreshLists();
  }, [unload, refreshLists, syncPackUrl]);

  const handleStartPracticeFromMenu = useCallback(() => {
    switchPlayMode('guidePlay');
    setOptionPanelOpen(false);
  }, [switchPlayMode]);

  useEffect(() => {
    setMidiUiContext({
      optionPanelOpen,
      onToggleOptionPanel: () => setOptionPanelOpen((prev) => !prev),
      onQuit: handleQuit,
    });
  }, [handleQuit, optionPanelOpen, setMidiUiContext]);

  const handleClearTraceLog = useCallback(() => {
    clearTraceLog();
    showToast('Trace Log Cleared');
  }, [clearTraceLog, showToast]);

  // Android: show "Copied" toast when recording stops
  useEffect(() => {
    if (prevRecordingRef.current && !state.recording) {
      showToast('Copied');
    }
    prevRecordingRef.current = state.recording;
  }, [state.recording, showToast]);

  // Keyboard shortcuts: Escape for overlays, Backtick for function key shortcuts
  useEffect(() => {
    if (!state.loaded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        if (errorDialogShown) {
          if (!state.criticalError) setErrorDialogShown(false);
        } else if (launchpadSettingsOpen) {
          setLaunchpadSettingsOpen(false);
        } else if (state.hideUI) {
          toggleHideUI();
        } else if (optionPanelOpen) {
          setOptionPanelOpen(false);
        } else {
          setOptionPanelOpen(true);
        }
        return;
      }

      // Android function key equivalents (Backtick + number)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        switch (e.key) {
          case 'f': e.preventDefault(); toggleFeedbackLight(); break;
          case 'l': e.preventDefault(); toggleLed(); break;
          case 'a': e.preventDefault(); switchPlayMode('autoPlay'); break;
          case 'o': e.preventDefault(); setOptionPanelOpen((prev) => !prev); break;
          case 'h': e.preventDefault(); toggleHideUI(); break;
          case 'w': e.preventDefault(); toggleWatermark(); break;
          case 'p': e.preventDefault(); toggleProLightMode(); break;
          case 'r': e.preventDefault(); toggleRecording(); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state.loaded, state.hideUI, state.criticalError,
    toggleHideUI, toggleFeedbackLight, toggleLed, switchPlayMode,
    toggleWatermark, toggleProLightMode, toggleRecording,
    errorDialogShown, launchpadSettingsOpen, optionPanelOpen,
  ]);

  useEffect(() => {
    const base = 'UniPad Web Player';
    const title = state.unipack?.info.title;
    document.title = title ? `${title} | ${base}` : base;
    return () => { document.title = base; };
  }, [state.unipack?.info.title]);

  // Android: sensorLandscape orientation lock
  useEffect(() => {
    if (!state.loaded) return;
    const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void>; unlock?: () => void };
    if (orientation?.lock) {
      orientation.lock('landscape').catch(() => {});
      return () => { orientation.unlock?.(); };
    }
  }, [state.loaded]);

  const handleConnectMidi = useCallback(async () => {
    if (midiConnecting) return;
    setMidiConnecting(true);
    try {
      const ok = await connectMidi();
      if (!ok) {
        showToast('No MIDI device found.');
      } else {
        showToast('MIDI connected.');
      }
    } catch {
      showToast('MIDI connection failed.');
    } finally {
      setMidiConnecting(false);
    }
  }, [connectMidi, midiConnecting, showToast]);

  const handleDisconnectMidi = useCallback(() => {
    disconnectMidi();
    showToast('MIDI disconnected.');
  }, [disconnectMidi, showToast]);

  const handleChangeMidiProfile = useCallback((profile: LaunchpadProfile) => {
    setMidiProfile(profile);
    setSetting(MIDI_PROFILE_SETTING_KEY, profile).catch(() => {});
  }, [setMidiProfile]);

  const loadStoreItems = useCallback(async () => {
    setStoreLoading(true);
    setStoreError(null);
    setStoreWarning(null);
    try {
      const items = await fetchStoreItems();
      setStoreItems(items);
      if (items.length === 0) {
        setStoreWarning('Store list is empty or unavailable.');
      }
    } catch (error) {
      setStoreError(error instanceof Error ? error.message : 'Failed to load store');
    } finally {
      setStoreLoading(false);
    }
  }, []);

  const handleOpenStore = useCallback(() => {
    setStoreOpen(true);
    setStoreLoading(true);
    setStoreError(null);
    setStoreWarning(null);
    setHasStoreUpdate(false);
    setSetting('prevStoreCount', String(storeCount)).catch(() => {});
    trackStoreEvent('store_open', { store_count: storeCount });
    loadStoreItems();
  }, [loadStoreItems, storeCount, trackStoreEvent]);

  useEffect(() => {
    if (!storeOpen) {
      storeUnsubscribeRef.current?.();
      storeUnsubscribeRef.current = null;
      return;
    }

    let cancelled = false;
    subscribeStoreItems(
      (items) => {
        if (cancelled) return;
        setStoreItems(items);
        setStoreLoading(false);
      },
      (message) => {
        if (cancelled) return;
        setStoreWarning(message);
        if (storeItemsRef.current.length === 0) {
          setStoreError(message);
        }
        setStoreLoading(false);
      },
    ).then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      storeUnsubscribeRef.current = unsub;
    }).catch((error) => {
      if (cancelled) return;
      setStoreError(error instanceof Error ? error.message : 'Failed to subscribe store');
      setStoreLoading(false);
    });

    return () => {
      cancelled = true;
      storeUnsubscribeRef.current?.();
      storeUnsubscribeRef.current = null;
    };
  }, [storeOpen]);

  const handleDownloadStoreItem = useCallback(async (item: StoreItem) => {
    if (downloadingStoreCode) return;

    setDownloadingStoreCode(item.code);
    setPreferredStoreCode(item.code);
    setFailedStoreCode(null);
    setStoreProgress(0);
    setStoreError(null);
    const controller = new AbortController();
    storeDownloadAbortRef.current = controller;

    try {
      trackStoreEvent('store_download_start', { code: item.code });
      const zipData = await downloadStoreItem(item, (percent) => {
        setStoreProgress(percent);
      }, controller.signal);
      const parsed = await parseUniPack(zipData.slice(0));

      const packs = await listUniPacks();
      const existing = packs.find((p) => p.storeCode === item.code);
      if (existing) {
        await deleteUniPack(existing.id);
      }

      await saveUniPack(zipData, {
        ...parsed.info,
        keyLedExist: parsed.keyLedExist,
        autoPlayExist: parsed.autoPlayExist,
        soundCount: parsed.soundCount,
        ledCount: parsed.ledCount,
        storeCode: item.code,
      });

      await refreshLists();
      await loadStoreItems();
      setStoreProgress(100);
      setPreferredStoreCode(item.code);
      trackStoreEvent('store_download_success', { code: item.code });
      showToast(`Downloaded: ${item.title}`);
    } catch (error) {
      const message = normalizeStoreError(error);
      setStoreError(message);
      setFailedStoreCode(item.code);
      trackStoreEvent('store_download_fail', { code: item.code, message });
      showToast(message);
    } finally {
      storeDownloadAbortRef.current = null;
      setDownloadingStoreCode(null);
    }
  }, [downloadingStoreCode, loadStoreItems, normalizeStoreError, refreshLists, showToast, trackStoreEvent]);

  const handleCancelStoreDownload = useCallback(() => {
    storeDownloadAbortRef.current?.abort();
    trackStoreEvent('store_download_cancel');
  }, [trackStoreEvent]);

  const handleRetryStoreItem = useCallback((item: StoreItem) => {
    handleDownloadStoreItem(item);
  }, [handleDownloadStoreItem]);

  const handleStoreYoutube = useCallback((item: StoreItem) => {
    trackStoreEvent('store_youtube_click', { code: item.code });
    window.open(getStoreYoutubeSearchUrl(item), '_blank', 'noopener,noreferrer');
  }, [trackStoreEvent]);

  const handleStoreWebsite = useCallback((item: StoreItem) => {
    if (!item.url) return;
    trackStoreEvent('store_website_click', { code: item.code });
    window.open(item.url, '_blank', 'noopener,noreferrer');
  }, [trackStoreEvent]);

  const handlePlayDownloadedStoreItem = useCallback((item: StoreItem) => {
    const pack = savedPacks.find((p) => p.storeCode === item.code);
    if (!pack) {
      showToast('Downloaded pack not found. Please refresh.');
      return;
    }
    trackStoreEvent('store_play_downloaded', { code: item.code });
    setStoreOpen(false);
    handlePlay(pack.id);
  }, [savedPacks, showToast, trackStoreEvent, handlePlay]);

  const downloadedStoreCodes = useMemo(
    () => new Set(savedPacks.map((p) => p.storeCode).filter((code): code is string => Boolean(code))),
    [savedPacks],
  );

  const downloadedPackIdByCode = useMemo(
    () => new Map(
      savedPacks
        .filter((p) => Boolean(p.storeCode))
        .map((p) => [p.storeCode as string, p.id]),
    ),
    [savedPacks],
  );

  // Android-style deep link: ?code=<shareCode> auto-downloads from store and plays
  const triedCodeRestoreRef = useRef(false);
  useEffect(() => {
    if (restoringFromStorage || state.loaded || state.loading) return;
    if (triedCodeRestoreRef.current) return;
    if (triedUrlPackRestoreRef.current) return;
    const shareCode = getCodeFromUrl();
    if (!shareCode) return;

    triedCodeRestoreRef.current = true;
    triedUrlPackRestoreRef.current = true;

    // If already downloaded, just play it
    const existingId = downloadedPackIdByCode.get(shareCode);
    if (existingId) {
      handlePlay(existingId);
      return;
    }

    // Auto-download from store
    (async () => {
      try {
        showToast('Downloading shared pack...');
        const items = await fetchStoreItems();
        const item = items.find((i) => i.code === shareCode);
        if (!item) {
          showToast('Shared pack not found in store.');
          return;
        }
        await handleDownloadStoreItem(item);
        const updatedPacks = await listUniPacks();
        const newPack = updatedPacks.find((p) => p.storeCode === shareCode);
        if (newPack) {
          await handlePlay(newPack.id);
        }
      } catch {
        showToast('Failed to load shared pack.');
      }
    })();
  }, [getCodeFromUrl, handlePlay, handleDownloadStoreItem, restoringFromStorage, downloadedPackIdByCode, state.loaded, state.loading, showToast]);

  useLayoutEffect(() => {
    const target = centerStageRef.current;
    if (!target) return undefined;

    const syncSize = () => {
      const rect = target.getBoundingClientRect();
      setCenterStageSize((prev) => {
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
    };
    syncSize();

    let observer: ResizeObserver | null = null;
    const onWindowResize = () => syncSize();
    window.addEventListener('resize', onWindowResize);

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => syncSize());
      observer.observe(target);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [state.loaded, state.hideUI, state.unipack?.info.buttonX, state.unipack?.info.buttonY]);

  // Engine now uses circle indices directly (chainStates is CIRCLE_ARRAY_SIZE=32)
  const actualChainCount = state.unipack?.info.chain ?? 0;
  const currentCircleChain = state.chain + CHAIN_INDEX_OFFSET;
  const handleChainSelect = useCallback((circleIdx: number) => {
    if (circleIdx >= CHAIN_INDEX_OFFSET && circleIdx < CHAIN_INDEX_OFFSET + actualChainCount) {
      setChain(circleIdx - CHAIN_INDEX_OFFSET);
    }
  }, [setChain, actualChainCount]);

  // Loading spinner
  if (restoringFromStorage) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-black text-white">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        <p className="text-white/40 text-sm">Loading...</p>
      </div>
    );
  }

  // Main Screen (UniPack list)
  if (!state.loaded && !state.loading) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <MainScreen
          savedPacks={savedPacks}
          savedThemes={savedThemes}
          activeThemeId={currentThemeIdRef.current}
          lastPlayedPackId={lastPlayedPackId}
          keyboardDisabled={storeOpen}
          onPlay={handlePlay}
          onOpenStore={handleOpenStore}
          storeCount={storeCount}
          hasStoreUpdate={hasStoreUpdate}
          onImport={() => fileInputRef.current?.click()}
          onImportTheme={() => themeInputRef.current?.click()}
          onDeletePack={handleDeletePack}
          onDeleteTheme={handleDeleteTheme}
          onApplyTheme={handleApplyTheme}
          onClearTheme={handleClearTheme}
          onToggleBookmark={handleToggleBookmark}
        />

        <StoreModal
          visible={storeOpen}
          loading={storeLoading}
          error={storeError}
          warning={storeWarning}
          items={storeItems}
          downloadedCodes={downloadedStoreCodes}
          downloadedPackIdByCode={downloadedPackIdByCode}
          downloadingCode={downloadingStoreCode}
          failedCode={failedStoreCode}
          downloadProgress={storeProgress}
          preferredCode={preferredStoreCode}
          onClose={() => {
            if (!downloadingStoreCode) {
              setStoreOpen(false);
              (document.activeElement as HTMLElement)?.blur?.();
            }
          }}
          onReload={loadStoreItems}
          onDownload={handleDownloadStoreItem}
          onRetryFailed={handleRetryStoreItem}
          onPlayDownloaded={handlePlayDownloadedStoreItem}
          onCancelDownload={handleCancelStoreDownload}
          onYoutube={handleStoreYoutube}
          onWebsite={handleStoreWebsite}
        />

        <AnimatePresence>
          {toast && (
            <motion.div
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-black/80 text-xs text-white border border-white/15"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>

        {dragOver && (
          <div className="fixed inset-0 bg-blue-500/10 border-4 border-dashed border-blue-500/30 flex items-center justify-center z-50 pointer-events-none">
            <p className="text-white text-lg font-bold">Drop UniPack here</p>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept=".zip,.uni" className="hidden" onChange={handleFileInput} />
        <input ref={themeInputRef} type="file" accept=".zip" className="hidden" onChange={handleThemeInput} />
      </div>
    );
  }

  // Loading screen (Android style: semi-transparent overlay with cyan progress)
  if (state.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-black text-white">
        <div className="bg-black/60 rounded-2xl px-6 py-5 w-[280px] flex flex-col items-center gap-3">
          {loadingPackTitle && (
            <p className="text-xs text-white/50 truncate max-w-full">{loadingPackTitle}</p>
          )}
          <p className="text-sm text-white/80">{state.loadPhase || 'Loading...'}</p>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${state.loadProgress}%`,
                backgroundColor: '#4FC3F7',
              }}
            />
          </div>
          <p className="text-xs text-white/40">{state.loadProgress}%</p>
        </div>
      </div>
    );
  }

  const { unipack, theme } = state;
  const showRightChainBar = state.proLightMode || actualChainCount > 1;
  const showLeftChainBar = state.proLightMode || actualChainCount > 16;
  const showTopChainBar = state.proLightMode;
  const showBottomChainBar = state.proLightMode;

  const chainAreaSlotsV = showRightChainBar ? Math.max(unipack?.info.buttonX ?? 1, 1) : 0;
  const chainAreaSlotsH = Math.max(unipack?.info.buttonY ?? 1, 1);
  const overlayGap = 8;
  const stageInsetTop = overlayGap;
  const stageInsetLeft = overlayGap;
  const stageInsetRight = overlayGap;
  const stageInsetBottom = overlayGap;
  const stageMetrics = (() => {
    if (!unipack) {
      return {
        totalWidth: 0,
        totalHeight: 0,
        padWidth: 0,
        padHeight: 0,
        chainWidth: 0,
        leftChainWidth: 0,
        topChainHeight: 0,
        bottomChainHeight: 0,
      };
    }

    const cw = centerStageSize.width;
    const ch = centerStageSize.height;
    if (cw <= 0 || ch <= 0) {
      return {
        totalWidth: 0,
        totalHeight: 0,
        padWidth: 0,
        padHeight: 0,
        chainWidth: 0,
        leftChainWidth: 0,
        topChainHeight: 0,
        bottomChainHeight: 0,
      };
    }

    // Use integer pixel units to avoid sub-pixel seams between pad and chain.
    const padCols = unipack.info.buttonY;
    const padRows = unipack.info.buttonX;
    const rightChainCols = showRightChainBar ? 1 : 0;
    const leftChainCols = showLeftChainBar ? 1 : 0;
    const topChainRows = showTopChainBar ? 1 : 0;
    const bottomChainRows = showBottomChainBar ? 1 : 0;
    const unit = Math.max(1, Math.floor(Math.min(
      cw / (padCols + rightChainCols + leftChainCols),
      ch / (padRows + topChainRows + bottomChainRows),
    )));
    const padHeight = unit * padRows;
    const padWidth = unit * padCols;
    const rightChainWidth = showRightChainBar ? unit : 0;
    const leftChainWidth = showLeftChainBar ? unit : 0;
    const topChainHeight = showTopChainBar ? unit : 0;
    const bottomChainHeight = showBottomChainBar ? unit : 0;
    return {
      totalWidth: padWidth + rightChainWidth + leftChainWidth,
      totalHeight: padHeight + topChainHeight + bottomChainHeight,
      padWidth,
      padHeight,
      chainWidth: rightChainWidth,
      leftChainWidth,
      topChainHeight,
      bottomChainHeight,
    };
  })();
  if (!unipack) return null;

  // Hide UI mode: hides control panels, keeps pad grid and chain bars
  if (state.hideUI) {
    const hiddenTotalCols = unipack.info.buttonY + (showRightChainBar ? 1 : 0) + (showLeftChainBar ? 1 : 0);
    const hiddenTotalRows = unipack.info.buttonX + (showTopChainBar ? 1 : 0) + (showBottomChainBar ? 1 : 0);
    return (
      <div
        className="h-screen flex items-center justify-center overflow-hidden"
        style={{
          backgroundColor: '#000000',
          backgroundImage: theme.playbg ? `url(${theme.playbg})` : undefined,
          backgroundSize: 'auto 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
        onClick={toggleHideUI}
      >
        {/* Menu button in hideUI mode */}
        <button
          className="absolute z-30 p-4 pointer-events-auto"
          style={{ bottom: '16px', right: '16px' }}
          onClick={(e) => { e.stopPropagation(); handleBack(); }}
          aria-label="Menu"
        >
          <svg className="w-8 h-8 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="w-full h-full flex items-center justify-center p-2">
          <div className="flex flex-col" style={{ aspectRatio: `${hiddenTotalCols} / ${hiddenTotalRows}`, maxWidth: '95vw', maxHeight: '95vh' }}>
            {showTopChainBar && (
              <div style={{ display: 'flex', flex: `0 0 ${(1 / hiddenTotalRows) * 100}%` }}>
                <div style={{ flex: `0 0 ${((showLeftChainBar ? 1 : 0) / hiddenTotalCols) * 100}%` }} />
                <div style={{ flex: `0 0 ${(unipack.info.buttonY / hiddenTotalCols) * 100}%`, height: '100%' }}>
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsH}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    orientation="horizontal"
                    rangeStart={0}
                    rangeEnd={8}
                    onChainSelect={handleChainSelect}
                  />
                </div>
                <div style={{ flex: `0 0 ${((showRightChainBar ? 1 : 0) / hiddenTotalCols) * 100}%` }} />
              </div>
            )}
            <div className="flex" style={{ flex: `0 0 ${(unipack.info.buttonX / hiddenTotalRows) * 100}%` }}>
              {showLeftChainBar && (
                <div className="h-full" style={{ flex: `0 0 ${100 / hiddenTotalCols}%` }}>
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsV}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    rangeStart={24}
                    rangeEnd={32}
                    reversed
                    onChainSelect={handleChainSelect}
                  />
                </div>
              )}
              <div className="h-full" style={{ flex: `0 0 ${(unipack.info.buttonY / hiddenTotalCols) * 100}%` }}>
                <PadGrid
                  buttonX={unipack.info.buttonX}
                  buttonY={unipack.info.buttonY}
                  padStates={state.padStates}
                  squareButton={unipack.info.squareButton}
                  theme={theme}
                  traceLogData={state.traceLog ? state.traceLogTable[state.chain] : undefined}
                  onPadDown={padTouchOn}
                  onPadUp={padTouchOff}
                />
              </div>
              {showRightChainBar && (
                <div className="h-full" style={{ flex: `0 0 ${100 / hiddenTotalCols}%` }}>
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsV}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    rangeStart={8}
                    rangeEnd={16}
                    onChainSelect={handleChainSelect}
                  />
                </div>
              )}
            </div>
            {showBottomChainBar && (
              <div style={{ display: 'flex', flex: `0 0 ${(1 / hiddenTotalRows) * 100}%` }}>
                <div style={{ flex: `0 0 ${((showLeftChainBar ? 1 : 0) / hiddenTotalCols) * 100}%` }} />
                <div style={{ flex: `0 0 ${(unipack.info.buttonY / hiddenTotalCols) * 100}%`, height: '100%' }}>
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsH}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    orientation="horizontal"
                    rangeStart={16}
                    rangeEnd={24}
                    reversed
                    onChainSelect={handleChainSelect}
                  />
                </div>
                <div style={{ flex: `0 0 ${((showRightChainBar ? 1 : 0) / hiddenTotalCols) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Player screen: [Controls LEFT] [PAD GRID center] [CHAINS RIGHT]
  return (
    <div
      className="relative h-screen text-white overflow-hidden animate-[fadeIn_300ms_ease-out]"
      style={{
        backgroundColor: '#000000',
        backgroundImage: theme.playbg ? `url(${theme.playbg})` : undefined,
        backgroundSize: 'auto 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Top-left status indicators (minimal, Android-like) */}
      <div className="absolute top-0 left-0 z-30 px-3 pt-2 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {state.midiConnected && (
            <button
              className="px-2 py-1 rounded-md text-[10px] border border-emerald-400/40 text-emerald-300 bg-emerald-500/10 backdrop-blur-md"
              onClick={() => setLaunchpadSettingsOpen(true)}
              aria-label="Launchpad Settings"
            >
              MIDI ON
            </button>
          )}
          {state.practiceMode && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-green-400 bg-green-500/15 backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Practice
            </span>
          )}
          {state.recording && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-red-400 bg-red-500/15 backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              REC
            </span>
          )}
          {state.errors.length > 0 && (
            <button
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] text-yellow-400 bg-yellow-500/15 hover:bg-yellow-500/25 transition-colors backdrop-blur-md"
              onClick={() => setErrorDialogShown(true)}
              aria-label={`${state.errors.length} warnings`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {state.errors.length}
            </button>
          )}
        </div>
      </div>

      {/* Menu button (Android: bottom-right, white 70% opacity) */}
      {!optionPanelOpen && (
        <button
          className="absolute z-30 p-4 pointer-events-auto"
          style={{ bottom: '16px', right: '16px' }}
          onClick={handleBack}
          aria-label="Menu"
        >
          <svg className="w-8 h-8 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Android SideCheckPanel: overlay on left, vertically centered, doesn't push pad grid */}
      {!optionPanelOpen && (
        <div
          className="absolute left-2 z-20 pointer-events-auto"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        >
          <ControlPanel
            panelBgColor="rgba(0,0,0,0.35)"
            squareButton={unipack.info.squareButton}
            keyLedExist={unipack.keyLedExist}
            feedbackLight={state.feedbackLight}
            ledEnabled={state.ledEnabled}
            autoPlayControlsVisible={state.autoPlayControlsVisible}
            autoPlayExist={unipack.autoPlayExist}
            recording={state.recording}
            traceLog={state.traceLog}
            playMode={playMode}
            autoPlayPlaying={state.autoPlayPlaying}
            autoPlayProgress={state.autoPlayProgress}
            autoPlayTotal={state.autoPlayTotal}
            themeColors={theme.colors}
            onToggleFeedbackLight={toggleFeedbackLight}
            onToggleLed={toggleLed}
            onSwitchPlayMode={switchPlayMode}
            onAutoPlayPlayPause={autoPlayPlayPause}
            onAutoPlayPrev={autoPlayPrev}
            onAutoPlayNext={autoPlayNext}
            onToggleRecording={toggleRecording}
            onToggleTraceLog={toggleTraceLog}
            onClearTraceLog={handleClearTraceLog}
          />
        </div>
      )}

      {/* Center safe area: [PAD GRID center] [CHAINS RIGHT] */}
      <div
        className="absolute z-10 min-w-0"
        ref={centerStageRef}
        style={{
          top: `${stageInsetTop}px`,
          left: `${stageInsetLeft}px`,
          right: `${stageInsetRight}px`,
          bottom: `${stageInsetBottom}px`,
        }}
      >
        <div className="flex h-full items-center justify-center min-w-0">
          <div
            className="flex flex-col min-w-0"
            style={{
              width: stageMetrics.totalWidth > 0 ? `${stageMetrics.totalWidth}px` : undefined,
              height: stageMetrics.totalHeight > 0 ? `${stageMetrics.totalHeight}px` : undefined,
            }}
          >
            {/* Top chain bar: chains 0-7 (horizontal) */}
            {showTopChainBar && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: stageMetrics.leftChainWidth > 0 ? `${stageMetrics.leftChainWidth}px` : undefined }} />
                <div
                  style={{
                    width: stageMetrics.padWidth > 0 ? `${stageMetrics.padWidth}px` : undefined,
                    height: stageMetrics.topChainHeight > 0 ? `${stageMetrics.topChainHeight}px` : undefined,
                  }}
                >
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsH}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={!optionPanelOpen && state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    orientation="horizontal"
                    rangeStart={0}
                    rangeEnd={8}
                    onChainSelect={handleChainSelect}
                  />
                </div>
                <div style={{ width: stageMetrics.chainWidth > 0 ? `${stageMetrics.chainWidth}px` : undefined }} />
              </div>
            )}
            {/* Middle row: left chain + pad grid + right chain */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* Left chain bar: chains 24-31 reversed */}
              {showLeftChainBar && (
                <div
                  className="max-h-full overflow-hidden"
                  style={{
                    width: stageMetrics.leftChainWidth > 0 ? `${stageMetrics.leftChainWidth}px` : undefined,
                    height: stageMetrics.padHeight > 0 ? `${stageMetrics.padHeight}px` : undefined,
                  }}
                >
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsV}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={!optionPanelOpen && state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    rangeStart={24}
                    rangeEnd={32}
                    reversed
                    onChainSelect={handleChainSelect}
                  />
                </div>
              )}
              <div
                className="max-h-full"
                style={{
                  width: stageMetrics.padWidth > 0 ? `${stageMetrics.padWidth}px` : undefined,
                  height: stageMetrics.padHeight > 0 ? `${stageMetrics.padHeight}px` : undefined,
                }}
              >
                <PadGrid
                  buttonX={unipack.info.buttonX}
                  buttonY={unipack.info.buttonY}
                  padStates={state.padStates}
                  squareButton={unipack.info.squareButton}
                  theme={theme}
                  traceLogData={state.traceLog ? state.traceLogTable[state.chain] : undefined}
                  onPadDown={padTouchOn}
                  onPadUp={padTouchOff}
                />
              </div>
              {/* Right chain bar: chains 8-15 */}
              {showRightChainBar && (
                <div
                  className="max-h-full overflow-hidden"
                  style={{
                    width: stageMetrics.chainWidth > 0 ? `${stageMetrics.chainWidth}px` : undefined,
                    height: stageMetrics.padHeight > 0 ? `${stageMetrics.padHeight}px` : undefined,
                  }}
                >
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsV}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={!optionPanelOpen && state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    rangeStart={8}
                    rangeEnd={16}
                    onChainSelect={handleChainSelect}
                  />
                </div>
              )}
            </div>
            {/* Bottom chain bar: chains 16-23 reversed (horizontal) */}
            {showBottomChainBar && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: stageMetrics.leftChainWidth > 0 ? `${stageMetrics.leftChainWidth}px` : undefined }} />
                <div
                  style={{
                    width: stageMetrics.padWidth > 0 ? `${stageMetrics.padWidth}px` : undefined,
                    height: stageMetrics.bottomChainHeight > 0 ? `${stageMetrics.bottomChainHeight}px` : undefined,
                  }}
                >
                  <ChainBar
                    chainCount={CIRCLE_ARRAY_SIZE}
                    slotCount={chainAreaSlotsH}
                    chainStates={state.chainStates}
                    currentChain={currentCircleChain}
                    showSelectedState={!optionPanelOpen && state.watermark}
                    theme={theme}
                    proLightMode={state.proLightMode}
                    orientation="horizontal"
                    rangeStart={16}
                    rangeEnd={24}
                    reversed
                    onChainSelect={handleChainSelect}
                  />
                </div>
                <div style={{ width: stageMetrics.chainWidth > 0 ? `${stageMetrics.chainWidth}px` : undefined }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom logo (Android: TopEnd, 16dp padding, 90dp width) */}
      {theme.customLogo && state.watermark && !optionPanelOpen && (
        <img
          src={theme.customLogo}
          alt=""
          className="fixed z-30 pointer-events-none"
          style={{
            top: '16px',
            right: '16px',
            width: '90px',
          }}
          draggable={false}
        />
      )}

      {/* Option Panel (Android: slide-in from right) */}
      <OptionPanel
        visible={optionPanelOpen}
        unipackInfo={unipack.info}
        keyLedExist={unipack.keyLedExist}
        autoPlayExists={unipack.autoPlayExist}
        theme={theme}
        feedbackLight={state.feedbackLight}
        ledEnabled={state.ledEnabled}
        autoPlayEnabled={state.autoPlayEnabled}
        recording={state.recording}
        hideUI={state.hideUI}
        watermark={state.watermark}
        traceLog={state.traceLog}
        proLightMode={state.proLightMode}
        midiConnected={state.midiConnected}
        midiConnecting={midiConnecting}
        onToggleFeedbackLight={toggleFeedbackLight}
        onToggleLed={toggleLed}
        onToggleAutoPlay={() => switchPlayMode('autoPlay')}
        onStartPractice={handleStartPracticeFromMenu}
        onToggleRecording={toggleRecording}
        onToggleHideUI={toggleHideUI}
        onToggleWatermark={toggleWatermark}
        onToggleTraceLog={toggleTraceLog}
        onClearTraceLog={handleClearTraceLog}
        onToggleProLightMode={toggleProLightMode}
        volumeLevel={state.volumeLevel}
        onVolumeChange={setVolumeLevel}
        onConnectMidi={handleConnectMidi}
        onOpenLaunchpadSettings={() => { setOptionPanelOpen(false); setLaunchpadSettingsOpen(true); }}
        onClose={() => { setOptionPanelOpen(false); (document.activeElement as HTMLElement)?.blur?.(); }}
        onQuit={handleQuit}
      />

      <LaunchpadSettingsModal
        visible={launchpadSettingsOpen}
        midiConnected={state.midiConnected}
        midiInputName={state.midiInputName}
        midiOutputName={state.midiOutputName}
        requestedProfile={state.midiRequestedProfile}
        resolvedProfile={state.midiResolvedProfile}
        connecting={midiConnecting}
        onClose={() => { setLaunchpadSettingsOpen(false); (document.activeElement as HTMLElement)?.blur?.(); }}
        onChangeProfile={handleChangeMidiProfile}
        onConnect={handleConnectMidi}
        onDisconnect={handleDisconnectMidi}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/10 border-4 border-dashed border-blue-500/30 flex items-center justify-center z-50 pointer-events-none">
          <p className="text-white text-lg font-bold">Drop UniPack here</p>
        </div>
      )}

      {/* Error/Warning Dialog */}
      {errorDialogShown && state.errors.length > 0 && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => {
            if (!state.criticalError) setErrorDialogShown(false);
          }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" role="alertdialog" aria-modal="true" aria-label={state.criticalError ? 'Error' : 'Warning'}>
            <div className="bg-[var(--card)] rounded-xl p-5 w-[360px] max-h-[60vh] flex flex-col pointer-events-auto shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className={`text-sm font-bold ${state.criticalError ? 'text-red-400' : 'text-yellow-400'}`}>
                  {state.criticalError ? 'Error' : 'Warning'}
                </h2>
                <span className="text-[10px] text-white/40">
                  {state.errors.length} {state.errors.length === 1 ? 'issue' : 'issues'}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {state.errors.map((err, i) => (
                  <ErrorMessageItem key={i} message={err} />
                ))}
              </div>
              <button
                className={`w-full py-2 rounded-lg text-sm font-medium ${
                  state.criticalError
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
                onClick={() => {
                  setErrorDialogShown(false);
                  if (state.criticalError) handleQuit();
                }}
              >
                {state.criticalError ? 'Quit' : 'OK'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-black/80 text-xs text-white border border-white/15"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Portrait orientation hint (mobile only, hidden when landscape or wider screen) */}
      <div className="fixed inset-0 z-[90] bg-black/90 flex-col items-center justify-center gap-4 text-white hidden portrait:flex landscape:hidden md:hidden">
        <svg className="w-12 h-12 text-white/60 animate-[spin_2s_ease-in-out_infinite]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p className="text-sm text-white/70">Rotate to landscape</p>
      </div>

      <input ref={fileInputRef} type="file" accept=".zip,.uni" className="hidden" onChange={handleFileInput} />
      <input ref={themeInputRef} type="file" accept=".zip" className="hidden" onChange={handleThemeInput} />
    </div>
  );
}

const ERROR_MSG_TRUNCATE = 120;

function ErrorMessageItem({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > ERROR_MSG_TRUNCATE;
  const label = message.split(':')[0] || 'Error';
  const detail = message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : message;

  return (
    <div className="rounded-md bg-white/5 px-3 py-2">
      <div className="text-[11px] font-medium text-white/80 mb-0.5">{label}</div>
      <div
        className={`text-[10px] text-white/50 font-mono break-all leading-relaxed ${
          !expanded && isLong ? 'line-clamp-3' : ''
        }`}
      >
        {detail}
      </div>
      {isLong && (
        <button
          className="text-[10px] text-blue-400 hover:text-blue-300 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
