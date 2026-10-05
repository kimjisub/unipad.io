import { useTranslations } from 'next-intl';

import { AndroidLogo } from '@/components/icons/AndroidLogo';
import { AppleLogo } from '@/components/icons/AppleLogo';
import { APP_STORE_URL, GOOGLE_PLAY_URL } from '@/lib/constants';

const LARGE_BUTTON_BASE_CLASS =
	'inline-flex min-h-[3.25rem] items-center rounded-xl py-2 text-[1.0625rem] font-semibold leading-tight transition-colors';
const CENTERED_CONTENT_CLASS = 'justify-center gap-2';

/** 소개 페이지의 큰 버튼 공통 모양(내용 가운데 정렬). 좌우 여백과 색은 쓰는 쪽에서 붙인다. */
export const LARGE_BUTTON_CLASS = `${LARGE_BUTTON_BASE_CLASS} ${CENTERED_CONTENT_CLASS}`;

/** 주황 바탕 위 버튼의 키보드 초점 테두리. 사이트 공통 테두리는 주황이라 이 바탕에서는 보이지 않는다. */
export const ON_ACCENT_FOCUS_CLASS = 'focus-visible:outline-accent-foreground';

interface StoreButtonsProps {
	/** surface: 어두운 바탕 위, onAccent: 주황 바탕 위 */
	variant?: 'surface' | 'onAccent';
	/** labeled: 플랫폼 이름을 작게 얹은 두 줄(왼쪽 정렬), plain: 스토어 이름만(가운데 정렬) */
	layout?: 'labeled' | 'plain';
	className?: string;
}

const variantClass = {
	surface: 'border border-muted bg-card text-foreground hover:bg-muted/40',
	onAccent: `border-[1.5px] border-accent-foreground/40 text-accent-foreground hover:bg-accent-foreground/10 ${ON_ACCENT_FOCUS_CLASS}`,
} as const;

// 정렬·간격·좌우 여백은 배치마다 여기서 한 가지씩만 정한다.
const layoutClass = {
	plain: `${CENTERED_CONTENT_CLASS} px-5 sm:min-w-[9rem]`,
	labeled: 'justify-start gap-3 px-3.5 sm:min-w-[10rem]',
} as const;

const captionClass = {
	surface: 'text-muted-foreground',
	onAccent: 'text-accent-foreground/80',
} as const;

/** Google Play와 App Store로 가는 같은 무게의 버튼 두 개. 자리가 모자라면 위아래로 쌓인다. */
export function StoreButtons({ variant = 'surface', layout = 'plain', className = '' }: StoreButtonsProps) {
	const t = useTranslations('stores');
	const stores = [
		{ key: 'googlePlay', caption: t('android'), name: t('googlePlay'), href: GOOGLE_PLAY_URL, Logo: AndroidLogo },
		{ key: 'appStore', caption: t('ios'), name: t('appStore'), href: APP_STORE_URL, Logo: AppleLogo },
	];

	return (
		<div className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-2.5 sm:flex sm:flex-wrap ${className}`}>
			{stores.map(({ key, caption, name, href, Logo }) => (
				<a
					key={key}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className={`${LARGE_BUTTON_BASE_CLASS} ${layoutClass[layout]} ${variantClass[variant]} min-w-0`}
				>
					<Logo className="h-5 w-5 shrink-0" aria-hidden />
					{layout === 'labeled' ? (
						<span className="flex min-w-0 flex-col text-left">
							<span className={`text-xs font-medium leading-snug ${captionClass[variant]}`}>{caption}</span>
							<span className="text-base leading-tight">{name}</span>
						</span>
					) : (
						name
					)}
				</a>
			))}
		</div>
	);
}
