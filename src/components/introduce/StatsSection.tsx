'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { Download, Star, Calendar, Heart, Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EXTERNAL_LINKS, GOOGLE_PLAY_URL } from '@/lib/constants';

type StatKey = 'downloads' | 'reviews' | 'since' | 'openSource';

const statIcons: Record<StatKey, React.ElementType> = {
	downloads: Download,
	reviews: Star,
	since: Calendar,
	openSource: Heart,
};

const statConfig: { key: StatKey; target: number; suffix: string; decimals?: number; noAnimate?: boolean; iconColor: string; iconBg: string; hoverBorder: string; hoverNumber: string; glowColor: string }[] = [
	{ key: 'downloads', target: 9.2, suffix: 'M+', decimals: 1, iconColor: 'text-accent', iconBg: 'bg-accent/10', hoverBorder: 'hover:border-accent/30', hoverNumber: 'group-hover:text-accent', glowColor: 'rgba(255,143,0,0.12)' },
	{ key: 'reviews', target: 100, suffix: 'K+', iconColor: 'text-secondary', iconBg: 'bg-secondary/10', hoverBorder: 'hover:border-secondary/30', hoverNumber: 'group-hover:text-secondary', glowColor: 'rgba(0,184,212,0.12)' },
	{ key: 'since', target: 2016, suffix: '', noAnimate: true, iconColor: 'text-[#a855f7]', iconBg: 'bg-[#a855f7]/10', hoverBorder: 'hover:border-[#a855f7]/30', hoverNumber: 'group-hover:text-[#a855f7]', glowColor: 'rgba(168,85,247,0.12)' },
	{ key: 'openSource', target: 100, suffix: '%', iconColor: 'text-accent', iconBg: 'bg-accent/10', hoverBorder: 'hover:border-accent/30', hoverNumber: 'group-hover:text-accent', glowColor: 'rgba(255,143,0,0.12)' },
];

const containerVariants: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.1 } },
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 20 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

function CountUp({ target, suffix, active, decimals = 0 }: { target: number; suffix: string; active: boolean; decimals?: number }) {
	const [value, setValue] = useState(0);
	const hasAnimated = useRef(false);

	useEffect(() => {
		if (!active || hasAnimated.current) return;
		hasAnimated.current = true;

		const duration = 1200;
		const start = performance.now();
		const from = 0;
		const factor = Math.pow(10, decimals);

		function tick(now: number) {
			const elapsed = now - start;
			const progress = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			setValue(Math.round((from + (target - from) * eased) * factor) / factor);
			if (progress < 1) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}, [active, target, decimals]);

	const display = active ? value : target;
	return <>{decimals > 0 ? display.toFixed(decimals) : display}{suffix}</>;
}

export const StatsSection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-80px' });
	const t = useTranslations('stats');

	return (
		<section className="py-24 bg-card/20 relative overflow-hidden" aria-label={t('title')} ref={ref}>
			<motion.div
				className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full opacity-[0.06] blur-[100px]"
				aria-hidden
				style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
				animate={{ scale: [1, 1.1, 1], x: [0, 10, 0] }}
				transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
			/>
			<div className="relative max-w-5xl mx-auto px-4 md:px-6">
				<motion.h2
					className="text-2xl md:text-3xl font-bold text-foreground mb-4 text-center tracking-tight"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5 }}
				>
					{t('title')}
				</motion.h2>
				<motion.p
					className="text-muted-foreground text-center mb-4 max-w-xl mx-auto"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.1 }}
				>
					{t('subtitle')}
				</motion.p>
				<motion.div
					className="flex justify-center mb-12"
					initial={{ opacity: 0, scale: 0.9 }}
					animate={isInView ? { opacity: 1, scale: 1 } : {}}
					transition={{ duration: 0.5, delay: 0.2 }}
				>
					<span className="relative inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-xs font-medium text-accent overflow-hidden">
						<span className="absolute inset-0 animate-shimmer opacity-30" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,143,0,0.3) 50%, transparent 100%)', backgroundSize: '200% 100%' }} />
						<Trophy className="w-3.5 h-3.5 relative" />
						<span className="relative">{t('achievement')}</span>
					</span>
				</motion.div>

				<motion.div
					className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6"
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
				>
					{statConfig.map(({ key, target, suffix, decimals, noAnimate, iconColor, iconBg, hoverBorder, hoverNumber, glowColor }) => {
						const Icon = statIcons[key];
						return (
							<motion.div
								key={key}
								variants={itemVariants}
								className={`relative flex flex-col items-center text-center p-4 md:p-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md ${hoverBorder} hover:bg-white/[0.06] hover:scale-[1.02] transition-all duration-300 group overflow-hidden`}
							>
								<div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" style={{ background: `radial-gradient(circle at 50% 0%, ${glowColor} 0%, transparent 60%)` }} />
								<div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg ${iconBg} flex items-center justify-center mb-2 md:mb-3 group-hover:scale-110 transition-transform duration-300`}>
									<Icon className={`w-4 h-4 md:w-5 md:h-5 ${iconColor}`} />
								</div>
								<span className={`text-3xl md:text-4xl font-bold text-foreground ${hoverNumber} mb-1 tabular-nums transition-colors`}>
									{noAnimate ? <>{target}{suffix}</> : <CountUp target={target} suffix={suffix} active={isInView} decimals={decimals} />}
								</span>
								<span className="text-sm text-muted-foreground">
									{t(key)}
								</span>
								{key === 'reviews' ? (
									<div className="flex items-center gap-0.5 mt-1.5">
										{[1, 2, 3, 4, 5].map((s) => (
											<Star key={s} className={`w-3 h-3 ${s <= 4 ? 'text-accent fill-accent' : 'text-accent/40 fill-accent/40'}`} />
										))}
										<span className="text-[10px] text-muted-foreground ml-1">4.0</span>
									</div>
								) : (
									<span className="text-[10px] text-muted-foreground/60 mt-1.5">
										{t(`${key}Desc`)}
									</span>
								)}
							</motion.div>
						);
					})}
				</motion.div>

				{/* Featured on */}
				<motion.div
					className="flex flex-col items-center gap-3 mt-12"
					initial={{ opacity: 0 }}
					animate={isInView ? { opacity: 1 } : {}}
					transition={{ duration: 0.5, delay: 0.6 }}
				>
					<span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
						{t('featuredOn')}
					</span>
					<div className="flex items-center gap-6">
						<a href={GOOGLE_PLAY_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Google Play</a>
						<span className="w-px h-3 bg-white/10" aria-hidden />
						<a href={EXTERNAL_LINKS.namuWiki} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">나무위키</a>
					</div>
				</motion.div>
			</div>
		</section>
	);
};
