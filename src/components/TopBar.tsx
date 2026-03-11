'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe, ChevronDown } from 'lucide-react';

import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { AppleLogo } from '@/components/icons/AppleLogo';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { GOOGLE_PLAY_URL } from '@/lib/constants';

const TopBar: React.FC = () => {
	const t = useTranslations('common');
	const locale = useLocale();
	const pathname = usePathname();
	const router = useRouter();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isDownloadOpen, setIsDownloadOpen] = useState(false);
	const [navBarHidden, setNavBarHidden] = useState(false);
	const [scrollProgress, setScrollProgress] = useState(0);
	const lastScrollY = useRef(0);
	const downloadRef = useRef<HTMLDivElement>(null);

	const links = [
		{ path: '/docs' as const, label: t('docs') },
		{ path: '/notices' as const, label: t('notices') },
	];

	const toggleLocale = () => {
		const nextLocale = locale === 'en' ? 'ko' : 'en';
		router.replace(pathname, { locale: nextLocale });
	};

	useEffect(() => {
		if (!isMenuOpen && !isDownloadOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setIsMenuOpen(false);
				setIsDownloadOpen(false);
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isMenuOpen, isDownloadOpen]);

	useEffect(() => {
		if (!isDownloadOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
				setIsDownloadOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isDownloadOpen]);

	useEffect(() => {
		const handleScroll = () => {
			const currentScrollY = window.scrollY;
			if (currentScrollY <= 0 || currentScrollY <= lastScrollY.current) {
				setNavBarHidden(false);
			} else {
				setNavBarHidden(true);
			}
			lastScrollY.current = currentScrollY;
			setScrollProgress(Math.min(currentScrollY / 100, 1));
		};

		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	const blurValue = 4 + scrollProgress * 12;
	const bgOpacity = 0.8 + scrollProgress * 0.15;

	return (
		<>
			<nav
				id="navigation"
				aria-label={t('mainNav')}
				tabIndex={-1}
				className={`fixed top-0 w-full h-14 z-50 border-b border-border transition-transform duration-200 ${
					navBarHidden ? '-translate-y-full' : ''
				}`}
				style={{
					backdropFilter: `blur(${blurValue}px)`,
					WebkitBackdropFilter: `blur(${blurValue}px)`,
					backgroundColor: `color-mix(in srgb, var(--background) ${Math.round(bgOpacity * 100)}%, transparent)`,
				}}
			>
				<div className="h-14 max-w-5xl mx-auto px-6 flex items-center justify-between">
					<Link
						href="/"
						className="flex items-center gap-2 text-foreground hover:text-muted-foreground transition-colors"
					>
						<Image src="/logo.svg" alt="UniPad" width={24} height={24} />
						<span className="text-lg font-bold tracking-tight">UniPad</span>
					</Link>

					{/* Desktop */}
					<div className="hidden md:flex items-center gap-6">
						{links.map((link) => (
							<Link
								key={link.path}
								href={link.path}
								aria-current={pathname?.startsWith(link.path) ? 'page' : undefined}
								className={`text-sm transition-colors ${
									pathname?.startsWith(link.path)
										? 'text-foreground'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								{link.label}
							</Link>
						))}

						<div ref={downloadRef} className="relative">
							<button
								onClick={() => setIsDownloadOpen(!isDownloadOpen)}
								className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors flex items-center gap-1"
							>
								{t('play')}
								<ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDownloadOpen ? 'rotate-180' : ''}`} />
							</button>
							<AnimatePresence>
							{isDownloadOpen && (
								<motion.div
									initial={{ opacity: 0, y: -4, scale: 0.97 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -4, scale: 0.97 }}
									transition={{ duration: 0.15, ease: 'easeOut' }}
									className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/[0.08] bg-card/80 backdrop-blur-xl shadow-2xl shadow-black/30 py-1 z-50"
								>
									<Link
										href="/play"
										onClick={() => setIsDownloadOpen(false)}
										className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
									>
										<Globe className="w-4 h-4 text-accent" />
										<div>
											<div className="font-medium">Web</div>
											<div className="text-xs text-muted-foreground">{t('playOnWeb')}</div>
										</div>
									</Link>
									<a
										href={GOOGLE_PLAY_URL}
										target="_blank"
										rel="noopener noreferrer"
										onClick={() => setIsDownloadOpen(false)}
										className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
									>
										<AndroidLogo className="w-4 h-4 text-accent" />
										<div>
											<div className="font-medium">Android</div>
											<div className="text-xs text-muted-foreground">Google Play</div>
										</div>
									</a>
									<div className="flex items-center gap-3 px-4 py-2.5 text-sm opacity-50 cursor-default">
										<AppleLogo className="w-4 h-4" />
										<div>
											<div className="font-medium">iOS</div>
											<div className="text-xs">{t('comingSoon')}</div>
										</div>
									</div>
								</motion.div>
							)}
							</AnimatePresence>
						</div>

						<button
							onClick={toggleLocale}
							aria-label={locale === 'en' ? '한국어로 전환' : 'Switch to English'}
							className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							<Globe className="w-4 h-4" />
						</button>
					</div>

					{/* Mobile */}
					<div className="md:hidden flex items-center gap-2">
						<button
							onClick={toggleLocale}
							aria-label={locale === 'en' ? '한국어로 전환' : 'Switch to English'}
							className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							<Globe className="w-4 h-4" />
						</button>
						<button
							onClick={() => setIsMenuOpen(!isMenuOpen)}
							aria-expanded={isMenuOpen}
							aria-label={isMenuOpen ? t('closeMenu') : t('openMenu')}
							className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							{isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
						</button>
					</div>
				</div>
			</nav>

			{/* Mobile menu */}
			<AnimatePresence>
			{isMenuOpen && (
				<motion.div
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -8 }}
					transition={{ duration: 0.2, ease: 'easeOut' }}
					className="fixed inset-x-0 top-14 z-40 md:hidden border-b border-border bg-background/95 backdrop-blur-lg"
				>
					<div className="max-w-5xl mx-auto px-6 py-4 flex flex-col gap-3">
						{links.map((link) => (
							<Link
								key={link.path}
								href={link.path}
								onClick={() => setIsMenuOpen(false)}
								className={`text-sm py-2 ${
									pathname?.startsWith(link.path)
										? 'text-foreground font-medium'
										: 'text-muted-foreground'
								}`}
							>
								{link.label}
							</Link>
						))}
						<div className="flex flex-col gap-2 pt-2 border-t border-border">
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
								{t('play')}
							</p>
							<Link
								href="/play"
								onClick={() => setIsMenuOpen(false)}
								className="flex items-center gap-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								<Globe className="w-4 h-4 text-accent" />
								<span>Web — {t('playOnWeb')}</span>
							</Link>
							<a
								href={GOOGLE_PLAY_URL}
								target="_blank"
								rel="noopener noreferrer"
								onClick={() => setIsMenuOpen(false)}
								className="flex items-center gap-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								<AndroidLogo className="w-4 h-4 text-accent" />
								<span>Android — Google Play</span>
							</a>
							<div className="flex items-center gap-3 py-2 text-sm opacity-50">
								<AppleLogo className="w-4 h-4" />
								<span>iOS — {t('comingSoon')}</span>
							</div>
						</div>
					</div>
				</motion.div>
			)}
			</AnimatePresence>
		</>
	);
};

export default TopBar;
