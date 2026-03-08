'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, X, Globe } from 'lucide-react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';

const TopBar: React.FC = () => {
	const t = useTranslations('common');
	const locale = useLocale();
	const pathname = usePathname();
	const router = useRouter();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [navBarHidden, setNavBarHidden] = useState(false);
	const [scrollProgress, setScrollProgress] = useState(0);
	const lastScrollY = useRef(0);

	const links = [
		{ path: '/docs' as const, label: t('docs') },
		{ path: '/notices' as const, label: t('notices') },
	];

	const toggleLocale = () => {
		const nextLocale = locale === 'en' ? 'ko' : 'en';
		router.replace(pathname, { locale: nextLocale });
	};

	useEffect(() => {
		if (!isMenuOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setIsMenuOpen(false);
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isMenuOpen]);

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

						<a
							href="https://play.google.com/store/apps/details?id=com.kimjisub.launchpad"
							target="_blank"
							rel="noopener noreferrer"
							className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
						>
							{t('download')}
						</a>

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
			{isMenuOpen && (
				<div className="fixed inset-x-0 top-14 z-40 md:hidden border-b border-border bg-background/95 backdrop-blur-lg">
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
						<a
							href="https://play.google.com/store/apps/details?id=com.kimjisub.launchpad"
							target="_blank"
							rel="noopener noreferrer"
							className="px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium text-center"
						>
							{t('download')}
						</a>
					</div>
				</div>
			)}
		</>
	);
};

export default TopBar;
