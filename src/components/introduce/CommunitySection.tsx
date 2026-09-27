'use client';

import { ArrowUpRight, GitBranch, MessageCircle, Play, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { Reveal } from '@/components/motion/Reveal';
import { EXTERNAL_LINKS } from '@/lib/constants';

const links = [
	{ key: 'discord', icon: MessageCircle, url: EXTERNAL_LINKS.discord, color: '#7984ff', badge: '1.5K+' },
	{ key: 'facebook', icon: Users, url: EXTERNAL_LINKS.facebook, color: '#4c95ff', badge: '10K+' },
	{ key: 'youtube', icon: Play, url: EXTERNAL_LINKS.youtube, color: '#ff4d4d', badge: '1K+' },
	{ key: 'github', icon: GitBranch, url: EXTERNAL_LINKS.github, color: '#e6edf6', badge: 'OSS' },
] as const;

export const CommunitySection = () => {
	const t = useTranslations('community');

	return (
		<SectionContainer id="community">
			<SectionHeader index="04" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
				{links.map(({ key, icon: Icon, url, color, badge }, i) => (
					<Reveal key={key} delay={i * 0.06}>
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="group flex h-full flex-col rounded-2xl border border-border bg-card/40 p-5 md:p-6 transition-colors hover:bg-card/70"
						>
							<div className="flex items-center justify-between">
								<span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}1f` }}>
									<Icon className="h-5 w-5" style={{ color }} />
								</span>
								<ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
							</div>
							<p className="mt-6 md:mt-8 font-semibold text-foreground">{t(key)}</p>
							<p className="mt-1 text-sm text-muted-foreground">{t(`${key}Desc`)}</p>
							<p className="mt-5 font-mono text-xs" style={{ color }}>{badge}</p>
						</a>
					</Reveal>
				))}
			</div>
		</SectionContainer>
	);
};
