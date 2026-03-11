'use client';

import { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import Image from 'next/image';
import { ExternalLink, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { AppleLogo } from '@/components/icons/AppleLogo';
import { Link } from '@/i18n/navigation';
import { EXTERNAL_LINKS, GOOGLE_PLAY_URL } from '@/lib/constants';

const communityLinks = [
	{ name: 'Discord', url: EXTERNAL_LINKS.discord },
	{ name: 'Facebook', url: EXTERNAL_LINKS.facebook },
	{ name: 'YouTube', url: EXTERNAL_LINKS.youtube },
	{ name: 'GitHub', url: EXTERNAL_LINKS.github },
];

const containerVariants: Variants = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: { staggerChildren: 0.08, delayChildren: 0.05 },
	},
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 16 },
	visible: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.45, ease: 'easeOut' },
	},
};

export default function Footer() {
	const ref = useRef<HTMLElement>(null);
	const isInView = useInView(ref, { once: true, margin: '-60px' });
	const currentYear = new Date().getFullYear();
	const t = useTranslations();

	const navLinks = [
		{ href: '/docs' as const, label: t('common.docs') },
		{ href: '/notices' as const, label: t('common.notices') },
		{ href: '/docs/terms' as const, label: t('docs.terms.title') },
	];

	return (
		<footer
			ref={ref}
			className="relative border-t border-white/[0.06] overflow-hidden bg-black/20"
		>
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-px"
				aria-hidden
			>
				<div className="mx-auto h-px w-1/2 bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
			</div>

			<div className="max-w-5xl mx-auto px-6 py-14">
				<motion.div
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
					className="flex flex-col gap-10"
				>
					<motion.div
						variants={itemVariants}
						className="flex flex-col sm:flex-row justify-between gap-8"
					>
						<div className="flex flex-col gap-3">
							<Link
								href="/"
								className="flex items-center gap-2 text-lg font-bold text-foreground hover:text-accent transition-colors"
							>
								<Image src="/logo.svg" alt="" width={20} height={20} />
								UniPad
							</Link>
							<p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
								{t('footer.description')}
							</p>
						</div>

						<div className="flex flex-col sm:flex-row gap-8 sm:gap-16">
							<div className="flex flex-col gap-2">
								<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">
									{t('common.pages')}
								</p>
								{navLinks.map((link) => (
									<Link
										key={link.href}
										href={link.href}
										className="text-sm text-muted-foreground hover:text-foreground transition-colors"
									>
										{link.label}
									</Link>
								))}
							</div>

							<div className="flex flex-col gap-2">
								<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">
									{t('common.community')}
								</p>
								{communityLinks.map((link) => (
									<a
										key={link.name}
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
									>
										{link.name}
										<ExternalLink className="w-3 h-3" />
									</a>
								))}
							</div>
						</div>
					</motion.div>

					<motion.div variants={itemVariants} className="h-px bg-border" />

					<motion.div
						variants={itemVariants}
						className="flex flex-col sm:flex-row justify-between items-center gap-4"
					>
						<div className="flex flex-col sm:flex-row items-center gap-2">
							<p className="text-xs text-muted-foreground">
								{t('common.copyright', { year: currentYear })}
							</p>
							<span className="hidden sm:inline w-px h-3 bg-white/10" aria-hidden />
							<a
								href={EXTERNAL_LINKS.github}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
							>
								Open Source on GitHub
								<ExternalLink className="w-2.5 h-2.5" />
							</a>
						</div>
						<div className="flex items-center gap-3">
							<Link
								href="/play"
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
							>
								<Globe className="w-3.5 h-3.5" />
								Web
							</Link>
							<a
								href={GOOGLE_PLAY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
							>
								<AndroidLogo className="w-3.5 h-3.5" />
								Android
							</a>
							<span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.04] text-sm text-muted-foreground/40 cursor-default" title={t('common.comingSoon')}>
								<AppleLogo className="w-3.5 h-3.5" />
								iOS
							</span>
						</div>
					</motion.div>
				</motion.div>
			</div>
		</footer>
	);
}
