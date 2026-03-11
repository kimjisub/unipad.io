'use client';

import { useRef } from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { Headphones, Share2, Usb, Palette, ArrowRight, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

type FeatureKey = 'practice' | 'unipack' | 'integration' | 'theme';

const featureIcons: Record<FeatureKey, LucideIcon> = {
	practice: Headphones,
	unipack: Share2,
	integration: Usb,
	theme: Palette,
};

const featureKeys: FeatureKey[] = ['practice', 'unipack', 'integration', 'theme'];

const featureLinks: Partial<Record<FeatureKey, string>> = {
	practice: '/play',
	unipack: '/docs/unipack',
	theme: '/docs/theme',
};

const featureColors: Record<FeatureKey, { icon: string; bg: string; hoverBg: string; hoverBorder: string; glow: string; linkColor: string }> = {
	practice: { icon: 'text-accent', bg: 'bg-accent/10', hoverBg: 'group-hover:bg-accent/20', hoverBorder: 'hover:border-accent/20', glow: 'rgba(255,143,0,0.08)', linkColor: 'text-accent hover:text-accent/80' },
	unipack: { icon: 'text-secondary', bg: 'bg-secondary/10', hoverBg: 'group-hover:bg-secondary/20', hoverBorder: 'hover:border-secondary/20', glow: 'rgba(0,184,212,0.08)', linkColor: 'text-secondary hover:text-secondary/80' },
	integration: { icon: 'text-[#a855f7]', bg: 'bg-[#a855f7]/10', hoverBg: 'group-hover:bg-[#a855f7]/20', hoverBorder: 'hover:border-[#a855f7]/20', glow: 'rgba(168,85,247,0.08)', linkColor: 'text-[#a855f7] hover:text-[#a855f7]/80' },
	theme: { icon: 'text-accent', bg: 'bg-accent/10', hoverBg: 'group-hover:bg-accent/20', hoverBorder: 'hover:border-accent/20', glow: 'rgba(255,143,0,0.08)', linkColor: 'text-accent hover:text-accent/80' },
};

const containerVariants: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.15 } },
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 24 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const padColors = [
	'bg-accent', 'bg-secondary', 'bg-accent', 'bg-transparent',
	'bg-transparent', 'bg-accent', 'bg-transparent', 'bg-secondary',
	'bg-secondary', 'bg-transparent', 'bg-accent', 'bg-transparent',
	'bg-transparent', 'bg-secondary', 'bg-transparent', 'bg-accent',
];

function PracticeMiniDemo() {
	return (
		<div className="relative w-fit mx-auto mb-4" aria-hidden>
			<div className="absolute -inset-3 rounded-xl bg-accent/5 blur-lg" aria-hidden />
			<div className="relative grid grid-cols-4 gap-1.5">
				{padColors.map((color, i) => (
					<div
						key={i}
						className={`w-7 h-7 rounded ${color === 'bg-transparent' ? 'bg-muted/20 border border-white/[0.04]' : `${color} shadow-sm`} transition-colors`}
						style={{
							opacity: color === 'bg-transparent' ? 0.4 : 0.85,
							animation: color !== 'bg-transparent' ? `pad-pulse ${2 + (i % 3) * 0.5}s ease-in-out ${i * 0.2}s infinite` : undefined,
						}}
					/>
				))}
			</div>
		</div>
	);
}

function UniPackMiniDemo() {
	return (
		<div className="font-mono text-[10px] leading-relaxed text-muted-foreground mb-4 bg-background/60 border border-white/[0.06] rounded-lg p-3 mx-auto w-fit" aria-hidden>
			<div className="text-accent font-semibold">📦 my-song.zip</div>
			<div className="pl-3"><span className="text-white/30">├──</span> <span className="text-secondary">info</span></div>
			<div className="pl-3"><span className="text-white/30">├──</span> <span className="text-foreground/70">sounds/</span></div>
			<div className="pl-3"><span className="text-white/30">├──</span> <span className="text-secondary">keySound</span></div>
			<div className="pl-3"><span className="text-white/30">├──</span> <span className="text-secondary">keyLed</span></div>
			<div className="pl-3"><span className="text-white/30">└──</span> <span className="text-secondary">autoPlay</span></div>
		</div>
	);
}

