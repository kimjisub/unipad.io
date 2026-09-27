'use client';

import { motion, type Variants } from 'framer-motion';
import { Play, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { AppleLogo } from '@/components/icons/AppleLogo';
import { LaunchpadDemo } from '@/components/introduce/LaunchpadDemo';
import { Link } from '@/i18n/navigation';
import { GOOGLE_PLAY_URL } from '@/lib/constants';

const container: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const item: Variants = {
	hidden: { opacity: 0, y: 18 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export const HeroSection = () => {
	const t = useTranslations('hero');
	const tStats = useTranslations('stats');

	return (
		<section id="hero" className="relative overflow-hidden">
			<div
				className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]"
				aria-hidden
			/>
			<div className="relative max-w-6xl mx-auto px-5 md:px-8 pt-14 pb-20 md:pt-24 md:pb-28 grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-16 items-center">
				<motion.div variants={container} initial="hidden" animate="visible" className="flex flex-col items-start">
					<motion.p variants={item} className="inline-flex items-center gap-2 font-mono text-xs tracking-wider text-muted-foreground">
						<span className="h-1.5 w-1.5 rounded-full bg-primary" />
						{t('badge')}
					</motion.p>

					<motion.h1
						variants={item}
						className="mt-6 text-[42px] leading-[1.08] sm:text-6xl md:text-[68px] md:leading-[1.04] font-bold tracking-[-0.04em] text-foreground"
					>
						{t('headline1')}
						<br />
						<span className="text-primary">{t('headline2')}</span>
						<span className="sr-only"> — {t('tagline')}</span>
					</motion.h1>

					<motion.p variants={item} className="mt-6 max-w-[520px] text-base md:text-lg leading-relaxed text-muted-foreground">
						{t('description')}
					</motion.p>

					<motion.div variants={item} className="mt-9 flex w-full flex-col sm:w-auto sm:flex-row gap-3">
						<Link
							href="/play"
							className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-semibold text-[#1b1103] transition-colors hover:bg-[#ffa426]"
						>
							<Play className="h-4 w-4 fill-current" />
							{t('playOnWeb')}
						</Link>
						<a
							href={GOOGLE_PLAY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/[0.12] px-6 text-[15px] font-medium text-foreground transition-colors hover:border-white/25 hover:bg-white/[0.04]"
						>
							<AndroidLogo className="h-4 w-4" />
							{t('downloadCta')}
						</a>
					</motion.div>

					<motion.ul variants={item} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
						<li>
							<span className="font-semibold text-foreground tabular-nums">{tStats('downloadsValue')}</span> {tStats('downloads')}
						</li>
						<li className="inline-flex items-center gap-1.5">
							<Star className="h-3.5 w-3.5 fill-primary text-primary" />
							<span className="font-semibold text-foreground tabular-nums">4.0</span> Google Play
						</li>
						<li className="inline-flex items-center gap-1.5">
							<AppleLogo className="h-3.5 w-3.5" />
							iOS {t('platforms.comingSoon')}
						</li>
					</motion.ul>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
					className="w-full max-w-[520px] mx-auto lg:mr-0"
				>
					<LaunchpadDemo hint={t('tryPads')} />
				</motion.div>
			</div>
		</section>
	);
};
