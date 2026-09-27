import type { ReactNode } from 'react';

import { Reveal } from '@/components/motion/Reveal';

interface SectionHeaderProps {
	index: string;
	eyebrow: string;
	title: string;
	subtitle?: string;
	aside?: ReactNode;
}

export function SectionHeader({ index, eyebrow, title, subtitle, aside }: SectionHeaderProps) {
	return (
		<Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 md:mb-14">
			<div className="max-w-2xl">
				<p className="font-mono text-xs tracking-wider text-muted-foreground mb-4">
					<span className="text-primary">{index}</span>
					<span className="mx-2 text-border">/</span>
					{eyebrow}
				</p>
				<h2 className="text-3xl md:text-[44px] md:leading-[1.1] font-bold tracking-[-0.03em] text-foreground">
					{title}
				</h2>
				{subtitle && (
					<p className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed">{subtitle}</p>
				)}
			</div>
			{aside}
		</Reveal>
	);
}

export function SectionContainer({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) {
	return (
		<section id={id} className={`py-16 md:py-24 ${className}`}>
			<div className="max-w-6xl mx-auto px-5 md:px-8">{children}</div>
		</section>
	);
}