function IntegrationMiniDemo() {
	return (
		<div className="flex items-center justify-center gap-3 mb-4" aria-hidden>
			<div className="w-14 h-9 rounded-lg border border-accent/30 bg-accent/5 flex items-center justify-center text-[9px] text-accent font-mono font-semibold shadow-sm shadow-accent/10">
				MIDI
			</div>
			<div className="relative flex items-center">
				<div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
				<div className="relative w-16 h-px overflow-hidden">
					<div className="absolute inset-0 bg-gradient-to-r from-accent/40 to-secondary/40" />
					<div className="absolute inset-0 animate-shimmer" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)', backgroundSize: '200% 100%' }} />
				</div>
				<div className="w-2 h-2 rounded-full bg-secondary animate-pulse" style={{ animationDelay: '0.5s' }} />
			</div>
			<div className="w-14 h-9 rounded-lg border border-secondary/30 bg-secondary/5 flex items-center justify-center text-[9px] text-secondary font-mono font-semibold shadow-sm shadow-secondary/10">
				PAD
			</div>
		</div>
	);
}

function ThemeMiniDemo() {
	const themes = [
		{ pad: 'bg-accent', bg: 'bg-accent/10', border: 'border-accent/30' },
		{ pad: 'bg-secondary', bg: 'bg-secondary/10', border: 'border-secondary/30' },
		{ pad: 'bg-[#a855f7]', bg: 'bg-[#a855f7]/10', border: 'border-[#a855f7]/30' },
	];
	return (
		<div className="flex items-center justify-center gap-2 mb-4" aria-hidden>
			{themes.map((theme, i) => (
				<div
					key={i}
					className={`w-16 h-12 rounded-lg ${theme.bg} border ${theme.border} p-1.5 flex flex-col gap-1`}
					style={{ animation: `pad-pulse ${3 + i * 0.5}s ease-in-out ${i * 0.6}s infinite` }}
				>
					<div className="flex gap-0.5 flex-1">
						{[0, 1, 2, 3].map((j) => (
							<div key={j} className={`flex-1 rounded-sm ${j % 2 === i % 2 ? theme.pad : 'bg-white/10'}`} style={{ opacity: j % 2 === i % 2 ? 0.8 : 0.3 }} />
						))}
					</div>
					<div className={`h-1 rounded-full ${theme.pad} opacity-40`} />
				</div>
			))}
		</div>
	);
}

const featureDemos: Record<FeatureKey, React.FC> = {
	practice: PracticeMiniDemo,
	unipack: UniPackMiniDemo,
	integration: IntegrationMiniDemo,
	theme: ThemeMiniDemo,
};

export const FeaturesSection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-100px' });
	const t = useTranslations('features');

	return (
		<section className="py-24 relative overflow-hidden" aria-label={t('title')} ref={ref}>
			<motion.div
				className="absolute top-[30%] left-[20%] w-[400px] h-[300px] rounded-full opacity-[0.04] blur-[100px]"
				aria-hidden
				style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
				animate={{ scale: [1, 1.1, 1], x: [0, 12, 0] }}
				transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
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
					className="text-muted-foreground text-center mb-12 max-w-xl mx-auto"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.1 }}
				>
					{t('subtitle')}
				</motion.p>

				<motion.div
					className="grid grid-cols-1 md:grid-cols-2 gap-6"
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
				>
					{featureKeys.map((key) => {
						const Icon = featureIcons[key];
						const Demo = featureDemos[key];
						const docLink = featureLinks[key];
						const colors = featureColors[key];
						return (
							<motion.div
								key={key}
								variants={itemVariants}
								className={`relative p-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md ${colors.hoverBorder} hover:bg-white/[0.06] hover:-translate-y-1 transition-all duration-300 group overflow-hidden`}
							>
								<div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" style={{ background: `radial-gradient(circle at 50% 0%, ${colors.glow} 0%, transparent 60%)` }} />
								<div className="group-hover:scale-105 transition-transform duration-300">
									<Demo />
								</div>
								<div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center mb-4 ${colors.hoverBg} group-hover:scale-110 transition-all`}>
									<Icon className={`w-5 h-5 ${colors.icon}`} />
								</div>
								<h3 className="text-lg font-semibold text-foreground mb-2">{t(`${key}.title`)}</h3>
								<p className="text-sm text-muted-foreground leading-relaxed mb-3">{t(`${key}.description`)}</p>
								<p className="text-[10px] font-medium tracking-wide text-muted-foreground/50 uppercase">{t(`${key}.tags`)}</p>
								{docLink && (
									<Link
										href={docLink as '/play' | '/docs/unipack' | '/docs/theme'}
										className={`inline-flex items-center gap-1 mt-3 text-xs font-medium ${colors.linkColor} transition-colors group/link`}
									>
										{docLink === '/play' ? t('tryIt') : t('learnMore')}
										<ArrowRight className="w-3 h-3 group-hover/link:translate-x-0.5 transition-transform" />
									</Link>
								)}
							</motion.div>
						);
					})}
				</motion.div>
			</div>
		</section>
	);
};
