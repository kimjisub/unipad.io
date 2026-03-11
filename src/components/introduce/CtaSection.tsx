'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Download, Star, Heart, Play, Code } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { GradientText } from '@/components/GradientText';
import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { Link } from '@/i18n/navigation';
import { GOOGLE_PLAY_URL } from '@/lib/constants';

export const CtaSection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-80px' });
	const t = useTranslations('cta');

	return (
		<section className="py-28 relative" aria-label={t('title')} ref={ref}>
			{/* Top fade: blend from FAQ bg-card/20 into this section */}
			<div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[var(--card)]/20 to-transparent pointer-events-none" aria-hidden />

			{/* Background glows */}
			<div className="absolute inset-0" aria-hidden>
				<motion.div
					className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
					style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
					animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
					transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
				/>
				<motion.div
					className="absolute top-[40%] left-[30%] w-[400px] h-[400px] rounded-full opacity-[0.12] blur-[100px]"
					style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
					animate={{ scale: [1, 1.15, 1], y: [0, -15, 0] }}
					transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
				/>
				<motion.div
					className="absolute bottom-[20%] right-[25%] w-[300px] h-[300px] rounded-full opacity-[0.08] blur-[80px]"
					style={{ background: 'radial-gradient(circle, var(--mesh-color-4) 0%, transparent 70%)' }}
					animate={{ scale: [1, 1.1, 1], x: [0, -15, 0] }}
					transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
				/>
			</div>

			{/* Top gradient line */}
			<div className="absolute inset-x-0 top-0 h-px" aria-hidden>
				<div className="mx-auto h-px w-1/2 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
			</div>

			<div className="relative z-10 max-w-3xl mx-auto px-4 md:px-6 text-center">
				<motion.h2
					className="text-3xl md:text-5xl font-bold text-foreground mb-4 tracking-tight"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5 }}
				>
					<GradientText duration={6}>{t('title')}</GradientText>
				</motion.h2>
				<motion.p
					className="text-lg md:text-xl text-muted-foreground mb-10"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.1 }}
				>
					{t('subtitle')}
				</motion.p>
				<motion.div
					className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center w-full max-w-md sm:max-w-none sm:w-auto mx-auto"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.2 }}
				>
					<Link
						href="/play"
						className="relative px-8 py-3.5 rounded-xl bg-accent text-accent-foreground font-semibold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] group inline-flex items-center justify-center gap-2"
					>
						<span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-60 blur-sm -z-10 group-hover:opacity-80 transition-opacity" />
						<span className="absolute -inset-[2px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-25 blur-md -z-10 group-hover:opacity-40 transition-opacity" />
						<Play className="w-5 h-5 fill-current" />
						{t('playNow')}
					</Link>
					<a
						href={GOOGLE_PLAY_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="px-8 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md text-foreground font-medium text-lg text-center transition-all duration-300 hover:bg-white/[0.06] hover:border-white/[0.15] hover:shadow-[0_0_20px_-5px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2"
					>
						<AndroidLogo className="w-5 h-5" />
						{t('download')}
					</a>
				</motion.div>

				{/* Social proof */}
				<motion.div
					className="flex flex-wrap items-center justify-center gap-4 mt-8"
					initial={{ opacity: 0 }}
					animate={isInView ? { opacity: 1 } : {}}
					transition={{ duration: 0.5, delay: 0.4 }}
				>
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
						<Download className="w-3 h-3" />
						9.2M+
					</span>
					<span className="w-px h-3 bg-white/10" aria-hidden />
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
						<Star className="w-3 h-3" />
						4.0★
					</span>
					<span className="w-px h-3 bg-white/10" aria-hidden />
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
						<Heart className="w-3 h-3" />
						{t('free')}
					</span>
					<span className="w-px h-3 bg-white/10" aria-hidden />
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
						<Code className="w-3 h-3" />
						Open Source
					</span>
				</motion.div>
			</div>

			{/* Bottom fade to footer */}
			<div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[var(--background)]/40 pointer-events-none" aria-hidden />
		</section>
	);
};
