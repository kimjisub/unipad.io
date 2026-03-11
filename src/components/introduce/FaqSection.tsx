'use client';

import { useId, useRef, useState } from 'react';
import { motion, useInView, AnimatePresence, type Variants } from 'framer-motion';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EXTERNAL_LINKS } from '@/lib/constants';

const faqKeys = ['0', '1', '2', '3', '4', '5', '6'];

const containerVariants: Variants = {
	hidden: {},
	visible: { transition: { staggerChildren: 0.08 } },
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 16 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

function FaqItem({ question, answer, defaultOpen = false }: { question: string; answer: string; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();
	const panelId = `${id}-panel`;

	return (
		<motion.div
			variants={itemVariants}
			className="border-b border-white/[0.06] last:border-b-0"
		>
			<button
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-controls={panelId}
				className="w-full flex items-center justify-between gap-4 py-5 px-2 -mx-2 rounded-lg text-left group hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 transition-colors"
			>
				<span className="text-sm md:text-base font-medium text-foreground group-hover:text-accent transition-colors">
					{question}
				</span>
				<ChevronDown
					className={`w-4 h-4 text-muted-foreground group-hover:text-accent/60 shrink-0 transition-all duration-200 ${open ? 'rotate-180' : ''}`}
				/>
			</button>
			<AnimatePresence>
				{open && (
					<motion.div
						id={panelId}
						role="region"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 'auto', opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: 'easeInOut' }}
						className="overflow-hidden"
					>
						<p className="pb-5 text-sm text-muted-foreground leading-relaxed pr-8">
							{answer}
						</p>
					</motion.div>
				)}
			</AnimatePresence>
		</motion.div>
	);
}

export const FaqSection = () => {
	const ref = useRef(null);
	const isInView = useInView(ref, { once: true, margin: '-80px' });
	const t = useTranslations('faq');

	return (
		<section className="py-24 bg-card/20 relative overflow-hidden" aria-label={t('title')} ref={ref}>
			<motion.div
				className="absolute top-[30%] left-[10%] w-[300px] h-[200px] rounded-full opacity-[0.03] blur-[100px]"
				aria-hidden
				style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
				animate={{ scale: [1, 1.1, 1] }}
				transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
			/>
			<div className="relative max-w-2xl mx-auto px-4 md:px-6">
				<motion.h2
					className="text-2xl md:text-3xl font-bold text-foreground mb-4 text-center tracking-tight"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5 }}
				>
					{t('title')}
				</motion.h2>
				<motion.p
					className="text-muted-foreground text-center mb-12 max-w-xl mx-auto"
					initial={{ opacity: 0, y: 20 }}
					animate={isInView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5, delay: 0.1 }}
				>
					{t('subtitle')}
				</motion.p>

				<motion.div
					className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md px-6"
					variants={containerVariants}
					initial="hidden"
					animate={isInView ? 'visible' : 'hidden'}
				>
					{faqKeys.map((key, i) => (
						<FaqItem
							key={key}
							question={t(`items.${key}.q`)}
							answer={t(`items.${key}.a`)}
							defaultOpen={i === 0}
						/>
					))}
				</motion.div>

				<motion.div
					className="flex flex-col items-center gap-2 mt-8"
					initial={{ opacity: 0 }}
					animate={isInView ? { opacity: 1 } : {}}
					transition={{ duration: 0.5, delay: 0.6 }}
				>
					<p className="text-sm text-muted-foreground">{t('moreQuestions')}</p>
					<a
						href={EXTERNAL_LINKS.discord}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5865F2] hover:text-[#5865F2]/80 transition-colors"
					>
						<MessageCircle className="w-4 h-4" />
						{t('askOnDiscord')}
					</a>
				</motion.div>
			</div>
		</section>
	);
};
