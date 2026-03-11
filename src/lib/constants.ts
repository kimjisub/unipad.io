export const APP_STATS = {
	downloads: { target: 9.2, suffix: 'M+' },
	reviews: { target: 100, suffix: 'K+', rating: 4.0, ratingOutOf: 5 },
	since: { target: 2016 },
	openSource: { target: 100, suffix: '%' },
} as const;

export const GOOGLE_PLAY_URL =
	'https://play.google.com/store/apps/details?id=com.kimjisub.launchpad';

export const EXTERNAL_LINKS = {
	discord: 'https://discord.gg/GGKwpgP',
	facebook: 'https://www.facebook.com/playunipad',
	youtube: 'https://www.youtube.com/results?search_query=UniPad+launchpad',
	github: 'https://github.com/kimjisub/unipad-android',
	namuWiki: 'https://namu.wiki/w/%EC%9C%A0%EB%8B%88%ED%8C%A8%EB%93%9C',
} as const;
