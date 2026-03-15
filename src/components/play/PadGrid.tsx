'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import type { PadState } from './useUniPadEngine';
import type { ThemeAssets } from '@/lib/unipack';

interface PadGridProps {
  buttonX: number;
  buttonY: number;
  padStates: PadState[][];
  squareButton: boolean;
  theme: ThemeAssets | null;
  traceLogSequence?: { x: number; y: number }[];
  onPadDown: (x: number, y: number) => void;
  onPadUp: (x: number, y: number) => void;
}

export function PadGrid({
  buttonX,
  buttonY,
  padStates,
  squareButton,
  theme,
  traceLogSequence,
  onPadDown,
  onPadUp,
}: PadGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const pointerPadMap = useRef(new Map<number, string>());
  const [guideNowMs, setGuideNowMs] = useState(0);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });

  const hasActiveGuideAnimation = useMemo(
    () => padStates.some((row) => row.some((pad) => pad.guide && (pad.guideTargetWallTimeMs ?? 0) > 0)),
    [padStates],
  );

  const getPadFromPoint = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const padEl = el.closest('[data-pad]');
    if (!padEl) return null;
    const [x, y] = (padEl as HTMLElement).dataset.pad!.split(',').map(Number);
    return [x, y];
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      try { grid.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      const pad = getPadFromPoint(e.clientX, e.clientY);
      if (pad) {
        const key = `${pad[0]},${pad[1]}`;
        pointerPadMap.current.set(e.pointerId, key);
        onPadDown(pad[0], pad[1]);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!pointerPadMap.current.has(e.pointerId)) return;
      const pad = getPadFromPoint(e.clientX, e.clientY);
      const prevKey = pointerPadMap.current.get(e.pointerId)!;
      const newKey = pad ? `${pad[0]},${pad[1]}` : null;
      if (prevKey !== newKey) {
        if (prevKey) {
          const [px, py] = prevKey.split(',').map(Number);
          onPadUp(px, py);
        }
        if (newKey && pad) {
          pointerPadMap.current.set(e.pointerId, newKey);
          onPadDown(pad[0], pad[1]);
        } else {
          pointerPadMap.current.delete(e.pointerId);
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const prevKey = pointerPadMap.current.get(e.pointerId);
      if (prevKey) {
        const [px, py] = prevKey.split(',').map(Number);
        onPadUp(px, py);
        pointerPadMap.current.delete(e.pointerId);
      }
      try { grid.releasePointerCapture(e.pointerId); } catch { /* */ }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const prevKey = pointerPadMap.current.get(e.pointerId);
      if (prevKey) {
        const [px, py] = prevKey.split(',').map(Number);
        onPadUp(px, py);
        pointerPadMap.current.delete(e.pointerId);
      }
    };

    const handleContextMenu = (e: Event) => e.preventDefault();

    grid.addEventListener('pointerdown', handlePointerDown);
    grid.addEventListener('pointermove', handlePointerMove);
    grid.addEventListener('pointerup', handlePointerUp);
    grid.addEventListener('pointercancel', handlePointerCancel);
    grid.addEventListener('contextmenu', handleContextMenu);

    return () => {
      grid.removeEventListener('pointerdown', handlePointerDown);
      grid.removeEventListener('pointermove', handlePointerMove);
      grid.removeEventListener('pointerup', handlePointerUp);
      grid.removeEventListener('pointercancel', handlePointerCancel);
      grid.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [onPadDown, onPadUp, getPadFromPoint]);

  useEffect(() => {
    if (!hasActiveGuideAnimation) return;
    let frame = 0;
    const tick = () => {
      setGuideNowMs(performance.now());
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [hasActiveGuideAnimation]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateSize = () => {
      const rect = grid.getBoundingClientRect();
      setGridSize((prev) => (
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      ));
    };

    updateSize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    observer?.observe(grid);
    window.addEventListener('resize', updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const hasThemeBtn = theme?.btn || theme?.btnPressed;
  const centerX = Math.floor(buttonX / 2) - 1;
  const centerY = Math.floor(buttonY / 2) - 1;
  const padCellWidth = buttonY > 0 ? gridSize.width / buttonY : 0;
  const padCellHeight = buttonX > 0 ? gridSize.height / buttonX : 0;
  const padCellMin = Math.min(padCellWidth || 0, padCellHeight || 0);

  const tracePoints = useMemo(() => {
    if (!traceLogSequence || traceLogSequence.length === 0 || gridSize.width === 0 || gridSize.height === 0) return [];
    const cellW = gridSize.width / buttonY;
    const cellH = gridSize.height / buttonX;
    const maxOffset = Math.min(cellW, cellH) * 0.3;
    const padVisitTotal = new Map<string, number>();
    for (const p of traceLogSequence) {
      const key = `${p.x},${p.y}`;
      padVisitTotal.set(key, (padVisitTotal.get(key) ?? 0) + 1);
    }

    const visitIndex = new Map<string, number>();
    return traceLogSequence.map((p) => {
      const key = `${p.x},${p.y}`;
      const total = padVisitTotal.get(key) ?? 1;
      const idx = visitIndex.get(key) ?? 0;
      visitIndex.set(key, idx + 1);

      let ox = 0;
      let oy = 0;
      if (total > 1) {
        const t = total === 1 ? 0 : idx / (total - 1) - 0.5;
        ox = t * maxOffset;
        oy = t * maxOffset;
      }

      return {
        cx: p.y * cellW + cellW / 2 + ox,
        cy: p.x * cellH + cellH / 2 + oy,
      };
    });
  }, [traceLogSequence, gridSize, buttonX, buttonY]);

  const traceLinePath = useMemo(() => {
    if (tracePoints.length < 2) return '';
    return tracePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx},${p.cy}`)
      .join(' ');
  }, [tracePoints]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={gridRef}
        className="grid select-none touch-none w-full h-full"
        style={{
          gridTemplateColumns: `repeat(${buttonY}, 1fr)`,
          gridTemplateRows: `repeat(${buttonX}, 1fr)`,
          gap: '0px',
        }}
      >
      {Array.from({ length: buttonX }, (_, x) =>
        Array.from({ length: buttonY }, (_, y) => {
          const pad = padStates[x]?.[y];
          const bgColor = pad?.color || 'transparent';
          const isPressed = pad?.pressed || false;
          const pressedIsWinning = pad?.pressedIsWinning || false;
          const isGuide = pad?.guide || false;
          const guideTargetWallTimeMs = pad?.guideTargetWallTimeMs ?? null;

          let phantomImage: string | null = null;
          let phantomRotation = 0;
          // Android: phantom is only shown when grid is smaller than 16x16
          phantomImage = (buttonX < 16 && buttonY < 16) ? (theme?.phantom ?? null) : null;
          // Android parity: phantom_ is only used for center 2x2 in even square grids.
          if (
            theme?.phantomVariant
            && squareButton
            && buttonX % 2 === 0
            && buttonY % 2 === 0
          ) {
            if (x === centerX && y === centerY) {
              phantomImage = theme.phantomVariant;
            } else if (x === centerX + 1 && y === centerY) {
              phantomImage = theme.phantomVariant;
              phantomRotation = 270;
            } else if (x === centerX && y === centerY + 1) {
              phantomImage = theme.phantomVariant;
              phantomRotation = 90;
            } else if (x === centerX + 1 && y === centerY + 1) {
              phantomImage = theme.phantomVariant;
              phantomRotation = 180;
            }
          }

          // Android PadView order:
          // background(btn) -> led(color or btn_) -> phantom -> traceLog
          const hasLedColor = bgColor !== 'transparent';
          const buttonBase = theme?.btn;
          const ledPressedOverlay = pressedIsWinning && theme?.btnPressed ? theme.btnPressed : null;
          const guideRemaining = guideTargetWallTimeMs ? Math.max(0, guideTargetWallTimeMs - guideNowMs) : 0;
          const guideProgress = guideTargetWallTimeMs ? Math.min(1, Math.max(0, 1 - guideRemaining / 800)) : 0;
          return (
            <div
              key={`${x}-${y}`}
              data-pad={`${x},${y}`}
              className={`
                relative overflow-hidden
                ${!hasThemeBtn ? 'rounded-[2px] sm:rounded-[3px]' : ''}
                ${!hasThemeBtn ? 'transition-[filter] duration-75' : ''}
                ${!hasThemeBtn && isPressed ? 'brightness-125' : ''}
              `}
              style={{
                aspectRatio: squareButton ? '1' : undefined,
                minHeight: squareButton ? undefined : '2.5rem',
              }}
            >
              {/* Layer 1: button base */}
              {buttonBase ? (
                <img
                  src={buttonBase}
                  alt=""
                  className="absolute inset-0 w-full h-full object-fill pointer-events-none z-0"
                  draggable={false}
                />
              ) : (
                <div
                  className="absolute inset-0 z-0"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                />
              )}

              {/* Layer 2: color overlay */}
              {ledPressedOverlay ? (
                <img
                  src={ledPressedOverlay}
                  alt=""
                  className="absolute inset-0 w-full h-full object-fill pointer-events-none z-10"
                  draggable={false}
                />
              ) : hasLedColor ? (
                <div
                  className="absolute inset-0 pointer-events-none z-10"
                  style={{ backgroundColor: bgColor }}
                />
              ) : null}

              {/* Layer 3: Phantom overlay for guide state */}
              {phantomImage && (
                <img
                  src={phantomImage}
                  alt=""
                  className="absolute inset-0 w-full h-full object-fill pointer-events-none z-20"
                  style={{ transform: `rotate(${phantomRotation}deg)` }}
                  draggable={false}
                />
              )}

              {/* GuideTimingView: dark rect that shrinks toward center (Android parity) */}
              {isGuide && (() => {
                const insetPct = guideProgress * 50;
                return (
                  <div
                    className="absolute pointer-events-none z-[25]"
                    style={{
                      top: `${insetPct}%`,
                      left: `${insetPct}%`,
                      right: `${insetPct}%`,
                      bottom: `${insetPct}%`,
                      backgroundColor: 'rgba(0,0,0,0.87)',
                    }}
                  />
                );
              })()}

            </div>
          );
        }),
      )}
      </div>
      {/* TraceLog: SVG overlay with lines and dots */}
      {tracePoints.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-40"
          viewBox={`0 0 ${gridSize.width} ${gridSize.height}`}
          preserveAspectRatio="none"
        >
          {traceLinePath && (
            <path
              d={traceLinePath}
              fill="none"
              stroke={'#ffffff'}
              strokeWidth={Math.max(1.5, padCellMin * 0.04)}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          )}
          {tracePoints.map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={Math.max(2.5, padCellMin * 0.06)}
              fill={'#ffffff'}
              opacity={0.95}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
