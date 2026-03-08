'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const PRELOADER_KEY = 'unipad_preloader_shown';

export default function Preloader() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const shown = sessionStorage.getItem(PRELOADER_KEY);
		if (!shown) {
			setVisible(true);
			sessionStorage.setItem(PRELOADER_KEY, '1');
			const timer = setTimeout(() => setVisible(false), 1600);
			return () => clearTimeout(timer);
		}
	}, []);

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					key="preloader"
					className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background"
					initial={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.5, ease: 'easeInOut' }}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.4, ease: 'easeOut' }}
						className="text-4xl font-bold"
					>
						UniPad
					</motion.div>

					<motion.p
						className="mt-4 text-sm tracking-[0.25em] text-foreground/50 font-sans uppercase"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4, delay: 0.25, ease: 'easeOut' }}
					>
						Play Rhythm
					</motion.p>

					<motion.div
						className="mt-8 h-[2px] w-32 rounded-full overflow-hidden bg-foreground/10"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.3 }}
					>
						<motion.div
							className="h-full bg-foreground/60 rounded-full"
							initial={{ width: '0%' }}
							animate={{ width: '100%' }}
							transition={{ duration: 1.0, delay: 0.4, ease: 'easeInOut' }}
						/>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
