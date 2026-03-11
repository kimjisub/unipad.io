'use client';

import { useRef } from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { FolderOpen, Music, Share2, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

type StepAccent = 'accent' | 'secondary' | 'purple';

const steps: { key: 'step1' | 'step2' | 'step3'; icon: typeof FolderOpen; accent: StepAccent }[] = [
	{ key: 'step1', icon: FolderOpen, accent: 'accent' },
	{ key: 'step2', icon: Music, accent: 'secondary' },
	{ key: 'step3', icon: Share2, accent: 'purple' },
];

const containerVariants: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.2 } },
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 24 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

export const HowItWorksSection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-80px' });
	const t = useTranslations('howItWorks');

	return (
		<section className="py-24 bg-card/20 relative overflow-hidden" aria-label={t('title')} ref={ref}>
			<motion.div
				className="absolute top-[40%] right-[15%] w-[350px] h-[250px] rounded-full opacity-[0.04] blur-[100px]"
				aria-hidden
				style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
				animate={{ scale: [1, 1.1, 1], y: [0, -8, 0] }}
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
					className="text-muted-foreground text-center mb-14 max-w-xl mx-auto"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.1 }}
				>
					{t('subtitle')}
				</motion.p>

				<motion.div
					className="relative grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6"
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
				>
					{/* Connecting line (desktop) */}
					<div className="hidden md:block absolute top-10 left-[16.67%] right-[16.67%]" aria-hidden>
						<div className="h-px w-full bg-gradient-to-r from-accent/50 via-secondary/40 to-[#a855f7]/50" />
						<div className="h-px w-full bg-gradient-to-r from-accent/20 via-secondary/15 to-[#a855f7]/20 blur-sm" />
						<div className="absolute inset-0 h-px w-full animate-shimmer" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,143,0,0.4) 50%, transparent 100%)', backgroundSize: '200% 100%' }} />
					</div>

					{steps.map((step, i) => {
						const Icon = step.icon;
						const colorMap = {
							accent: { bg: 'bg-accent/10', border: 'border-accent/20', text: 'text-accent', badge: 'bg-accent', shadow: 'group-hover:shadow-accent/20' },
							secondary: { bg: 'bg-secondary/10', border: 'border-secondary/20', text: 'text-secondary', badge: 'bg-secondary', shadow: 'group-hover:shadow-secondary/20' },
							purple: { bg: 'bg-[#a855f7]/10', border: 'border-[#a855f7]/20', text: 'text-[#a855f7]', badge: 'bg-[#a855f7]', shadow: 'group-hover:shadow-[#a855f7]/20' },
						};
						const colors = colorMap[step.accent];
						return (
							<motion.div
								key={step.key}
								variants={itemVariants}
								className="flex flex-col items-center text-center relative group p-6 rounded-2xl hover:bg-white/[0.03] transition-all duration-300"
							>
								{/* Mobile connector (between steps) */}
								{i > 0 && (() => {
									const prevColors = colorMap[steps[i - 1].accent];
									return (
										<div className="md:hidden flex flex-col items-center gap-0.5 -mt-2 mb-2" aria-hidden>
											<div className={`w-1.5 h-1.5 rounded-full ${prevColors.bg}`} />
											<div className="w-px h-4 bg-gradient-to-b from-muted-foreground/30 to-muted-foreground/10" />
											<div className={`w-1.5 h-1.5 rounded-full ${colors.bg}`} />
										</div>
									);
								})()}

								{/* Step number + icon */}
								<div className="relative mb-5">
									<div className={`w-20 h-20 rounded-2xl ${colors.bg} ${colors.border} border flex items-center justify-center group-hover:scale-110 group-hover:shadow-[0_0_30px_-5px] ${colors.shadow} transition-all duration-300`}>
										<Icon className={`w-8 h-8 ${colors.text}`} />
									</div>
									<div className={`absolute -top-2 -right-2 w-7 h-7 rounded-full ${colors.badge} text-white text-xs font-bold flex items-center justify-center shadow-lg`}>
										{i + 1}
									</div>
								</div>

								<h3 className="text-lg font-semibold text-foreground mb-2">
									{t(`${step.key}.title`)}
								</h3>
								<p className="text-sm text-muted-foreground leading-relaxed max-w-[260px]">
									{t(`${step.key}.description`)}
								</p>
							</motion.div>
						);
					})}
				</motion.div>

				<motion.div
					className="flex justify-center mt-12"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.6 }}
				>
					<Link
						href="/play"
						className="relative inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-accent-foreground font-semibold transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] group"
					>
						<span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-0 blur-sm -z-10 group-hover:opacity-60 transition-opacity" />
						{t('startNow')}
						<ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
					</Link>
				</motion.div>
			</div>
		</section>
	);
};
