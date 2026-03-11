'use client';

import { useRef } from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { MessageCircle, Users, GitBranch, ArrowUpRight, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EXTERNAL_LINKS } from '@/lib/constants';

const links = [
	{
		key: 'discord' as const,
		icon: MessageCircle,
		url: EXTERNAL_LINKS.discord,
		color: 'text-[#5865F2]',
		bg: 'bg-[#5865F2]/10',
		hoverBorder: 'hover:border-[#5865F2]/30',
		badge: '1.5K+',
		glow: 'rgba(88,101,242,0.08)',
	},
	{
		key: 'facebook' as const,
		icon: Users,
		url: EXTERNAL_LINKS.facebook,
		color: 'text-[#1877F2]',
		bg: 'bg-[#1877F2]/10',
		hoverBorder: 'hover:border-[#1877F2]/30',
		badge: '10K+',
		glow: 'rgba(24,119,242,0.08)',
	},
	{
		key: 'youtube' as const,
		icon: Play,
		url: EXTERNAL_LINKS.youtube,
		color: 'text-[#FF0000]',
		bg: 'bg-[#FF0000]/10',
		hoverBorder: 'hover:border-[#FF0000]/30',
		badge: '1K+',
		glow: 'rgba(255,0,0,0.08)',
	},
	{
		key: 'github' as const,
		icon: GitBranch,
		url: EXTERNAL_LINKS.github,
		color: 'text-foreground',
		bg: 'bg-foreground/10',
		hoverBorder: 'hover:border-foreground/20',
		badge: 'OSS',
		glow: 'rgba(255,255,255,0.05)',
	},
];

const containerVariants: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.12 } },
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 20 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

export const CommunitySection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-80px' });
	const t = useTranslations('community');

	return (
		<section className="py-24 relative overflow-hidden" aria-label={t('title')} ref={ref}>
			<motion.div
				className="absolute top-1/2 right-1/4 -translate-y-1/2 w-[400px] h-[300px] rounded-full opacity-[0.04] blur-[100px]"
				aria-hidden
				style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
				animate={{ scale: [1, 1.08, 1], y: [0, -10, 0] }}
				transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
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
					className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6"
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
				>
					{links.map((link) => {
						const Icon = link.icon;
						return (
							<motion.a
								key={link.key}
								variants={itemVariants}
								href={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className={`relative flex items-center gap-4 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md ${link.hoverBorder} hover:bg-white/[0.06] hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 group overflow-hidden`}
							>
								<div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" style={{ background: `radial-gradient(circle at 0% 50%, ${link.glow} 0%, transparent 60%)` }} />
								<div className={`w-12 h-12 rounded-xl ${link.bg} flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
									<Icon className={`w-6 h-6 ${link.color}`} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
									<span className="font-semibold text-foreground">{t(link.key)}</span>
									{link.badge && (
										<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${link.bg} ${link.color}`}>
											{link.badge}
										</span>
									)}
								</div>
									<div className="text-sm text-muted-foreground">{t(`${link.key}Desc`)}</div>
								</div>
								<ArrowUpRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
							</motion.a>
						);
					})}
				</motion.div>
			</div>
		</section>
	);
};
