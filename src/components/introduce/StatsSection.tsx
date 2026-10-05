import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
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
		<SectionContainer id="stats">
			<SectionHeader
				sectionId="stats"
				index="01"
				eyebrow={t('eyebrow')}
				title={t('title')}
				subtitle={t('subtitle')}
				aside={
					<span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full md:max-w-[50%] border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent">
						<Trophy className="h-4 w-4 shrink-0" aria-hidden />
						{t('achievement')}
					</span>
				}
			/>

			{/* 휴대폰에서 칸 여백은 큰 글씨에서도 기본 크기까지만 늘려 숫자 자리를 남긴다. */}
			<div className="grid grid-cols-2 overflow-hidden rounded-[1.25rem] border border-muted lg:grid-cols-4">
				{statKeys.map((key, i) => (
					<div
						key={key}
						className={`min-w-0 border-muted p-[min(1rem,16px)] min-[400px]:p-[min(1.25rem,20px)] lg:p-8 ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} ${i === 2 ? 'lg:border-l' : ''}`}
					>
						<p className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.03em] tabular-nums text-foreground [overflow-wrap:anywhere] min-[400px]:text-4xl lg:text-5xl">
							{t(`${key}Value`)}
						</p>
						<p className="mt-2.5 text-[0.9375rem] font-semibold text-foreground">{t(key)}</p>
						<p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{t(`${key}Desc`)}</p>
					</div>
				))}
			</div>

			<div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
				<span>{t('featuredOn')}</span>
				{featuredLinks.map((link) => (
					<a
						key={link.name}
						href={link.url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center underline decoration-muted underline-offset-[0.3em] transition-colors hover:text-foreground"
					>
						{link.name}
					</a>
				))}
			</div>
		</SectionContainer>
	);
};
