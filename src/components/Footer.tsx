'use client';

import { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

const communityLinks = [
	{ name: 'Discord', url: 'https://discord.gg/GGKwpgP' },
	{ name: 'Facebook', url: 'https://www.facebook.com/playunipad' },
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
	];

	return (
		<footer
			ref={ref}
			className="relative mt-16 border-t border-border overflow-hidden"
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
						<p className="text-xs text-muted-foreground">
							{t('common.copyright', { year: currentYear })}
						</p>
						<a
							href="https://play.google.com/store/apps/details?id=com.kimjisub.launchpad"
							target="_blank"
							rel="noopener noreferrer"
							className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
						>
							{t('common.downloadOnGooglePlay')}
						</a>
					</motion.div>
				</motion.div>
			</div>
		</footer>
	);
}
