'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

// Matches the button's `right-6 w-10 h-10` and the default `bottom-6`, in rem.
const EDGE_REM = 1.5;
const SIZE_REM = 2.5;
const CLEARANCE_PX = 8;
// Footer items fade and slide in, so their final position is known only after the animation.
const REMEASURE_DELAY_MS = 900;

/**
 * The lowest `bottom` (px) at which the button covers no footer link or button,
 * such as the install links. Null when no such place is left on screen.
 */
function findClearBottom(): number | null {
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
	const baseBottom = EDGE_REM * rem;
	const footer = document.querySelector('footer');
	if (!footer) return baseBottom;

	const size = SIZE_REM * rem;
	const right = document.documentElement.clientWidth - EDGE_REM * rem;
	const left = right - size;
	const targets = [...footer.querySelectorAll('a, button')]
		.map((el) => el.getBoundingClientRect())
		.filter((rect) => rect.width > 0 && rect.height > 0 && rect.left < right && left < rect.right);

	let bottom = baseBottom;
	for (let i = 0; i <= targets.length; i++) {
		const top = window.innerHeight - bottom - size;
		if (top < 0) return null;
		const covered = targets.filter((rect) => rect.top < top + size + CLEARANCE_PX && top - CLEARANCE_PX < rect.bottom);
		if (covered.length === 0) return bottom;
		bottom = window.innerHeight - Math.min(...covered.map((rect) => rect.top)) + CLEARANCE_PX;
	}
	return null;
}

export function ScrollToTop() {
	const [visible, setVisible] = useState(false);
	const [clearBottom, setClearBottom] = useState<number | null>();

	useEffect(() => {
		const handleScroll = () => {
			setVisible(window.scrollY > 600);
		};
		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	useEffect(() => {
		if (!visible) return;
		let frame = 0;
		let timer = 0;
		const update = () => setClearBottom(findClearBottom());
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
			window.clearTimeout(timer);
			timer = window.setTimeout(update, REMEASURE_DELAY_MS);
		};
		schedule();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
		};
	}, [visible]);

	return (
		<AnimatePresence>
			{visible && clearBottom !== null && (
				<motion.button
					initial={{ opacity: 0, scale: 0.8 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.8 }}
					transition={{ duration: 0.2 }}
					onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
					style={{ bottom: clearBottom ?? `${EDGE_REM}rem` }}
					className="fixed right-6 z-40 w-10 h-10 rounded-full border border-white/[0.1] bg-card/80 backdrop-blur-md text-muted-foreground hover:text-foreground hover:border-accent/30 hover:bg-card transition-colors flex items-center justify-center shadow-lg"
					aria-label="Scroll to top"
				>
					<ArrowUp className="w-4 h-4" />
				</motion.button>
			)}
		</AnimatePresence>
	);
}
