export const APP_STATS = {
	downloads: { target: 9.2, suffix: 'M+' },
	reviews: { target: 100, suffix: 'K+', rating: 4.0, ratingOutOf: 5 },
	since: { target: 2016 },
	openSource: { target: 100, suffix: '%' },
} as const;

export const GOOGLE_PLAY_URL =
	'https://play.google.com/store/apps/details?id=com.kimjisub.launchpad';

export const APP_STORE_URL = 'https://apps.apple.com/app/id6760479102';

export const GET_STARTED_PATH = '/docs/get-started';

export const EXTERNAL_LINKS = {
	discord: 'https://discord.gg/ESDgyNs',
	facebook: 'https://www.facebook.com/playunipad',
	youtube: 'https://www.youtube.com/results?search_query=UniPad+launchpad',
	github: 'https://github.com/kimjisub/unipad-android',
	namuWiki: 'https://namu.wiki/w/%EC%9C%A0%EB%8B%88%ED%8C%A8%EB%93%9C',
} as const;

const SCROLL_TOP_AVOID_ATTRIBUTE = 'data-scroll-top-avoid';

/** Spread on a group whose links and buttons the scroll-to-top button moves away from, such as install links. */
export const SCROLL_TOP_AVOID = { [SCROLL_TOP_AVOID_ATTRIBUTE]: '' } as const;

export const SCROLL_TOP_AVOID_SELECTOR = `[${SCROLL_TOP_AVOID_ATTRIBUTE}]`;
