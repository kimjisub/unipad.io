'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { StoreItem } from '@/lib/store';

const STORE_UI_PREF_KEY = 'store_ui_pref_v1';

interface StoreModalProps {
  visible: boolean;
  loading: boolean;
  error: string | null;
  warning?: string | null;
  items: StoreItem[];
  downloadedCodes: Set<string>;
  downloadedPackIdByCode: Map<string, string>;
  downloadingCode: string | null;
  failedCode: string | null;
  downloadProgress: number;
  preferredCode?: string | null;
  onClose: () => void;
  onReload: () => void;
  onDownload: (item: StoreItem) => void;
  onRetryFailed: (item: StoreItem) => void;
  onPlayDownloaded: (item: StoreItem) => void;
  onCancelDownload: () => void;
  onYoutube: (item: StoreItem) => void;
  onWebsite: (item: StoreItem) => void;
}

export function StoreModal({
  visible,
  loading,
  error,
  warning = null,
  items,
  downloadedCodes,
  downloadedPackIdByCode,
  downloadingCode,
  failedCode,
  downloadProgress,
  preferredCode = null,
  onClose,
  onReload,
  onDownload,
  onRetryFailed,
  onPlayDownloaded,
  onCancelDownload,
  onYoutube,
  onWebsite,
}: StoreModalProps) {
  const reduceMotion = useReducedMotion();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'led' | 'autoplay'>('all');
  const [sort, setSort] = useState<'downloads' | 'title'>('downloads');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(STORE_UI_PREF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { filter?: string; sort?: string };
      if (parsed.filter === 'all' || parsed.filter === 'led' || parsed.filter === 'autoplay') {
        setFilter(parsed.filter);
      }
      if (parsed.sort === 'downloads' || parsed.sort === 'title') {
        setSort(parsed.sort);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(STORE_UI_PREF_KEY, JSON.stringify({ filter, sort }));
    } catch {
      // ignore
    }
  }, [filter, sort]);

  useEffect(() => {
    if (!visible || !preferredCode) return;
    if (items.some((it) => it.code === preferredCode)) {
      setSelectedCode(preferredCode);
    }
  }, [visible, preferredCode, items]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (items.length === 0) {
      setSelectedCode(null);
      return;
    }
    if (!selectedCode || !items.some((it) => it.code === selectedCode)) {
      setSelectedCode(items[0].code);
    }
  }, [visible, items, selectedCode]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (filter === 'led' && !it.isLED) return false;
      if (filter === 'autoplay' && !it.isAutoPlay) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q)
        || it.producerName.toLowerCase().includes(q)
        || it.code.toLowerCase().includes(q)
      );
    });
    filtered.sort((a, b) => (
      sort === 'downloads'
        ? b.downloadCount - a.downloadCount
        : a.title.localeCompare(b.title)
    ));
    return filtered;
  }, [items, search, filter, sort]);

  const selectedItem = useMemo(
    () => visibleItems.find((it) => it.code === selectedCode) ?? visibleItems[0] ?? null,
    [visibleItems, selectedCode],
  );
  const selectedIndex = useMemo(
    () => visibleItems.findIndex((it) => it.code === selectedItem?.code),
    [visibleItems, selectedItem?.code],
  );

  useEffect(() => {
    if (!visible || !selectedItem) return;
    const target = document.querySelector<HTMLElement>(`[data-store-code="${selectedItem.code}"]`);
    if (!target) return;
    target.scrollIntoView({
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [visible, selectedItem, reduceMotion]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput = tag === 'input' || tag === 'textarea';

      if ((event.key === '/' || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) && !isTextInput) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape' && !downloadingCode) {
        onClose();
        return;
      }
      if (!visibleItems.length || isTextInput) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = selectedIndex < 0
          ? 0
          : (selectedIndex + 1) % visibleItems.length;
        setSelectedCode(visibleItems[next].code);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = selectedIndex <= 0
          ? visibleItems.length - 1
          : selectedIndex - 1;
        setSelectedCode(visibleItems[prev].code);
        return;
      }

      if (event.key === 'Enter' && selectedItem && !downloadingCode) {
        event.preventDefault();
        const downloaded = downloadedCodes.has(selectedItem.code);
        const failed = failedCode === selectedItem.code;
        if (downloaded) onPlayDownloaded(selectedItem);
        else if (failed) onRetryFailed(selectedItem);
        else onDownload(selectedItem);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    visible,
    visibleItems,
    selectedIndex,
    selectedItem,
    downloadingCode,
    failedCode,
    downloadedCodes,
    onClose,
    onPlayDownloaded,
    onRetryFailed,
    onDownload,
  ]);

  return (
    <AnimatePresence>
      {visible && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Store">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={downloadingCode ? undefined : onClose}
          />

          <motion.div
            className="absolute inset-x-2 sm:inset-x-6 top-4 sm:top-8 bottom-4 sm:bottom-8 rounded-2xl bg-[var(--background)] border border-white/[0.08] overflow-hidden flex flex-col"
            style={{ boxShadow: '0 0 60px rgba(255,143,0,0.06), 0 30px 80px rgba(0,0,0,0.45)' }}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28, mass: 0.55 }}
          >
            {/* Ambient glows */}
            <div className="absolute inset-0 pointer-events-none" aria-hidden>
              <div
                className="absolute top-0 left-1/3 w-[400px] h-[400px] rounded-full opacity-[0.05] blur-[100px]"
                style={{ background: 'radial-gradient(circle, var(--accent), transparent)' }}
              />
              <div
                className="absolute bottom-0 right-1/4 w-[300px] h-[300px] rounded-full opacity-[0.04] blur-[80px]"
                style={{ background: 'radial-gradient(circle, var(--secondary), transparent)' }}
              />
            </div>

            {/* Header */}
            <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-2 relative z-10">
              <h2 className="text-sm font-bold text-white">Store</h2>
              <span className="text-xs text-white/40">{visibleItems.length}</span>
              <div className="flex-1" />
              <button
                className="px-3 py-1 rounded-lg text-xs text-white/60 bg-white/[0.06] hover:bg-white/10 transition-colors"
                onClick={onReload}
                disabled={loading}
              >
                Reload
              </button>
              <button
                className="px-3 py-1 rounded-lg text-xs text-white/60 bg-white/[0.06] hover:bg-white/10 disabled:opacity-50 transition-colors"
                onClick={onClose}
                disabled={Boolean(downloadingCode)}
              >
                Close
              </button>
            </div>

            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div
                  key="store-loading"
                  className="flex-1 flex flex-col items-center justify-center text-white/50 text-sm gap-4"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                >
                  {/* Loading pad grid animation */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-5 h-5 rounded-md"
                        style={{
                          backgroundColor: i % 3 === 0 ? 'rgba(255,143,0,0.15)' : 'rgba(0,184,212,0.08)',
                          animation: `pad-pulse ${2 + (i % 4) * 0.4}s ease-in-out ${i * 0.15}s infinite`,
                          ['--pad-glow' as string]: i % 3 === 0 ? 'rgba(255,143,0,0.3)' : 'rgba(0,184,212,0.15)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-white/35 text-xs">Loading store...</div>
                </motion.div>
              ) : error ? (
                <motion.div
                  key="store-error"
                  className="flex-1 flex flex-col items-center justify-center gap-3"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                >
                  <p className="text-sm text-red-300">{error}</p>
                  <button
                    className="px-4 py-1.5 rounded-lg text-xs text-white/70 bg-white/[0.06] hover:bg-white/10 transition-colors"
                    onClick={onReload}
                  >
                    Retry
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="store-content"
                  className="flex-1 overflow-hidden flex flex-col lg:flex-row relative z-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Left Panel - Detail & Filters */}
                  <div className="lg:w-[42%] border-b lg:border-b-0 lg:border-r border-white/[0.06] p-4 flex flex-col gap-3 bg-gradient-to-b from-white/[0.02] to-transparent">
                    {warning && (
                      <div className="px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-400/15 text-[10px] text-yellow-200">
                        {warning}
                      </div>
                    )}
                    <div className="space-y-2">
                <input
                  aria-label="Search store items"
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setSearch('');
                      searchInputRef.current?.blur();
                    }
                    if (e.key === 'ArrowDown' && visibleItems.length > 0) {
                      e.preventDefault();
                      const next = selectedIndex < 0 ? 0 : (selectedIndex + 1) % visibleItems.length;
                      setSelectedCode(visibleItems[next].code);
                    }
                    if (e.key === 'ArrowUp' && visibleItems.length > 0) {
                      e.preventDefault();
                      const prev = selectedIndex <= 0 ? visibleItems.length - 1 : selectedIndex - 1;
                      setSelectedCode(visibleItems[prev].code);
                    }
                    if (e.key === 'Enter' && selectedItem && !downloadingCode) {
                      e.preventDefault();
                      const downloaded = downloadedCodes.has(selectedItem.code);
                      const failed = failedCode === selectedItem.code;
                      if (downloaded) onPlayDownloaded(selectedItem);
                      else if (failed) onRetryFailed(selectedItem);
                      else onDownload(selectedItem);
                    }
                  }}
                  placeholder="Search title / producer / code"
                  className="w-full px-3 py-1.5 rounded-lg bg-white/[0.04] text-xs text-white placeholder:text-white/25 outline-none border border-transparent focus:border-accent/30 focus:bg-white/[0.07] transition-colors"
                />
                <div className="flex gap-1">
                  <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
                  <FilterChip active={filter === 'led'} onClick={() => setFilter('led')} color="green">LED</FilterChip>
                  <FilterChip active={filter === 'autoplay'} onClick={() => setFilter('autoplay')} color="secondary">AP</FilterChip>
                  <div className="flex-1" />
                  <FilterChip active={sort === 'downloads'} onClick={() => setSort('downloads')}>DL</FilterChip>
                  <FilterChip active={sort === 'title'} onClick={() => setSort('title')}>A-Z</FilterChip>
                </div>
                    </div>

                    {selectedItem ? (
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={selectedItem.code}
                          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduceMotion ? {} : { opacity: 0, y: -4 }}
                          transition={{ duration: reduceMotion ? 0 : 0.16 }}
                          className="contents"
                        >
                  {downloadedPackIdByCode.has(selectedItem.code) && (
                    <button
                      className="relative w-full py-2.5 rounded-xl text-xs font-bold text-white hover:scale-[1.01] transition-all group"
                      style={{ background: 'var(--accent)' }}
                      tabIndex={-1}
                      onClick={() => onPlayDownloaded(selectedItem)}
                    >
                      <span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-40 blur-sm -z-10 group-hover:opacity-60 transition-opacity" />
                      Play Downloaded Pack
                    </button>
                  )}
                  <div>
                    <h3 className="text-sm font-bold text-white">{selectedItem.title}</h3>
                    <p className="text-xs text-white/45">{selectedItem.producerName}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-white/30">Code: <span className="text-accent/60 font-mono">{selectedItem.code}</span></div>
                    <div className="text-[11px] text-white/30">Downloads: <span className="text-white/50">{selectedItem.downloadCount.toLocaleString()}</span></div>
                    <div className="flex gap-2 mt-2">
                      {selectedItem.isLED && (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-green-500/10 border border-green-500/15">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
                          <span className="text-[10px] font-semibold text-green-400/90">LED</span>
                        </span>
                      )}
                      {selectedItem.isAutoPlay && (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[var(--secondary)]/10 border border-[var(--secondary)]/15">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--secondary)] shadow-[0_0_6px_rgba(0,184,212,0.5)]" />
                          <span className="text-[10px] font-semibold text-[var(--secondary)]">AutoPlay</span>
                        </span>
                      )}
                      {!selectedItem.isLED && !selectedItem.isAutoPlay && <span className="text-[10px] text-white/25">No LED / AutoPlay</span>}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {downloadingCode && (
                      <button
                        className="flex-1 py-1.5 rounded-lg text-xs bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                        tabIndex={-1}
                        onClick={onCancelDownload}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      className="flex-1 py-2 rounded-lg text-xs bg-white/[0.04] text-white/50 hover:bg-white/[0.08] transition-colors flex items-center justify-center gap-1.5"
                      tabIndex={-1}
                      onClick={() => onYoutube(selectedItem)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      YouTube
                    </button>
                    <button
                      className={`flex-1 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 ${
                        selectedItem.url
                          ? 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                          : 'bg-white/[0.02] text-white/20'
                      }`}
                      tabIndex={-1}
                      onClick={() => onWebsite(selectedItem)}
                      disabled={!selectedItem.url}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      Website
                    </button>
                  </div>
                        </motion.div>
                      </AnimatePresence>
                    ) : (
                      <div className="text-sm text-white/35">No item selected</div>
                    )}
                  </div>

                  {/* Right Panel - Item List */}
                  <div role="listbox" aria-label="Store items" className="flex-1 overflow-y-auto p-4 space-y-1.5">
                    {visibleItems.length === 0 ? (
                      <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-xs text-white/35">
                        <div>No matching store items.</div>
                        <button
                          className="px-3 py-1 rounded-lg bg-white/[0.06] text-white/60 hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setSearch('');
                            setFilter('all');
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : visibleItems.map((item, index) => {
              const downloaded = downloadedCodes.has(item.code);
              const downloading = downloadingCode === item.code;
              const failed = failedCode === item.code;
              return (
                <motion.div
                  key={item.code}
                  data-store-code={item.code}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.16,
                    delay: reduceMotion ? 0 : Math.min(index * 0.012, 0.12),
                  }}
                  role="option"
                  aria-selected={selectedCode === item.code}
                  aria-label={`${item.title} by ${item.producerName}`}
                  className={`rounded-xl border px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-all ${
                    selectedCode === item.code
                      ? 'bg-accent/[0.08] border-accent/25'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
                  }`}
                  style={selectedCode === item.code ? { boxShadow: '0 0 20px -5px rgba(255,143,0,0.1)' } : undefined}
                  onClick={() => setSelectedCode(item.code)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white font-medium truncate">{item.title}</div>
                    <div className="text-xs text-white/40 truncate">{item.producerName}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-white/30">
                      <span className="text-accent/40 font-mono">#{item.code}</span>
                      <span>{item.downloadCount.toLocaleString()} downloads</span>
                      {item.isLED && <span className="flex items-center gap-0.5"><span className="w-1 h-1 rounded-full bg-green-400/80 shadow-[0_0_3px_rgba(74,222,128,0.3)]" /><span className="text-green-400/60">LED</span></span>}
                      {item.isAutoPlay && <span className="flex items-center gap-0.5"><span className="w-1 h-1 rounded-full bg-[var(--secondary)] shadow-[0_0_3px_rgba(0,184,212,0.3)]" /><span className="text-[var(--secondary)]/60">AP</span></span>}
                    </div>
                  </div>

                  <div className="w-36 shrink-0">
                    {downloading ? (
                      <div className="w-full">
                        <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden relative">
                          <motion.div
                            className="absolute inset-0 opacity-25"
                            animate={{ x: ['-100%', '100%'] }}
                            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                            style={{
                              background:
                                'linear-gradient(90deg, transparent 0%, rgba(255,143,0,0.7) 50%, transparent 100%)',
                            }}
                          />
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: 'linear-gradient(90deg, var(--accent), var(--secondary))' }}
                            animate={{ width: `${downloadProgress}%` }}
                            transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.35 }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-white/40 text-right">Downloading {downloadProgress}%</div>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          className="w-1/3 py-1.5 rounded-lg text-[10px] font-medium bg-white/[0.06] text-white/50 hover:bg-white/10 transition-colors"
                          tabIndex={-1}
                          disabled={Boolean(downloadingCode)}
                          onClick={() => onYoutube(item)}
                        >
                          YT
                        </button>
                        {downloaded ? (
                          <button
                            className="relative w-2/3 py-1.5 rounded-lg text-xs font-semibold text-white hover:scale-[1.02] transition-all group"
                            style={{ background: 'var(--accent)' }}
                            tabIndex={-1}
                            disabled={Boolean(downloadingCode)}
                            onClick={() => onPlayDownloaded(item)}
                          >
                            <span className="absolute -inset-[1px] rounded-lg bg-accent opacity-25 blur-sm -z-10 group-hover:opacity-40 transition-opacity" />
                            Play
                          </button>
                        ) : failed ? (
                          <button
                            className="w-2/3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                            tabIndex={-1}
                            disabled={Boolean(downloadingCode)}
                            onClick={() => onRetryFailed(item)}
                          >
                            Retry
                          </button>
                        ) : (
                          <button
                            className="w-2/3 py-1.5 rounded-lg text-xs font-medium bg-secondary/15 text-[var(--secondary)] hover:bg-secondary/25 border border-secondary/15 transition-colors"
                            tabIndex={-1}
                            disabled={Boolean(downloadingCode)}
                            onClick={() => onDownload(item)}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="px-4 py-3 border-t border-white/[0.06] text-[10px] text-white/20 flex items-center justify-center gap-4">
              <StoreKeyHint keys="↑↓" label="select" />
              <StoreKeyHint keys="Enter" label="action" />
              <StoreKeyHint keys="/" label="search" />
              <StoreKeyHint keys="Esc" label="close" />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: 'green' | 'secondary';
  children: React.ReactNode;
}) {
  const activeClass = color === 'green'
    ? 'bg-green-500/15 text-green-300 border-green-500/20'
    : color === 'secondary'
      ? 'bg-[var(--secondary)]/15 text-[var(--secondary)] border-[var(--secondary)]/20'
      : 'bg-accent/15 text-accent border-accent/20';

  return (
    <button
      className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border ${
        active ? activeClass : 'bg-white/[0.04] text-white/45 border-transparent hover:bg-white/[0.08]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StoreKeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.06] text-white/40 text-[9px] font-mono leading-tight shadow-sm">{keys}</kbd>
      <span className="text-white/25">{label}</span>
    </span>
  );
}
