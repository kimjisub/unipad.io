'use client';

import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Reveal } from '@/components/motion/Reveal';
import { EXTERNAL_LINKS, FAQ_KEYS } from '@/lib/constants';

function FaqItem({ question, answer, defaultOpen = false }: { question: string; answer: string; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = `${useId()}-panel`;

	return (
		<div className="border-b border-border">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-controls={panelId}
				className="group flex w-full items-center justify-between gap-6 py-5 text-left"
			>
				<span className="text-base md:text-[17px] font-medium text-foreground transition-colors group-hover:text-primary">{question}</span>
				<Plus className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
			</button>
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						id={panelId}
						role="region"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 'auto', opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.22, ease: 'easeInOut' }}
						className="overflow-hidden"
					>
						<p className="pb-6 pr-10 text-[15px] leading-relaxed text-muted-foreground">{answer}</p>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export const FaqSection = () => {
	const t = useTranslations('faq');

	return (
		<SectionContainer id="faq">
			<div className="grid gap-4 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
				<div className="lg:sticky lg:top-24 lg:self-start">
					<SectionHeader index="05" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
					<Reveal className="-mt-4 hidden lg:block">
						<p className="text-sm text-muted-foreground">{t('moreQuestions')}</p>
						<a
							href={EXTERNAL_LINKS.discord}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/[0.03]"
						>
							<MessageCircle className="h-4 w-4 text-[#7984ff]" />
							{t('askOnDiscord')}
						</a>
					</Reveal>
				</div>

				<Reveal className="border-t border-border">
					{FAQ_KEYS.map((key, i) => (
						<FaqItem key={key} question={t(`items.${key}.q`)} answer={t(`items.${key}.a`)} defaultOpen={i === 0} />
					))}
					<a
						href={EXTERNAL_LINKS.discord}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-[#7984ff] lg:hidden"
					>
						<MessageCircle className="h-4 w-4" />
						{t('askOnDiscord')}
					</a>
				</Reveal>
			</div>
		</SectionContainer>
	);
};
