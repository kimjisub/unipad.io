'use client';

import { ArrowRight, Headphones, Palette, Share2, Usb, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Reveal } from '@/components/motion/Reveal';
import { Link } from '@/i18n/navigation';

type FeatureKey = 'practice' | 'unipack' | 'integration' | 'theme';

interface Feature {
	key: FeatureKey;
	icon: LucideIcon;
	href?: '/play' | '/docs/unipack' | '/docs/theme';
	span: string;
	Demo: React.FC;
}

const PURPLE = '#a855f7';

const practicePattern = [
	'o', 'c', 'o', '-', '-', 'c', '-', 'o',
	'-', 'o', '-', 'c', 'o', '-', 'c', '-',
	'c', '-', '*', '-', '-', 'o', '-', 'c',
	'-', 'c', '-', 'o', 'c', '-', 'o', '-',
];

function PracticeDemo() {
	return (
		<div className="grid grid-cols-8 gap-1.5 w-full max-w-[360px]" aria-hidden>
			{practicePattern.map((cell, i) => {
				if (cell === '*') {
					return (
						<div key={i} className="relative aspect-square rounded-md bg-primary shadow-[0_0_18px_rgba(255,143,0,0.55)]">
							<span className="absolute -inset-1 rounded-lg border border-primary/60 animate-ping" />
						</div>
					);
				}
				const color = cell === 'o' ? 'bg-primary/30' : cell === 'c' ? 'bg-secondary/25' : 'bg-white/[0.05]';
				return <div key={i} className={`aspect-square rounded-md ${color}`} />;
			})}
		</div>
	);
}

function UniPackDemo() {
	const files: [string, string][] = [
		['├─', 'info'],
		['├─', 'sounds/'],
		['├─', 'keySound'],
		['├─', 'keyLed/'],
		['└─', 'autoPlay'],
	];
	return (
		<div className="font-mono text-xs leading-6 text-muted-foreground" aria-hidden>
			<div className="text-primary font-semibold">my-song.zip</div>
			{files.map(([branch, name]) => (
				<div key={name}>
					<span className="text-white/20">{branch}</span> <span className={name.endsWith('/') ? 'text-foreground/70' : 'text-secondary'}>{name}</span>
				</div>
			))}
		</div>
	);
}

function IntegrationDemo() {
	return (
		<div className="flex items-center gap-3" aria-hidden>
			<div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/80">Launchpad</div>
			<div className="relative h-px w-14 bg-gradient-to-r from-primary/70 to-secondary/70">
				<span className="absolute -top-[3px] left-0 h-[7px] w-[7px] rounded-full bg-primary" />
				<span className="absolute -top-[3px] right-0 h-[7px] w-[7px] rounded-full bg-secondary" />
			</div>
			<div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/80">UniPad</div>
		</div>
	);
}

function ThemeDemo() {
	const themes = ['#ff8f00', '#00b8d4', PURPLE, '#ff3d7f'];
	return (
		<div className="flex items-end gap-3" aria-hidden>
			{themes.map((color, i) => (
				<div
					key={color}
					className="rounded-xl border p-2"
					style={{ borderColor: `${color}40`, backgroundColor: `${color}12`, transform: `translateY(${i % 2 ? 0 : -8}px)` }}
				>
					<div className="grid grid-cols-3 gap-1">
						{Array.from({ length: 9 }).map((_, j) => (
							<div key={j} className="h-4 w-4 rounded-[3px]" style={{ backgroundColor: (j + i) % 3 === 0 ? color : 'rgba(255,255,255,0.08)' }} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

const features: Feature[] = [
	{ key: 'practice', icon: Headphones, href: '/play', span: 'md:col-span-4', Demo: PracticeDemo },
	{ key: 'unipack', icon: Share2, href: '/docs/unipack', span: 'md:col-span-2', Demo: UniPackDemo },
	{ key: 'integration', icon: Usb, span: 'md:col-span-2', Demo: IntegrationDemo },
	{ key: 'theme', icon: Palette, href: '/docs/theme', span: 'md:col-span-4', Demo: ThemeDemo },
];

export const FeaturesSection = () => {
	const t = useTranslations('features');

	return (
		<SectionContainer id="features">
			<SectionHeader index="02" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

			<div className="grid grid-cols-1 md:grid-cols-6 gap-4">
				{features.map(({ key, icon: Icon, href, span, Demo }, i) => (
					<Reveal key={key} delay={i * 0.06} className={span}>
						<article className="group flex h-full flex-col rounded-2xl border border-border bg-card/50 p-6 md:p-7 transition-colors hover:border-white/15">
							<div className="mb-7 flex h-44 items-center justify-center rounded-xl border border-white/[0.04] bg-background/70 px-4">
								<Demo />
							</div>
							<div className="flex items-center gap-2.5 mb-3">
								<Icon className="h-[18px] w-[18px] text-primary" />
								<h3 className="text-lg font-semibold tracking-tight text-foreground">{t(`${key}.title`)}</h3>
							</div>
							<p className="text-[15px] leading-relaxed text-muted-foreground">{t(`${key}.description`)}</p>
							<div className="mt-auto flex items-center justify-between gap-4 pt-6">
								<span className="font-mono text-[11px] tracking-wide text-muted-foreground/70">{t(`${key}.tags`)}</span>
								{href && (
									<Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground/90 transition-colors hover:text-primary">
										{href === '/play' ? t('tryIt') : t('learnMore')}
										<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
									</Link>
								)}
							</div>
						</article>
					</Reveal>
				))}
			</div>
		</SectionContainer>
	);
};
