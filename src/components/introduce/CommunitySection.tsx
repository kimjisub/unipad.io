import { ArrowUpRight, GitBranch, MessageCircle, Play, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SectionContainer, SectionHeader } from '@/components/introduce/SectionHeader';
import { EXTERNAL_LINKS } from '@/lib/constants';

interface CommunityLink {
	key: 'discord' | 'facebook' | 'youtube' | 'github';
	icon: LucideIcon;
	url: string;
	badge: string;
	/** 아이콘 바탕(브랜드 색 15%) */
	iconBg: string;
	/** 어두운 카드 위에서 4.5:1을 넘도록 밝게 잡은 브랜드 색 */
	color: string;
}

const links: CommunityLink[] = [
	{ key: 'discord', icon: MessageCircle, url: EXTERNAL_LINKS.discord, badge: '1.5K+', iconBg: 'bg-[#9ba6ff]/15', color: 'text-[#9ba6ff]' },
	{ key: 'facebook', icon: Users, url: EXTERNAL_LINKS.facebook, badge: '10K+', iconBg: 'bg-[#6ea8ff]/15', color: 'text-[#6ea8ff]' },
	{ key: 'youtube', icon: Play, url: EXTERNAL_LINKS.youtube, badge: '1K+', iconBg: 'bg-[#ff7b7b]/15', color: 'text-[#ff7b7b]' },
	{ key: 'github', icon: GitBranch, url: EXTERNAL_LINKS.github, badge: 'OSS', iconBg: 'bg-foreground/10', color: 'text-foreground' },
];

export const CommunitySection = () => {
	const t = useTranslations('community');

	return (
		<SectionContainer id="community">
			<SectionHeader sectionId="community" index="04" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3 lg:grid-cols-4 lg:gap-4">
				{links.map(({ key, icon: Icon, url, badge, iconBg, color }) => (
					<a
						key={key}
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						className="group flex min-w-0 flex-col rounded-[1.25rem] border border-border bg-card/60 p-5 transition-colors hover:border-muted hover:bg-card"
					>
						<span className="flex items-start justify-between">
							<span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
								<Icon className={`h-5 w-5 ${color}`} aria-hidden />
							</span>
							<ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-accent" aria-hidden />
						</span>
						<span className="mt-6 font-semibold text-foreground [overflow-wrap:anywhere]">{t(key)}</span>
						<span className="mt-1 text-sm text-muted-foreground">{t(`${key}Desc`)}</span>
						<span className={`mt-auto pt-4 text-[0.8125rem] font-bold ${color}`}>{badge}</span>
					</a>
				))}
			</div>
		</SectionContainer>
	);
};
