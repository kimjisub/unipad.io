'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { StoredUniPack, StoredTheme } from '@/lib/unipack';

interface MainScreenProps {
  savedPacks: StoredUniPack[];
  savedThemes: StoredTheme[];
  lastPlayedPackId?: string | null;
  keyboardDisabled?: boolean;
  onPlay: (id: string) => void;
  onOpenStore: () => void;
  storeCount?: number;
  hasStoreUpdate?: boolean;
  onImport: () => void;
  onImportTheme: () => void;
  onDeletePack: (id: string) => void;
  onDeleteTheme: (id: string) => void;
}

type SortMethod = 'title' | 'producer' | 'date';
const MAIN_UI_PREF_KEY = 'main_ui_pref_v1';

export function MainScreen({
  savedPacks,
  savedThemes,
  lastPlayedPackId,
  keyboardDisabled = false,
  onPlay,
  onOpenStore,
  storeCount = 0,
  hasStoreUpdate = false,
  onImport,
  onImportTheme,
  onDeletePack,
  onDeleteTheme,
}: MainScreenProps) {
  const reduceMotion = useReducedMotion();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(lastPlayedPackId ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMethod, setSortMethod] = useState<SortMethod>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const filteredAndSortedPacks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? savedPacks.filter((pack) => (
        pack.title.toLowerCase().includes(q)
        || pack.producerName.toLowerCase().includes(q)
        || (pack.storeCode ?? '').toLowerCase().includes(q)
      ))
      : savedPacks;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortMethod) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'producer':
          cmp = a.producerName.localeCompare(b.producerName);
          break;
        case 'date':
          cmp = a.addedAt - b.addedAt;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [savedPacks, searchQuery, sortMethod, sortAsc]);
  const selectedPack = filteredAndSortedPacks.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(MAIN_UI_PREF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { sortMethod?: string; sortAsc?: boolean; searchQuery?: string };
      if (parsed.sortMethod === 'title' || parsed.sortMethod === 'producer' || parsed.sortMethod === 'date') {
        setSortMethod(parsed.sortMethod);
      }
      if (typeof parsed.sortAsc === 'boolean') {
        setSortAsc(parsed.sortAsc);
      }
      if (typeof parsed.searchQuery === 'string') {
        setSearchQuery(parsed.searchQuery);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(MAIN_UI_PREF_KEY, JSON.stringify({
        sortMethod,
        sortAsc,
        searchQuery,
      }));
    } catch {
      // ignore
    }
  }, [sortMethod, sortAsc, searchQuery]);

  useEffect(() => {
    if (filteredAndSortedPacks.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && !filteredAndSortedPacks.some((pack) => pack.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredAndSortedPacks, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (keyboardDisabled) return;

      if (event.key === 'Escape' && showSortMenu) {
        setShowSortMenu(false);
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput = tag === 'input' || tag === 'textarea';
      if ((event.key === '/' || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) && !isTextInput) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isTextInput || filteredAndSortedPacks.length === 0) return;

      const selectedIndex = filteredAndSortedPacks.findIndex((pack) => pack.id === selectedId);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = selectedIndex < 0 ? 0 : (selectedIndex + 1) % filteredAndSortedPacks.length;
        const nextId = filteredAndSortedPacks[next].id;
        setSelectedId(nextId);
        document.querySelector(`[data-pack-id="${nextId}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = selectedIndex <= 0 ? filteredAndSortedPacks.length - 1 : selectedIndex - 1;
        const prevId = filteredAndSortedPacks[prev].id;
        setSelectedId(prevId);
        document.querySelector(`[data-pack-id="${prevId}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter' && selectedId) {
        const selected = filteredAndSortedPacks.find((pack) => pack.id === selectedId);
        if (selected) onPlay(selected.id);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        setDeleteConfirmId(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredAndSortedPacks, onPlay, selectedId, keyboardDisabled, showSortMenu]);

  const handleItemClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleItemDoubleClick = useCallback((id: string) => {
    onPlay(id);
  }, [onPlay]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    if (selectedId === deleteConfirmId) setSelectedId(null);
    onDeletePack(deleteConfirmId);
    setDeleteConfirmId(null);
  }, [deleteConfirmId, selectedId, onDeletePack]);

  const sortLabel = sortMethod === 'title' ? 'Title' : sortMethod === 'producer' ? 'Producer' : 'Date';

  return (
    <div className="h-screen flex flex-col md:flex-row bg-[var(--background)] text-white overflow-hidden relative">
      {/* Ambient radial glows (brand style) */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute top-1/3 left-1/4 w-[500px] h-[500px] rounded-full opacity-[0.07] blur-[100px]"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full opacity-[0.05] blur-[80px]"
          style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
        />
      </div>

      {/* Mini pad grid background (brand element) */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" aria-hidden>
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,143,0,0.3) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
      </div>

      {/* Left Panel */}
      <div className="w-full md:w-2/5 md:min-w-[280px] md:max-w-[380px] p-4 pt-6 md:p-5 md:pt-8 flex flex-col items-center relative z-10">
        {selectedPack ? (
          <PackDetailPanel
            pack={selectedPack}
            onPlay={() => onPlay(selectedPack.id)}
            onDelete={() => handleDelete(selectedPack.id)}
          />
        ) : (
          <TotalPanel
            packs={savedPacks}
            themes={savedThemes}
            onDeleteTheme={onDeleteTheme}
          />
        )}
      </div>

      {/* Right Panel - Pack List */}
      <div className="flex-1 flex flex-col min-w-0 p-4 md:p-5 md:pl-0 md:border-l md:border-white/[0.06] relative z-10">
        {/* Top Bar */}
        <div className="flex items-center gap-2 shrink-0 pb-3 mb-3 border-b border-white/[0.06]">
          {savedPacks.length > 0 && (
            <>
              <div className="relative">
                <button
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-white/50 transition-colors"
                  onClick={() => setShowSortMenu(!showSortMenu)}
                >
                  {sortLabel}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSortMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                    <div className="absolute left-0 top-full mt-1.5 w-36 bg-[var(--card)] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 z-50 p-1.5 backdrop-blur-md">
                      {(['title', 'producer', 'date'] as SortMethod[]).map((m) => (
                        <button
                          key={m}
                          className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors flex items-center justify-between ${
                            sortMethod === m ? 'bg-accent/10 text-accent' : 'text-white/50 hover:bg-white/[0.05]'
                          }`}
                          onClick={() => { setSortMethod(m); setSortAsc(m !== 'date'); setShowSortMenu(false); }}
                        >
                          {m === 'title' ? 'Title' : m === 'producer' ? 'Producer' : 'Date'}
                          {sortMethod === m && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                className="px-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-white/50 transition-colors"
                onClick={() => setSortAsc(!sortAsc)}
                aria-label={sortAsc ? 'Sort ascending' : 'Sort descending'}
              >
                {sortAsc ? '↑' : '↓'}
              </button>

              <div className="flex-1 min-w-0 relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  aria-label="Search unipacks"
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setSearchQuery('');
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder="Search..."
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-white/[0.04] text-xs text-white placeholder:text-white/25 outline-none border border-transparent focus:border-accent/30 focus:bg-white/[0.07] transition-colors"
                />
              </div>
            </>
          )}

          {!savedPacks.length && <div className="flex-1" />}

          {savedPacks.length > 0 && <div className="w-px h-5 bg-white/[0.08] shrink-0" />}

          <button
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] hover:border-accent/20 text-xs text-white/50 transition-colors border border-transparent"
            onClick={onImportTheme}
          >
            Theme
          </button>
          <button
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] hover:border-secondary/20 text-xs text-white/50 transition-all border border-transparent relative group"
            onClick={onOpenStore}
          >
            Store
            {storeCount > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-medium ${hasStoreUpdate ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-white/40'}`}>
                {storeCount}
              </span>
            )}
            {hasStoreUpdate && (
              reduceMotion ? (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
              ) : (
                <motion.span
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.25, 1], opacity: [0.75, 1, 0.75] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                />
              )
            )}
          </button>
          <button
            className="relative px-4 py-1.5 rounded-xl text-xs text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.97] group"
            style={{ background: 'var(--accent)' }}
            onClick={onImport}
          >
            <span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-40 blur-sm -z-10 group-hover:opacity-60 transition-opacity" />
            + Import
          </button>
        </div>

        {/* Pack List */}
        <div role="listbox" aria-label="UniPack list" className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 rounded-xl">
          {filteredAndSortedPacks.length === 0 ? (
            searchQuery.trim() ? (
              <NoResults query={searchQuery.trim()} onClear={() => setSearchQuery('')} />
            ) : (
              <EmptyState onImport={onImport} onOpenStore={onOpenStore} />
            )
          ) : (
            <div className="flex flex-col gap-1">
              {filteredAndSortedPacks.map((pack, index) => (
                <UnipackListItem
                  key={pack.id}
                  pack={pack}
                  isSelected={pack.id === selectedId}
                  onClick={() => handleItemClick(pack.id)}
                  onDoubleClick={() => handleItemDoubleClick(pack.id)}
                  onPlay={() => onPlay(pack.id)}
                  index={index}
                  reduceMotion={Boolean(reduceMotion)}
                />
              ))}
            </div>
          )}
        </div>

        {savedPacks.length > 0 && (
        <div className="shrink-0 px-4 py-3 text-[10px] text-white/20 flex items-center justify-center gap-4 border-t border-white/[0.04]">
          <KeyHint keys="↑↓" label="select" />
          <KeyHint keys="Enter" label="play" />
          <KeyHint keys="Del" label="delete" />
          <KeyHint keys="/" label="search" />
        </div>
        )}
      </div>

      <AnimatePresence>
        {deleteConfirmId && (
          <ConfirmDialog
            message={`Delete "${savedPacks.find((p) => p.id === deleteConfirmId)?.title ?? 'this UniPack'}"?`}
            onConfirm={confirmDelete}
            onCancel={() => setDeleteConfirmId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TotalPanel({
  packs,
  themes,
  onDeleteTheme,
}: {
  packs: StoredUniPack[];
  themes: StoredTheme[];
  onDeleteTheme: (id: string) => void;
}) {
  const ledCount = packs.filter((p) => p.keyLedExist).length;
  const apCount = packs.filter((p) => p.autoPlayExist).length;

  return (
    <div className="w-full rounded-2xl bg-white/[0.03] backdrop-blur-md border border-white/[0.08] flex flex-col items-center p-5 relative overflow-y-auto transition-all hover:border-accent/20 hover:shadow-[0_0_40px_-10px_rgba(255,143,0,0.1)]">
      {/* Ambient glow */}
      <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 w-60 h-60 rounded-full opacity-15 blur-[80px] pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--accent), transparent)' }}
      />

      <div className="flex flex-col items-center gap-1 relative">
        <img
          src="/theme/custom_logo.png"
          alt="UniPad"
          className="w-32 h-auto opacity-90"
          draggable={false}
        />
        <span className="text-[10px] text-white/25 tracking-widest uppercase font-medium">Web Player</span>
      </div>

      <div className="mt-4 w-full grid grid-cols-2 gap-2">
        <StatBlock label="UniPacks" value={packs.length.toString()} />
        <StatBlock label="Themes" value={themes.length.toString()} />
        {packs.length > 0 && (
          <>
            <StatBlock label="LED" value={ledCount.toString()} accent="green" />
            <StatBlock label="AutoPlay" value={apCount.toString()} accent="secondary" />
          </>
        )}
      </div>

      {themes.length > 0 && (
        <div className="mt-4 w-full space-y-1.5">
          <div className="text-[10px] text-white/30 uppercase tracking-wider px-1">Themes</div>
          {themes.map((t) => (
            <div key={t.id} className="flex items-center justify-between bg-white/[0.04] rounded-lg border border-white/[0.06] px-3 py-2 hover:border-accent/15 transition-colors">
              <span className="text-xs text-white/70 truncate">{t.name || t.id}</span>
              <button
                className="p-1 text-white/30 hover:text-red-400 transition-colors shrink-0"
                onClick={() => onDeleteTheme(t.id)}
                aria-label="Delete theme"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'secondary' }) {
  const colorClass = accent === 'green'
    ? 'text-green-400/90'
    : accent === 'secondary'
      ? 'text-[var(--secondary)]'
      : 'text-accent';
  const glowStyle = accent === 'green'
    ? { boxShadow: 'inset 0 0 20px rgba(74,222,128,0.04)' }
    : accent === 'secondary'
      ? { boxShadow: 'inset 0 0 20px rgba(0,184,212,0.04)' }
      : { boxShadow: 'inset 0 0 20px rgba(255,143,0,0.04)' };

  return (
    <div
      className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-3 text-center backdrop-blur-sm hover:border-white/[0.12] transition-colors"
      style={glowStyle}
    >
      <div className={`text-xl font-extrabold ${colorClass}`}>{value}</div>
      <div className="text-[10px] text-white/35 mt-0.5 font-medium">{label}</div>
    </div>
  );
}

function PackDetailPanel({
  pack,
  onPlay,
  onDelete,
}: {
  pack: StoredUniPack;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const addedDate = new Date(pack.addedAt).toLocaleDateString();
  const lastOpened = new Date(pack.lastOpenedAt).toLocaleDateString();

  return (
    <div className="w-full rounded-2xl bg-white/[0.03] backdrop-blur-md border border-white/[0.08] flex flex-col items-center p-5 text-white overflow-hidden relative transition-all hover:shadow-[0_0_40px_-10px_rgba(255,143,0,0.1)]">
        {/* Ambient glow */}
        <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 w-64 h-64 rounded-full opacity-10 blur-[80px] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent), transparent)' }}
        />

        {/* Title area */}
        <h2 className="text-lg font-extrabold text-white text-center leading-tight relative tracking-tight">{pack.title}</h2>
        <p className="text-xs text-white/45 mt-1">{pack.producerName}</p>

        {/* Badges */}
        {(pack.keyLedExist || pack.autoPlayExist) && (
          <div className="flex gap-2 mt-3">
            {pack.keyLedExist && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
                <span className="text-[10px] font-semibold text-green-400/90">LED</span>
              </span>
            )}
            {pack.autoPlayExist && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--secondary)]/10 border border-[var(--secondary)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--secondary)] shadow-[0_0_6px_rgba(0,184,212,0.5)]" />
                <span className="text-[10px] font-semibold text-[var(--secondary)]">AutoPlay</span>
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 w-full grid grid-cols-2 gap-2">
          <PropertyBlock label="Pad Size" value={`${pack.buttonX} × ${pack.buttonY}`} />
          <PropertyBlock label={pack.chain === 1 ? 'Chain' : 'Chains'} value={pack.chain.toString()} />
        </div>

        {/* Play button */}
        <div className="mt-4 w-full flex gap-2">
        <button
          className="relative flex-1 py-3 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] group"
          style={{ background: 'var(--accent)' }}
          onClick={onPlay}
        >
          <span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-50 blur-sm -z-10 group-hover:opacity-70 transition-opacity" />
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          Play
        </button>
        <button
          className="w-14 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-red-500/10 hover:border-red-500/20 text-white/25 hover:text-red-400 transition-all flex items-center justify-center"
          onClick={onDelete}
          aria-label="Delete UniPack"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        </div>

        {/* Meta */}
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          {pack.storeCode && (
            <div className="text-[10px] text-white/30 text-center mb-2">
              <span className="text-white/20">Code</span>{' '}
              <span className="text-accent/60 font-mono">{pack.storeCode}</span>
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 text-[9px] text-white/20">
            <span>{addedDate}</span>
            <span className="text-white/10">·</span>
            <span>{lastOpened}</span>
          </div>
        </div>
    </div>
  );
}

function PropertyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-center backdrop-blur-sm"
      style={{ boxShadow: 'inset 0 0 15px rgba(255,143,0,0.02)' }}
    >
      <div className="text-sm font-bold text-white/85">{value}</div>
      <div className="text-[10px] text-white/35 mt-0.5">{label}</div>
    </div>
  );
}

function UnipackListItem({
  pack,
  isSelected,
  onClick,
  onDoubleClick,
  onPlay,
  index,
  reduceMotion,
}: {
  pack: StoredUniPack;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onPlay: () => void;
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, delay: reduceMotion ? 0 : Math.min(index * 0.01, 0.08) }}
      data-pack-id={pack.id}
      role="button"
      tabIndex={0}
      aria-label={`${pack.title} by ${pack.producerName}`}
      aria-selected={isSelected}
      className={`flex h-[72px] cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl ${
        isSelected
          ? 'bg-accent/[0.08] border border-accent/25'
          : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04] hover:border-white/[0.08]'
      }`}
      style={isSelected ? { boxShadow: '0 0 25px -5px rgba(255,143,0,0.12)' } : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onDoubleClick();
        }
      }}
    >
      {/* Accent bar */}
      <div className={`w-[3px] shrink-0 transition-colors rounded-l-xl ${isSelected ? 'bg-accent shadow-[0_0_8px_rgba(255,143,0,0.4)]' : 'bg-transparent'}`} />

      {/* Content */}
      <div className="flex-1 flex items-center px-4 min-w-0">
        {/* Pad icon */}
        <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-bold transition-colors ${
          isSelected ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-white/20'
        }`}>
          {pack.buttonX}×{pack.buttonY}
        </div>

        <div className="flex-1 min-w-0 ml-3">
          <div className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-white/85'}`}>{pack.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <span className={`text-xs truncate ${isSelected ? 'text-white/45' : 'text-white/35'}`}>{pack.producerName}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-white/25">{pack.chain}ch</span>
            {pack.keyLedExist && (
              <span className="flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-green-400/80 shadow-[0_0_4px_rgba(74,222,128,0.4)]" />
                <span className="text-[9px] font-medium text-green-400/60">LED</span>
              </span>
            )}
            {pack.autoPlayExist && (
              <span className="flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-[var(--secondary)] shadow-[0_0_4px_rgba(0,184,212,0.4)]" />
                <span className="text-[9px] font-medium text-[var(--secondary)]/60">AP</span>
              </span>
            )}
          </div>
        </div>

        {/* Play button on selected */}
        {isSelected && (
          <button
            className="relative shrink-0 ml-2 w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 group"
            style={{ background: 'var(--accent)' }}
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            aria-label={`Play ${pack.title}`}
            tabIndex={-1}
          >
            <span className="absolute -inset-[2px] rounded-full bg-accent opacity-30 blur-md -z-10 group-hover:opacity-50 transition-opacity" />
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}
      </div>
    </motion.div>
  );
}


function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
      <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <p className="text-white/30 text-sm text-center">
        No results for &ldquo;<span className="text-accent/60">{query}</span>&rdquo;
      </p>
      <button
        className="px-4 py-2.5 rounded-xl text-xs font-medium bg-white/[0.04] text-white/50 hover:bg-white/[0.08] border border-white/[0.06] hover:border-accent/15 transition-all"
        onClick={onClear}
      >
        Clear search
      </button>
    </div>
  );
}

function EmptyState({ onImport, onOpenStore }: { onImport: () => void; onOpenStore?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-16">
      {/* Pad grid icon */}
      <div className="w-16 h-16 rounded-2xl bg-white/[0.03] backdrop-blur-md border border-white/[0.08] flex items-center justify-center relative">
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{
                backgroundColor: i % 3 === 1 ? 'rgba(255,143,0,0.2)' : 'rgba(0,184,212,0.1)',
                animation: `pad-pulse ${2 + i * 0.3}s ease-in-out ${i * 0.2}s infinite`,
                ['--pad-glow' as string]: i % 3 === 1 ? 'rgba(255,143,0,0.3)' : 'rgba(0,184,212,0.15)',
              }}
            />
          ))}
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-white/40 text-sm font-medium">No UniPacks installed</p>
        <p className="text-white/25 text-xs">Import a .zip file or browse the store</p>
      </div>
      <div className="flex gap-2">
        <button
          className="relative px-5 py-2.5 rounded-xl text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.97] group"
          style={{ background: 'var(--accent)' }}
          onClick={onImport}
        >
          <span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-40 blur-sm -z-10 group-hover:opacity-60 transition-opacity" />
          Import UniPack
        </button>
        {onOpenStore && (
          <button
            className="px-5 py-2.5 rounded-xl text-xs font-medium bg-white/[0.03] text-white/50 hover:bg-white/[0.06] border border-white/[0.06] hover:border-secondary/20 backdrop-blur-md transition-all"
            onClick={onOpenStore}
          >
            Browse Store
          </button>
        )}
      </div>
    </div>
  );
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.06] text-white/40 text-[9px] font-mono leading-tight shadow-sm">{keys}</kbd>
      <span className="text-white/25">{label}</span>
    </span>
  );
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancel();
      }
      if (e.key === 'Enter') {
        e.stopImmediatePropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onConfirm, onCancel]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm deletion"
        className="relative bg-[var(--card)] border border-white/[0.08] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-[0_0_40px_rgba(0,0,0,0.4)]"
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      >
        <p className="text-sm text-white/90 mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2.5 rounded-xl text-xs text-white/60 bg-white/[0.06] hover:bg-white/10 transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2.5 rounded-xl text-xs text-red-300 bg-red-500/15 hover:bg-red-500/25 transition-colors"
            onClick={onConfirm}
            autoFocus
          >
            Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
