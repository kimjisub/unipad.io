import { ArrowRight, Headphones, Palette, Share2, Usb, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Link } from '@/i18n/navigation';

type FeatureKey = 'practice' | 'unipack' | 'integration' | 'theme';

interface Feature {
	key: FeatureKey;
	icon: LucideIcon;
	href?: '/play' | '/docs/unipack' | '/docs/theme';
	span: string;
	Demo: React.FC;
}

const SKIN_COLORS = ['#ff8f00', '#00b8d4', '#b57cf9', '#ff3d7f'];

// o: 주황, c: 청록, *: 지금 눌린 패드, -: 빈 패드
const practicePattern = [
	'o', 'c', 'o', '-', '-', 'c', '-', 'o',
	'-', 'o', '-', 'c', 'o', '-', 'c', '-',
	'c', '-', '*', '-', '-', 'o', '-', 'c',
	'-', 'c', '-', 'o', 'c', '-', 'o', '-',
];

const padClass: Record<string, string> = {
	o: 'bg-accent/45',
	c: 'bg-secondary/35',
	'-': 'bg-foreground/[0.06]',
	'*': 'bg-accent shadow-[0_0_16px_rgba(255,143,0,0.6)]',
};

function PracticeDemo() {
	return (
		<div className="grid w-full max-w-[14rem] grid-cols-8 gap-1.5" aria-hidden>
			{practicePattern.map((cell, i) => (
				<div key={i} className={`aspect-square rounded-[0.3rem] ${padClass[cell]}`} />
			))}
		</div>
	);
}

const unipackFiles: [string, string][] = [
	['├─', 'info'],
	['├─', 'sounds/'],
	['├─', 'keySound'],
	['├─', 'keyLed/'],
	['└─', 'autoPlay'],
];

function UniPackDemo() {
	return (
		<div className="font-mono text-[0.8125rem] leading-[1.7] text-muted-foreground" aria-hidden>
			<div className="font-semibold text-accent">my-song.zip</div>
			{unipackFiles.map(([branch, name]) => (
				<div key={name}>
					{branch} <span className={name.endsWith('/') ? 'text-foreground' : 'text-secondary'}>{name}</span>
				</div>
			))}
		</div>
	);
}

/** 그림 칸(container)이 15rem보다 좁으면 위아래로, 넉넉하면 가로로 잇는다. */
function IntegrationDemo() {
	const boxClass = 'rounded-lg border border-foreground/15 bg-foreground/[0.04] px-3 py-1.5 text-[0.8125rem] text-foreground';
	return (
		<div className="flex flex-col items-center gap-2 [@container(min-width:15rem)]:flex-row [@container(min-width:15rem)]:gap-3" aria-hidden>
			<span className={boxClass}>Launchpad</span>
			<span className="h-4 w-0.5 bg-gradient-to-b from-accent to-secondary [@container(min-width:15rem)]:h-0.5 [@container(min-width:15rem)]:w-10 [@container(min-width:15rem)]:bg-gradient-to-r" />
			<span className={boxClass}>UniPad</span>
		</div>
	);
}

function ThemeDemo() {
	return (
		<div className="flex items-end justify-center gap-2" aria-hidden>
			{SKIN_COLORS.map((color, i) => (
				<div
					key={color}
					className="grid grid-cols-3 gap-1 rounded-xl border p-2"
					style={{ borderColor: `${color}59`, backgroundColor: `${color}1f`, transform: i % 2 ? undefined : 'translateY(-8px)' }}
				>
					{Array.from({ length: 9 }, (_, j) => (
						<span
							key={j}
							className="aspect-square w-[clamp(0.5rem,2.2vw,0.875rem)] rounded-[0.2rem]"
							style={{ backgroundColor: (j + i) % 3 === 0 ? color : 'rgba(255,255,255,0.1)' }}
						/>
					))}
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
			<SectionHeader sectionId="features" index="02" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

			<div className="grid grid-cols-1 gap-4 md:grid-cols-6">
				{features.map(({ key, icon: Icon, href, span, Demo }) => (
					<article key={key} className={`flex min-w-0 flex-col rounded-[1.25rem] border border-border bg-card/60 p-6 ${span}`}>
						<div className="mb-6 flex h-40 items-center justify-center overflow-hidden rounded-[0.875rem] border border-foreground/[0.05] bg-background/70 px-4 [container-type:inline-size]">
							<Demo />
						</div>
						<h3 className="flex items-center gap-2.5 text-[1.1875rem] font-semibold tracking-[-0.015em] text-foreground">
							<Icon className="h-[1.125rem] w-[1.125rem] shrink-0 text-accent" aria-hidden />
							{t(`${key}.title`)}
						</h3>
						<p className="mt-2.5 text-[0.9375rem] text-muted-foreground">{t(`${key}.description`)}</p>
						<div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 pt-5">
							<span className="text-[0.8125rem] text-muted-foreground">{t(`${key}.tags`)}</span>
							{href && (
								<Link
									href={href}
									className="group inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-semibold text-foreground transition-colors hover:text-accent"
								>
									{href === '/play' ? t('tryIt') : t('learnMore')}
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
								</Link>
							)}
						</div>
					</article>
				))}
			</div>
		</SectionContainer>
	);
};
