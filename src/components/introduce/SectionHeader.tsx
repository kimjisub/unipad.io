import type { ReactNode } from 'react';

interface SectionContainerProps {
	id: string;
	tinted?: boolean;
	/** 앞 영역과 선·위 여백으로 나눈다. 끄면 앞 영역에 바로 이어진다. */
	divided?: boolean;
	children: ReactNode;
}

/** 소개 페이지의 영역 하나. 제목은 `SectionHeading`이 `${id}-title`로 달아 준다. */
export function SectionContainer({ id, tinted = false, divided = true, children }: SectionContainerProps) {
	return (
		<section
			id={id}
			aria-labelledby={`${id}-title`}
			className={`overflow-x-clip ${divided ? 'border-t border-border/60 py-16 md:py-24' : 'pb-16 md:pb-24'} ${tinted ? 'bg-card/30' : ''}`}
		>
			<div className="mx-auto max-w-6xl px-5 md:px-8">{children}</div>
		</section>
	);
}

interface SectionHeadingProps {
	sectionId: string;
	children: ReactNode;
}

/** 영역 제목. 글자색은 놓인 바탕의 것을 따른다. */
export function SectionHeading({ sectionId, children }: SectionHeadingProps) {
	return (
		<h2
			id={`${sectionId}-title`}
			className="text-[clamp(1.75rem,3.2vw+0.8rem,2.75rem)] font-extrabold leading-[1.18] tracking-[-0.03em] [overflow-wrap:anywhere]"
		>
			{children}
		</h2>
	);
}

interface SectionTitleProps {
	sectionId: string;
	index: string;
	eyebrow: string;
	title: string;
	subtitle?: string;
}

export function SectionTitle({ sectionId, index, eyebrow, title, subtitle }: SectionTitleProps) {
	return (
		<div className="min-w-0 max-w-2xl text-foreground">
			<p className="mb-3 text-[0.8125rem] text-muted-foreground">
				<span className="mr-2 font-semibold tabular-nums text-accent">{index}</span>
				{eyebrow}
			</p>
			<SectionHeading sectionId={sectionId}>{title}</SectionHeading>
			{subtitle && <p className="mt-3.5 text-base text-muted-foreground">{subtitle}</p>}
		</div>
	);
}

interface SectionHeaderProps extends SectionTitleProps {
	aside?: ReactNode;
}

export function SectionHeader({ aside, ...title }: SectionHeaderProps) {
	return (
		<div className="mb-9 flex flex-col gap-5 md:mb-12 md:flex-row md:items-end md:justify-between">
			<SectionTitle {...title} />
			{aside}
		</div>
	);
}
