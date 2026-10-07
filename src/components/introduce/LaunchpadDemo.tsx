'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const GRID = 8;
const PALETTES: [number, number, number][][] = [
	[[255, 143, 0], [255, 196, 0]],
	[[0, 184, 212], [120, 230, 255]],
	[[255, 61, 127], [255, 143, 0]],
	[[157, 255, 61], [0, 184, 212]],
	[[168, 85, 247], [255, 61, 127]],
	[[255, 212, 0], [255, 255, 255]],
	[[0, 230, 160], [157, 255, 61]],
	[[255, 255, 255], [0, 184, 212]],
];

const WAVE_SPEED = 0.011;
const WAVE_WIDTH = 1.15;
const WAVE_LIFE = 950;
/** A wave has crossed the whole grid and faded out after this long. */
export const WAVE_SETTLE_MS = WAVE_LIFE + 400;
const AUTO_INTERVAL = 520;
/** The pads light by themselves only for this long after first coming into view, so all motion ends within it. */
export const AUTO_PLAY_MS = 5000;

interface Wave {
	row: number;
	col: number;
	color: [number, number, number];
	start: number;
}

/**
 * Decorative 8x8 Launchpad. Each press emits an LED wave that expands from the
 * pressed pad. When it first comes into view it plays by itself for
 * `AUTO_PLAY_MS` (never with reduced motion), then rests until pressed. Pad
 * styles are written directly to the DOM from a rAF loop that runs only while
 * a wave is visible on screen. It makes no sound.
 */
export function LaunchpadDemo({ hint }: { hint: string }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const padRefs = useRef<(HTMLDivElement | null)[]>([]);
	const wavesRef = useRef<Wave[]>([]);
	const chainRef = useRef(0);
	const wakeRef = useRef<() => void>(() => {});
	const [chain, setChain] = useState(0);

	const emit = useCallback((row: number, col: number, now: number) => {
		const palette = PALETTES[chainRef.current];
		wavesRef.current.push({ row, col, color: palette[wavesRef.current.length % palette.length], start: now });
	}, []);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		let autoStart: number | null = null;
		let lastAuto = -Infinity;
		let visible = false;
		let raf: number | null = null;

		const autoPlaying = (now: number) =>
			!reducedMotion && autoStart !== null && now - autoStart < AUTO_PLAY_MS - WAVE_SETTLE_MS;

		const frame = (now: number) => {
			raf = null;
			if (autoPlaying(now) && now - lastAuto > AUTO_INTERVAL) {
				lastAuto = now;
				emit(Math.floor(Math.random() * GRID), Math.floor(Math.random() * GRID), now);
			}

			wavesRef.current = wavesRef.current.filter((w) => now - w.start < WAVE_SETTLE_MS);
			const waves = wavesRef.current;

			for (let i = 0; i < GRID * GRID; i++) {
				const el = padRefs.current[i];
				if (!el) continue;
				const row = Math.floor(i / GRID);
				const col = i % GRID;
				let best = 0;
				let color: [number, number, number] | null = null;
				for (const w of waves) {
					const elapsed = now - w.start;
					const radius = elapsed * WAVE_SPEED;
					const dist = Math.hypot(row - w.row, col - w.col);
					const ring = Math.max(0, 1 - Math.abs(dist - radius) / WAVE_WIDTH);
					const fade = Math.max(0, 1 - elapsed / (WAVE_LIFE + dist * 60));
					const intensity = ring * fade;
					if (intensity > best) {
						best = intensity;
						color = w.color;
					}
				}
				if (color && best > 0.03) {
					const [r, g, b] = color;
					el.style.backgroundColor = `rgba(${r},${g},${b},${0.18 + best * 0.82})`;
					el.style.boxShadow = `0 0 ${Math.round(best * 22)}px rgba(${r},${g},${b},${best * 0.55})`;
				} else {
					el.style.backgroundColor = '';
					el.style.boxShadow = '';
				}
			}

			if (visible && (waves.length > 0 || autoPlaying(now))) raf = requestAnimationFrame(frame);
		};

		const wake = () => {
			if (visible && raf === null) raf = requestAnimationFrame(frame);
		};
		wakeRef.current = wake;

		const observer = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			if (visible) {
				autoStart ??= performance.now();
				wake();
			} else if (raf !== null) {
				cancelAnimationFrame(raf);
				raf = null;
			}
		});
		observer.observe(root);

		return () => {
			observer.disconnect();
			wakeRef.current = () => {};
			if (raf !== null) cancelAnimationFrame(raf);
		};
	}, [emit]);

	const handlePadDown = (index: number) => {
		emit(Math.floor(index / GRID), index % GRID, performance.now());
		wakeRef.current();
	};

	const handleChain = (index: number) => {
		chainRef.current = index;
		setChain(index);
		handlePadDown(Math.floor(Math.random() * GRID * GRID));
	};

	return (
		<div ref={rootRef} className="relative select-none" aria-hidden>
			<div className="pointer-events-none absolute -inset-10 rounded-[48px] bg-[radial-gradient(closest-side,rgba(255,143,0,0.14),transparent)]" />
			<div className="relative rounded-[28px] border border-white/[0.07] bg-[#0c1119] p-3.5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5">
				<div className="grid grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,0.72fr)] items-center gap-1.5 sm:gap-2">
					{PALETTES.map((palette, row) => {
						const [r, g, b] = palette[0];
						const active = chain === row;
						return [
							...Array.from({ length: GRID }, (_, col) => {
								const i = row * GRID + col;
								return (
									<div
										key={i}
										ref={(el) => {
											padRefs.current[i] = el;
										}}
										data-pad
										onPointerDown={() => handlePadDown(i)}
										className="aspect-square cursor-pointer rounded-[5px] bg-white/[0.055] transition-transform duration-75 active:scale-[0.92] sm:rounded-[7px]"
									/>
								);
							}),
							<div
								key={`chain-${row}`}
								data-chain
								onPointerDown={() => handleChain(row)}
								className="ml-1 aspect-square cursor-pointer rounded-full border sm:ml-2"
								style={{
									borderColor: active ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.08)',
									backgroundColor: active ? `rgba(${r},${g},${b},0.9)` : `rgba(${r},${g},${b},0.14)`,
								}}
							/>,
						];
					})}
				</div>
			</div>
			<p className="relative mt-3.5 text-center text-[0.8125rem] text-muted-foreground">{hint}</p>
		</div>
	);
}
