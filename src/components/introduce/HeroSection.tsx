'use client';

import { motion, useMotionValue, useScroll, useSpring, useTransform, type Variants } from 'framer-motion';
import { Download, Globe, Play, Star } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { GradientText } from '@/components/GradientText';
import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { AppleLogo } from '@/components/icons/AppleLogo';
import { TypewriterEffect } from '@/components/TypewriterEffect';
import { Link } from '@/i18n/navigation';
import { GOOGLE_PLAY_URL } from '@/lib/constants';

const heroContainerVariants: Variants = {
	hidden: {},
	visible: {
		transition: {
			staggerChildren: 0.15,
			delayChildren: 0.1,
		},
	},
};

const heroItemVariants: Variants = {
	hidden: {
		opacity: 0,
		y: 30,
		filter: 'blur(10px)',
		scale: 0.95,
	},
	visible: {
		opacity: 1,
		y: 0,
		filter: 'blur(0px)',
		scale: 1,
		transition: {
			duration: 0.7,
			ease: [0.25, 0.4, 0.25, 1],
		},
	},
};

function PadGrid() {
	return (
		<div className="absolute inset-0 items-center justify-center pointer-events-none hidden md:flex" aria-hidden>
			<div className="grid grid-cols-8 gap-2.5 rotate-12 scale-[1.8]">
				{Array.from({ length: 64 }).map((_, i) => {
					const row = Math.floor(i / 8);
					const col = i % 8;
					const dist = Math.sqrt((row - 3.5) ** 2 + (col - 3.5) ** 2);

					let bg: string;
					let glow: string;
					if (dist < 1.8) {
						bg = 'rgba(255, 143, 0, 0.08)';
						glow = 'rgba(255, 143, 0, 0.3)';
					} else if (dist < 3.2) {
						bg = 'rgba(0, 184, 212, 0.05)';
						glow = 'rgba(0, 184, 212, 0.2)';
					} else {
						bg = 'rgba(168, 85, 247, 0.03)';
						glow = 'rgba(168, 85, 247, 0.1)';
					}

					return (
						<div
							key={i}
							className="w-8 h-8 rounded-md"
							style={{
								backgroundColor: bg,
								animation: `pad-pulse ${3 + dist * 0.4}s ease-in-out ${dist * 0.25}s infinite`,
								['--pad-glow' as string]: glow,
								willChange: 'opacity',
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}

export const HeroSection = () => {
	const t = useTranslations('hero');
	const { scrollY } = useScroll();
	const scrollIndicatorOpacity = useTransform(scrollY, [0, 200], [1, 0]);

	const mouseX = useMotionValue(0.5);
	const mouseY = useMotionValue(0.5);
	const smoothX = useSpring(mouseX, { stiffness: 50, damping: 20 });
	const smoothY = useSpring(mouseY, { stiffness: 50, damping: 20 });
	const glowLeft = useTransform(smoothX, (v) => `${v * 100}%`);
	const glowTop = useTransform(smoothY, (v) => `${v * 100}%`);

	const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		mouseX.set((e.clientX - rect.left) / rect.width);
		mouseY.set((e.clientY - rect.top) / rect.height);
	}, [mouseX, mouseY]);

	return (
		<section className="min-h-[90svh] md:min-h-[85vh] flex items-center relative overflow-hidden" onMouseMove={handleMouseMove}>
			{/* Radial glow backgrounds */}
			<div className="absolute inset-0" aria-hidden>
				{/* Mouse-follow glow (desktop only) */}
				<motion.div
					className="absolute w-[500px] h-[500px] rounded-full opacity-[0.07] blur-[120px] pointer-events-none hidden md:block"
					style={{
						background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
						left: glowLeft,
						top: glowTop,
						x: '-50%',
						y: '-50%',
					}}
				/>
				<motion.div
					className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full opacity-20 blur-[120px]"
					style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
					animate={{ scale: [1, 1.08, 1], x: [0, 15, 0] }}
					transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
				/>
				<motion.div
					className="absolute top-[30%] right-[20%] w-[500px] h-[500px] rounded-full opacity-[0.12] blur-[100px]"
					style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
					animate={{ scale: [1, 1.12, 1], y: [0, -20, 0] }}
					transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
				/>
				<div className="absolute inset-0 bg-gradient-to-b from-[var(--background)]/60 via-transparent to-[var(--background)]/80" />
			</div>

			{/* Animated pad grid */}
			<PadGrid />

			<div className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 py-24 text-center">
				<motion.div
					className="flex flex-col items-center gap-6"
					variants={heroContainerVariants}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true }}
				>
					{/* Badge */}
					<motion.div variants={heroItemVariants}>
						<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-accent/20 bg-accent/5 text-xs font-medium text-accent">
							<span className="relative flex h-2 w-2">
								<span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
								<span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
							</span>
							{t('badge')}
						</span>
					</motion.div>

					{/* Title */}
					<motion.div variants={heroItemVariants}>
						<h1 className="text-6xl md:text-8xl font-extrabold mb-2 tracking-tighter">
							<GradientText duration={5}>
								UniPad
							</GradientText>
							<span className="sr-only"> — {t('tagline')}</span>
						</h1>
					</motion.div>

					{/* Tagline */}
					<motion.div variants={heroItemVariants}>
						<div className="text-xl md:text-2xl font-medium text-foreground/80">
							<TypewriterEffect
								texts={[
									t('typewriter.0'),
									t('typewriter.1'),
									t('typewriter.2'),
									t('typewriter.3'),
								]}
								typingSpeed={75}
								deletingSpeed={40}
								pauseTime={2000}
							/>
						</div>
					</motion.div>

					{/* Description */}
					<motion.div variants={heroItemVariants}>
						<p className="text-base md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
							{t('description')}
						</p>
					</motion.div>

					{/* CTA */}
					<motion.div variants={heroItemVariants} className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mt-4 w-full max-w-md sm:max-w-none sm:w-auto">
						<Link
							href="/play"
							className="relative px-8 py-3.5 rounded-xl bg-accent text-accent-foreground font-semibold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] group inline-flex items-center justify-center gap-2"
						>
							<span className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-60 blur-sm -z-10 group-hover:opacity-80 transition-opacity" />
							<span className="absolute -inset-[2px] rounded-xl bg-gradient-to-r from-accent via-secondary to-accent opacity-25 blur-md -z-10 group-hover:opacity-40 transition-opacity" />
							<Play className="w-5 h-5 fill-current" />
							{t('playOnWeb')}
						</Link>
						<a
							href={GOOGLE_PLAY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="px-8 py-3.5 rounded-xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-md text-foreground font-medium text-lg text-center transition-all duration-300 hover:bg-white/[0.08] hover:border-white/[0.2] hover:shadow-[0_0_20px_-5px_rgba(255,255,255,0.08)] inline-flex items-center justify-center gap-2"
						>
							<AndroidLogo className="w-5 h-5" />
							<span className="sm:hidden">Google Play</span>
							<span className="hidden sm:inline">{t('downloadCta')}</span>
						</a>
					</motion.div>

					{/* Social proof */}
					<motion.div variants={heroItemVariants} className="flex items-center gap-4 text-xs text-muted-foreground/50">
						<span className="inline-flex items-center gap-1">
							<Download className="w-3 h-3" />
							9.2M+
						</span>
						<span className="w-px h-3 bg-white/10" aria-hidden />
						<span className="inline-flex items-center gap-1">
							<Star className="w-3 h-3" />
							4.0★
						</span>
						<span className="w-px h-3 bg-white/10" aria-hidden />
						<span className="text-accent/60 font-medium">100% Free</span>
					</motion.div>

					{/* Platforms */}
					<motion.div variants={heroItemVariants} className="flex flex-col items-center gap-3 mt-6 w-full max-w-lg">
						<span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/40">{t('platforms.title')}</span>
					</motion.div>
					<motion.div variants={heroItemVariants} className="grid grid-cols-3 gap-2 md:gap-4 w-full max-w-lg">
						<Link
							href="/play"
							className="flex flex-col items-center gap-1.5 md:gap-2 p-3 md:p-5 rounded-xl bg-white/[0.03] backdrop-blur-md border border-white/[0.08] hover:border-accent/40 hover:bg-white/[0.06] hover:shadow-[0_0_30px_-5px_rgba(255,143,0,0.15)] active:scale-[0.97] transition-all duration-300 group"
						>
							<Globe className="w-5 h-5 md:w-6 md:h-6 text-accent group-hover:scale-110 transition-transform" />
							<span className="text-xs md:text-sm font-medium">{t('platforms.web')}</span>
							<span className="hidden md:block text-xs text-muted-foreground text-center">{t('platforms.webDesc')}</span>
						</Link>
						<a
							href={GOOGLE_PLAY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="flex flex-col items-center gap-1.5 md:gap-2 p-3 md:p-5 rounded-xl bg-white/[0.03] backdrop-blur-md border border-white/[0.08] hover:border-accent/40 hover:bg-white/[0.06] hover:shadow-[0_0_30px_-5px_rgba(255,143,0,0.15)] active:scale-[0.97] transition-all duration-300 group"
						>
							<AndroidLogo className="w-5 h-5 md:w-6 md:h-6 text-accent group-hover:scale-110 transition-transform" />
							<span className="text-xs md:text-sm font-medium">{t('platforms.android')}</span>
							<span className="hidden md:block text-xs text-muted-foreground text-center">{t('platforms.androidDesc')}</span>
						</a>
						<div className="relative flex flex-col items-center gap-1.5 md:gap-2 p-3 md:p-5 rounded-xl bg-white/[0.02] border border-white/[0.05] opacity-50 cursor-default">
							<AppleLogo className="w-5 h-5 md:w-6 md:h-6 text-muted-foreground" />
							<span className="text-xs md:text-sm font-medium">{t('platforms.ios')}</span>
							<span className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground text-center">
								<span className="relative flex h-1.5 w-1.5">
									<span className="absolute inline-flex h-full w-full rounded-full bg-muted-foreground/50 animate-ping" />
									<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
								</span>
								{t('platforms.comingSoon')}
							</span>
							<span className="md:hidden text-[9px] text-muted-foreground/70">{t('platforms.comingSoon')}</span>
						</div>
					</motion.div>
				</motion.div>
			</div>

			{/* Scroll indicator */}
			<motion.div
				className="absolute bottom-8 left-1/2 -translate-x-1/2 flex-col items-center gap-2 hidden md:flex"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 2, duration: 1 }}
				style={{ opacity: scrollIndicatorOpacity }}
				aria-hidden
			>
				<span className="text-[10px] font-medium tracking-[0.2em] uppercase text-white/30">Scroll</span>
				<motion.div
					className="w-5 h-8 rounded-full border border-white/20 flex justify-center pt-1.5"
					animate={{ y: [0, 3, 0] }}
					transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
				>
					<div className="w-1 h-1.5 rounded-full bg-white/40" />
				</motion.div>
			</motion.div>
		</section>
	);
};
