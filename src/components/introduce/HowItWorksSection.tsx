'use client';

import { ArrowRight, FolderOpen, Music, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Reveal } from '@/components/motion/Reveal';
import { Link } from '@/i18n/navigation';

const steps = [
	{ key: 'step1', icon: FolderOpen },
	{ key: 'step2', icon: Music },
	{ key: 'step3', icon: Share2 },
] as const;

export const HowItWorksSection = () => {
	const t = useTranslations('howItWorks');

	return (
		<SectionContainer id="how-it-works" className="bg-card/25 border-y border-border/60">
			<SectionHeader
				index="03"
				eyebrow={t('eyebrow')}
				title={t('title')}
				subtitle={t('subtitle')}
				aside={
					<Link
						href="/play"
						className="inline-flex h-11 shrink-0 items-center gap-2 self-start md:self-auto rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
					>
						{t('startNow')}
						<ArrowRight className="h-4 w-4" />
					</Link>
				}
			/>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{steps.map(({ key, icon: Icon }, i) => (
					<Reveal key={key} delay={i * 0.08} className="h-full">
						<article className="h-full rounded-2xl border border-border bg-background/60 p-6 md:p-7">
							<div className="flex items-center justify-between">
								<span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, '0')}</span>
								<Icon className="h-5 w-5 text-muted-foreground" />
							</div>
							<h3 className="mt-10 text-xl font-semibold tracking-tight text-foreground">{t(`${key}.title`)}</h3>
							<p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{t(`${key}.description`)}</p>
						</article>
					</Reveal>
				))}
			</div>
		</SectionContainer>
	);
};
