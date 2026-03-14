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
  /** Chain index range to display (default: 0..7 for right bar) */
  rangeStart?: number;
  rangeEnd?: number;
  /** Reverse display order (Android: left chain bar is reversed) */
  reversed?: boolean;
  /** Layout orientation (default: vertical for side bars, horizontal for top/bottom) */
  orientation?: 'vertical' | 'horizontal';
  onChainSelect: (c: number) => void;
}

const CHAINS_PER_SIDE = 8;

export function ChainBar({
  chainCount,
  slotCount,
  chainStates,
  currentChain,
  showSelectedState = true,
  theme,
  proLightMode = false,
  rangeStart = 0,
  rangeEnd = CHAINS_PER_SIDE,
  reversed = false,
  orientation = 'vertical',
  onChainSelect,
}: ChainBarProps) {
  const isLedMode = theme?.isChainLed && theme?.chainled;
  const slotsInRange = rangeEnd - rangeStart;
  const desiredSlots = slotCount ?? slotsInRange;
  const visibleCount = Math.max(1, proLightMode ? Math.max(slotsInRange, desiredSlots) : desiredSlots);
  const slotPercent = visibleCount > 0 ? 100 / visibleCount : 100;
  const isHorizontal = orientation === 'horizontal';

  const indices = Array.from({ length: visibleCount }, (_, slot) => {
    const chainIdx = rangeStart + (reversed ? (visibleCount - 1 - slot) : slot);
    return chainIdx;
  });

  return (
    <div className={isHorizontal ? 'w-full flex flex-row gap-0 items-center' : 'h-full flex flex-col gap-0 items-center'}>
      {indices.map((chainIdx, slot) => {
        if (chainIdx >= chainCount || chainIdx < 0) {
          return (
            <div
              key={slot}
              className={isHorizontal ? 'h-full' : 'w-full'}
              style={isHorizontal
                ? { width: `${slotPercent}%`, aspectRatio: '1 / 1' }
                : { height: `${slotPercent}%`, aspectRatio: '1 / 1' }
              }
            />
          );
        }

        const state = chainStates[chainIdx];
        const isActive = showSelectedState && chainIdx === currentChain;
        const isGuide = state?.guide || false;
        const bgColor = state?.color || 'transparent';

        // Android ChainView layer structure (bottom to top): background → led → phantom
        // isChainLed=true:  background=btn, led=dynamic color, phantom=chainled (fixed)
        // isChainLed=false: background=chain/chainGuide/chainSelected (swapped), led=GONE, phantom=chain (fixed)
        let backgroundImage: string | null;
        let showLed: boolean;
        let phantomImage: string | null;

        if (isLedMode) {
          backgroundImage = theme?.btn ?? null;
          showLed = true;
          phantomImage = theme?.chainled ?? null;
        } else {
          showLed = false;
          phantomImage = theme?.chain ?? null;
          if (isGuide) {
            backgroundImage = theme?.chainGuide ?? theme?.chain ?? null;
          } else if (isActive) {
            backgroundImage = theme?.chainSelected ?? theme?.chain ?? null;
          } else {
            backgroundImage = theme?.chain ?? null;
          }
        }

        return (
          <button
            key={slot}
            className={`${isHorizontal ? 'h-full' : 'w-full'} flex items-center justify-center relative overflow-hidden`}
            style={isHorizontal
              ? { width: `${slotPercent}%`, aspectRatio: '1 / 1' }
              : { height: `${slotPercent}%`, aspectRatio: '1 / 1' }
            }
            aria-label={`Chain ${chainIdx + 1}`}
            onPointerDown={(e) => { e.preventDefault(); onChainSelect(chainIdx); }}
          >
            {/* Layer 1: background (btn or state-based image) */}
            {backgroundImage ? (
              <img
                src={backgroundImage}
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
            {showLed && bgColor !== 'transparent' && (
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{ backgroundColor: bgColor }}
              />
            )}

            {/* Layer 3: phantom (chainled or chain image on top) */}
            {phantomImage && (
              <img
                src={phantomImage}
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
