'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

export function ScrollToTop() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const handleScroll = () => {
			setVisible(window.scrollY > 600);
		};
		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	return (
		<AnimatePresence>
			{visible && (
				<motion.button
					initial={{ opacity: 0, scale: 0.8 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.8 }}
					transition={{ duration: 0.2 }}
					onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
					className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full border border-white/[0.1] bg-card/80 backdrop-blur-md text-muted-foreground hover:text-foreground hover:border-accent/30 hover:bg-card transition-colors flex items-center justify-center shadow-lg"
					aria-label="Scroll to top"
				>
					<ArrowUp className="w-4 h-4" />
				</motion.button>
			)}
		</AnimatePresence>
	);
}
