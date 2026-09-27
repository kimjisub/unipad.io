'use client';

import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Reveal } from '@/components/motion/Reveal';
import { EXTERNAL_LINKS, GOOGLE_PLAY_URL } from '@/lib/constants';

const statKeys = ['downloads', 'reviews', 'since', 'openSource'] as const;

const featuredLinks = [
	{ name: 'Google Play', url: GOOGLE_PLAY_URL },
	{ name: 'YouTube', url: EXTERNAL_LINKS.youtube },
	{ name: '나무위키', url: EXTERNAL_LINKS.namuWiki },
];

export const StatsSection = () => {
	const t = useTranslations('stats');

	return (
		<SectionContainer id="stats" className="border-t border-border/60">
			<SectionHeader
				index="01"
				eyebrow={t('eyebrow')}
				title={t('title')}
				subtitle={t('subtitle')}
				aside={
					<span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] px-4 py-2 text-sm font-medium text-primary">
						<Trophy className="h-4 w-4" />
						{t('achievement')}
					</span>
				}
			/>

			<Reveal className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl border border-border overflow-hidden">
				{statKeys.map((key, i) => (
					<div
						key={key}
						className={`p-6 md:p-8 border-border ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} ${i === 2 ? 'lg:border-l' : ''}`}
					>
						<p className="text-4xl md:text-5xl font-bold tracking-[-0.03em] tabular-nums text-foreground">{t(`${key}Value`)}</p>
						<p className="mt-3 text-sm font-medium text-foreground/85">{t(key)}</p>
						<p className="mt-1 text-xs text-muted-foreground">{t(`${key}Desc`)}</p>
					</div>
				))}
			</Reveal>

			<Reveal delay={0.1} className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
				<span className="font-mono text-xs tracking-wider">{t('featuredOn')}</span>
				{featuredLinks.map((link) => (
					<a
						key={link.name}
						href={link.url}
						target="_blank"
						rel="noopener noreferrer"
						className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-muted-foreground"
					>
						{link.name}
					</a>
				))}
			</Reveal>
		</SectionContainer>
	);
};
