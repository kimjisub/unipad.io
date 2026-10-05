import { ArrowRight, Play, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LaunchpadDemo } from '@/components/introduce/LaunchpadDemo';
import { LARGE_BUTTON_CLASS, StoreButtons } from '@/components/introduce/StoreButtons';
import { Link } from '@/i18n/navigation';
import { GET_STARTED_PATH } from '@/lib/constants';

/**
 * 첫 화면 윗부분. 제목·설명·세 시작 버튼은 서버에서 그려 움직임 없이 처음부터 보이고,
 * 스크립트가 꺼져 있어도 그대로 쓸 수 있다. 패드 그림만 브라우저에서 움직인다.
 */
export const HeroSection = () => {
	const t = useTranslations('hero');
	const tStats = useTranslations('stats');
	const tCta = useTranslations('cta');

	return (
		<section id="hero" aria-labelledby="hero-title" className="overflow-x-clip">
			<div className="mx-auto grid max-w-6xl items-center gap-11 px-5 pb-14 pt-7 md:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24 lg:pt-[5.5rem]">
				<div className="min-w-0">
					<p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
						<span className="h-[0.4375rem] w-[0.4375rem] rounded-full bg-accent" aria-hidden />
						{t('badge')}
					</p>

					<h1
						id="hero-title"
						className="mt-3.5 text-[clamp(1.75rem,6.2vw+0.6rem,4.25rem)] font-extrabold leading-[1.12] tracking-[-0.035em] text-foreground [overflow-wrap:anywhere]"
					>
						{t('headline1')}{' '}
						<span className="block text-accent">{t('headline2')}</span>
						<span className="sr-only"> — {t('tagline')}</span>
					</h1>

					<p className="mt-4 max-w-[34rem] text-base leading-relaxed text-muted-foreground lg:text-lg">
						{t('description')}
					</p>

					<div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
						<Link
							href="/play"
							className={`${LARGE_BUTTON_CLASS} bg-accent px-5 text-accent-foreground hover:bg-accent/90 sm:px-6`}
						>
							<Play className="h-[1.125rem] w-[1.125rem] shrink-0 fill-current" aria-hidden />
							{t('playOnWeb')}
						</Link>
						<StoreButtons layout="labeled" />
					</div>

					<Link
						href={GET_STARTED_PATH}
						className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] text-foreground/90 underline decoration-muted-foreground/60 underline-offset-[0.3em] hover:decoration-foreground"
					>
						{t('guide')}
						<ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
					</Link>

					<ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.9375rem] text-muted-foreground">
						<li className="inline-flex items-center gap-1.5">
							<strong className="font-bold tabular-nums text-foreground">{tStats('downloadsValue')}</strong>
							{tStats('downloads')}
						</li>
						<li className="inline-flex items-center gap-1.5">
							<Star className="h-[0.9375rem] w-[0.9375rem] fill-accent text-accent" aria-hidden />
							<strong className="font-bold tabular-nums text-foreground">4.0</strong>
							Google Play
						</li>
						<li>{tCta('free')}</li>
					</ul>
				</div>

				<div className="mx-auto w-full max-w-[32.5rem] lg:mr-0">
					<LaunchpadDemo hint={t('tryPads')} />
				</div>
			</div>
		</section>
	);
};
