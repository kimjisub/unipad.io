import { Code, Download, Heart, Play, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeading } from '@/components/introduce/SectionHeader';
import { LARGE_BUTTON_CLASS, ON_ACCENT_FOCUS_CLASS, StoreButtons } from '@/components/introduce/StoreButtons';
import { Link } from '@/i18n/navigation';

const ART_COLUMNS = 8;
const ART_ROWS = 7;
const artLitPads = new Set([3, 4, 5, 10, 12, 13, 18, 19, 20, 21, 27, 28, 34, 35, 36, 37, 38, 43, 44, 45, 46, 52, 53]);

/** 시작 상자 오른쪽의 패드 무늬. 상자 안에서 잘리며 큰 화면에서만 보인다. */
function PadArt() {
	return (
		<div
			className="pointer-events-none absolute -right-10 top-1/2 hidden w-[26rem] -translate-y-1/2 -rotate-[8deg] grid-cols-8 gap-2 lg:grid"
			aria-hidden
		>
			{Array.from({ length: ART_COLUMNS * ART_ROWS }, (_, i) => (
				<i key={i} className={`aspect-square rounded-md ${artLitPads.has(i) ? 'bg-white/70' : 'bg-black/[0.08]'}`} />
			))}
		</div>
	);
}

export const CtaSection = () => {
	const t = useTranslations('cta');

	const facts = [
		{ icon: Download, label: '9.2M+' },
		{ icon: Star, label: '4.0★' },
		{ icon: Heart, label: t('free') },
		{ icon: Code, label: 'Open Source' },
	];

	return (
		<SectionContainer id="cta" divided={false}>
			{/* 휴대폰의 좌우 여백은 큰 글씨에서도 24px까지만 늘려 안의 버튼에 글자 자리를 남긴다. */}
			<div className="relative overflow-hidden rounded-[1.75rem] bg-accent px-[min(1.5rem,24px)] py-10 text-accent-foreground md:p-14">
				<PadArt />
				<div className="relative">
					<SectionHeading sectionId="cta">{t('title')}</SectionHeading>
					<p className="mt-3.5 max-w-lg text-[1.0625rem] text-[#3d2600]">{t('subtitle')}</p>

					<div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
						<Link
							href="/play"
							className={`${LARGE_BUTTON_CLASS} ${ON_ACCENT_FOCUS_CLASS} bg-accent-foreground px-6 text-white hover:bg-accent-foreground/90`}
						>
							<Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
							{t('playNow')}
						</Link>
						<StoreButtons variant="onAccent" />
					</div>

					<ul className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#3d2600]">
						{facts.map(({ icon: Icon, label }) => (
							<li key={label} className="inline-flex items-center gap-1.5">
								<Icon className="h-3.5 w-3.5" aria-hidden />
								{label}
							</li>
						))}
					</ul>
				</div>
			</div>
		</SectionContainer>
	);
};
