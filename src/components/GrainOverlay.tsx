'use client';

import { useEffect, useRef, useState } from 'react';

export default function GrainOverlay() {
	const [mounted, setMounted] = useState(false);
	const turbulenceRef = useRef<SVGFETurbulenceElement>(null);
	const frameRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;

		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (prefersReducedMotion) return;

		const animate = () => {
			frameRef.current++;
			if (frameRef.current % 8 === 0 && turbulenceRef.current) {
				turbulenceRef.current.setAttribute(
					'seed',
					String(Math.floor(Math.random() * 1000)),
				);
			}
			rafRef.current = requestAnimationFrame(animate);
		};

		rafRef.current = requestAnimationFrame(animate);

		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [mounted]);

	if (!mounted) return null;

	return (
		<>
			<svg
				aria-hidden="true"
				style={{
					position: 'fixed',
					width: 0,
					height: 0,
					overflow: 'hidden',
				}}
			>
				<defs>
					<filter
						id="portfolio-grain-filter"
						x="0%"
						y="0%"
						width="100%"
						height="100%"
						colorInterpolationFilters="linearRGB"
					>
						<feTurbulence
							ref={turbulenceRef}
							type="fractalNoise"
							baseFrequency="0.65"
							numOctaves="3"
							stitchTiles="stitch"
							result="noise"
						/>
						<feColorMatrix
							type="saturate"
							values="0"
							in="noise"
						/>
					</filter>
				</defs>
			</svg>

			<div
				aria-hidden="true"
				className="fixed inset-0 pointer-events-none"
				style={{
					zIndex: 9990,
					filter: 'url(#portfolio-grain-filter)',
					opacity: 0.04,
					mixBlendMode: 'overlay',
					willChange: 'filter',
				}}
			/>
		</>
	);
}
