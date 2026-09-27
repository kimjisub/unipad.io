'use client';

import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { Reveal } from '@/components/motion/Reveal';
import { Link } from '@/i18n/navigation';
import { GOOGLE_PLAY_URL } from '@/lib/constants';

const LIT_PADS = new Set([3, 10, 11, 12, 17, 19, 21, 24, 26, 28, 30, 33, 35, 37, 42, 43, 44, 51]);

export const CtaSection = () => {
	const t = useTranslations('cta');

	return (
		<section id="cta" className="max-w-6xl mx-auto w-full px-5 md:px-8 pt-4 pb-20 md:pb-24">
			<Reveal className="relative overflow-hidden rounded-3xl bg-primary px-7 py-12 md:px-14 md:py-16">
				<div
					className="pointer-events-none absolute -right-10 top-1/2 hidden w-[420px] -translate-y-1/2 rotate-[-8deg] grid-cols-8 gap-2 md:grid"
					aria-hidden
				>
					{Array.from({ length: 64 }).map((_, i) => (
						<div key={i} className={`aspect-square rounded-md ${LIT_PADS.has(i) ? 'bg-white/70' : 'bg-black/[0.08]'}`} />
					))}
				</div>

				<div className="relative max-w-xl">
					<h2 className="text-3xl md:text-5xl font-bold tracking-[-0.035em] text-[#1b1103]">{t('title')}</h2>
					<p className="mt-4 text-base md:text-lg text-[#1b1103]/70">{t('subtitle')}</p>
					<div className="mt-9 flex flex-col sm:flex-row gap-3">
						<Link
							href="/play"
							className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1b1103] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-black"
						>
							<Play className="h-4 w-4 fill-current" />
							{t('playNow')}
						</Link>
						<a
							href={GOOGLE_PLAY_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#1b1103]/25 px-6 text-[15px] font-semibold text-[#1b1103] transition-colors hover:bg-[#1b1103]/[0.06]"
						>
							<AndroidLogo className="h-4 w-4" />
							{t('download')}
						</a>
					</div>
				</div>
			</Reveal>
		</section>
	);
};
