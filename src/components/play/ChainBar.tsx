'use client';

import type { ThemeAssets } from '@/lib/unipack';

interface ChainBarProps {
  chainCount: number;
  slotCount?: number;
  chainStates: { color: string; active: boolean; guide?: boolean }[];
  currentChain: number;
  showSelectedState?: boolean;
  theme: ThemeAssets | null;
  proLightMode?: boolean;
  onChainSelect: (c: number) => void;
}

const MAX_CHAIN_BUTTONS = 24;

export function ChainBar({
  chainCount,
  slotCount,
  chainStates,
  currentChain,
  showSelectedState = true,
  theme,
  proLightMode = false,
  onChainSelect,
}: ChainBarProps) {
  const isLedMode = theme?.isChainLed && theme?.chainled;
  const desiredSlots = slotCount ?? chainCount;
  const visibleCount = Math.max(1, proLightMode ? Math.max(MAX_CHAIN_BUTTONS, desiredSlots) : desiredSlots);
  const heightPercent = visibleCount > 0 ? 100 / visibleCount : 100;

  return (
    <div className="h-full flex flex-col gap-0 items-center">
      {Array.from({ length: visibleCount }, (_, i) => {
        if (i >= chainCount) {
          return (
            <div
              key={i}
              className="w-full"
              style={{
                height: `${heightPercent}%`,
                aspectRatio: '1 / 1',
              }}
            />
          );
        }

        const state = chainStates[i];
        const isActive = showSelectedState && i === currentChain;
        const isGuide = state?.guide || false;
        const bgColor = state?.color || 'transparent';
        const stateOverlay = isLedMode
          ? theme?.chainled ?? null
          : (isGuide ? (theme?.chainGuide ?? theme?.chain ?? null) : (isActive ? (theme?.chainSelected ?? theme?.chain ?? null) : (theme?.chain ?? null)));
        const backgroundBase = isLedMode ? (theme?.btn ?? null) : null;

        return (
          <button
            key={i}
            className="w-full flex items-center justify-center relative overflow-hidden"
            style={{
              height: `${heightPercent}%`,
              aspectRatio: '1 / 1',
            }}
            aria-label={`Chain ${i + 1}`}
            onPointerDown={(e) => { e.preventDefault(); onChainSelect(i); }}
          >
            {/* Layer 1: background */}
            {backgroundBase ? (
              <img
                src={backgroundBase}
                alt=""
                className="absolute inset-0 w-full h-full object-fill pointer-events-none z-0"
                draggable={false}
              />
            ) : (
              <div
                className="absolute inset-0 z-0"
                style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)' }}
              />
            )}

            {/* Layer 2: led color */}
            {bgColor !== 'transparent' && (
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{ backgroundColor: bgColor }}
              />
            )}

            {/* Layer 3: phantom/state image */}
            {stateOverlay && (
              <img
                src={stateOverlay}
                alt=""
                className="absolute inset-0 w-full h-full object-fill pointer-events-none z-20"
                draggable={false}
              />
            )}

          </button>
        );
      })}
    </div>
  );
}
