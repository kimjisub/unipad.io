import { ArrowRight, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionTitle } from '@/components/introduce/SectionHeader';
import { EXTERNAL_LINKS } from '@/lib/constants';

const faqKeys = ['0', '1', '2', '3', '4', '5', '6'];

export const FaqSection = () => {
	const t = useTranslations('faq');

	return (
		<SectionContainer id="faq">
			<div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-16">
				<div className="min-w-0">
					<SectionTitle sectionId="faq" index="05" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
					<p className="mt-6 text-sm text-muted-foreground">{t('moreQuestions')}</p>
					<a
						href={EXTERNAL_LINKS.discord}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#9ba6ff] transition-colors hover:text-foreground"
					>
						{t('askOnDiscord')}
						<ArrowRight className="h-4 w-4" aria-hidden />
					</a>
				</div>

				<div className="min-w-0 border-t border-muted">
					{faqKeys.map((key, i) => (
						<details key={key} open={i === 0} className="group border-b border-muted">
							<summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 text-[1.0625rem] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
								<span className="min-w-0 [overflow-wrap:anywhere]">{t(`items.${key}.q`)}</span>
								<Plus className="h-5 w-5 shrink-0 text-muted-foreground group-open:hidden" aria-hidden />
								<Minus className="hidden h-5 w-5 shrink-0 text-muted-foreground group-open:block" aria-hidden />
							</summary>
							<p className="-mt-1 pb-5 pr-8 text-[0.9375rem] text-muted-foreground">{t(`items.${key}.a`)}</p>
						</details>
					))}
				</div>
			</div>
		</SectionContainer>
	);
};
