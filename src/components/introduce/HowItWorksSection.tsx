import { ArrowRight, FolderOpen, Music, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { LARGE_BUTTON_CLASS } from '@/components/introduce/StoreButtons';
import { Link } from '@/i18n/navigation';
import { GET_STARTED_PATH } from '@/lib/constants';

const steps = [
	{ key: 'step1', icon: FolderOpen },
	{ key: 'step2', icon: Music },
	{ key: 'step3', icon: Share2 },
] as const;

export const HowItWorksSection = () => {
	const t = useTranslations('howItWorks');

	return (
		<SectionContainer id="how-it-works" tinted>
			<SectionHeader sectionId="how-it-works" index="03" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

			<ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
				{steps.map(({ key, icon: Icon }, i) => (
					<li key={key} className="min-w-0 rounded-[1.25rem] border border-border bg-background p-6">
						<div className="flex items-center justify-between">
							<span className="text-[0.9375rem] font-bold tabular-nums text-accent">{String(i + 1).padStart(2, '0')}</span>
							<Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
						</div>
						<h3 className="mt-8 text-xl font-semibold tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">
							{t(`${key}.title`)}
						</h3>
						<p className="mt-2 text-[0.9375rem] text-muted-foreground">{t(`${key}.description`)}</p>
					</li>
				))}
			</ol>

			<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
				<Link href="/play" className={`${LARGE_BUTTON_CLASS} bg-foreground px-6 text-background hover:bg-foreground/90`}>
					{t('startNow')}
					<ArrowRight className="h-5 w-5" aria-hidden />
				</Link>
				<Link
					href={GET_STARTED_PATH}
					className={`${LARGE_BUTTON_CLASS} border border-muted px-6 text-foreground hover:bg-muted/40`}
				>
					{t('readGuide')}
				</Link>
			</div>
		</SectionContainer>
	);
};
