import type { MetadataRoute } from 'next';

import { getAllNoticePosts } from '@/data/notices';
import { GET_STARTED_PATH } from '@/lib/constants';
import { SITE_URL } from '@/lib/seo';

type Entry = MetadataRoute.Sitemap[number];

// No per-language alternates: every page has one address for all languages (see pageMetadata).
// No lastModified for pages without a real date: a build time would mark every page changed on every deploy.
function entry(path: string, changeFrequency: Entry['changeFrequency'], priority: number, lastModified?: string): Entry {
	return { url: `${SITE_URL}${path}`, changeFrequency, priority, ...(lastModified && { lastModified }) };
}

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		entry('', 'monthly', 1),
		entry('/play', 'monthly', 0.9),
		entry('/docs', 'monthly', 0.9),
		entry(GET_STARTED_PATH, 'monthly', 0.9),
		entry('/docs/unipack', 'monthly', 0.8),
		entry('/docs/unipack/info', 'monthly', 0.7),
		entry('/docs/unipack/sounds', 'monthly', 0.7),
		entry('/docs/unipack/key-sound', 'monthly', 0.7),
		entry('/docs/unipack/key-led', 'monthly', 0.7),
		entry('/docs/unipack/auto-play', 'monthly', 0.7),
		entry('/docs/unipack/playback', 'monthly', 0.7),
		entry('/docs/theme', 'monthly', 0.7),
		entry('/docs/terms', 'yearly', 0.5),
		entry('/docs/terms/privacy', 'yearly', 0.5),
		entry('/docs/terms/usage', 'yearly', 0.5),
		entry('/notices', 'weekly', 0.8),
		...getAllNoticePosts().map((post) => entry(`/notices/${post.slug}`, 'yearly', 0.6, post.date)),
	];
}
