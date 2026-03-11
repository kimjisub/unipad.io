import type { MetadataRoute } from 'next';

const siteUrl = 'https://unipad.io';

function entry(
	path: string,
	opts: { changeFrequency: MetadataRoute.Sitemap[0]['changeFrequency']; priority: number },
): MetadataRoute.Sitemap[0] {
	return {
		url: `${siteUrl}${path}`,
		lastModified: new Date(),
		changeFrequency: opts.changeFrequency,
		priority: opts.priority,
		alternates: {
			languages: {
				en: `${siteUrl}/en${path}`,
				ko: `${siteUrl}/ko${path}`,
			},
		},
	};
}

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		entry('', { changeFrequency: 'monthly', priority: 1 }),
		entry('/play', { changeFrequency: 'monthly', priority: 0.9 }),
		entry('/docs', { changeFrequency: 'monthly', priority: 0.9 }),
		entry('/docs/unipack', { changeFrequency: 'monthly', priority: 0.8 }),
		entry('/docs/unipack/info', { changeFrequency: 'monthly', priority: 0.7 }),
		entry('/docs/unipack/sounds', { changeFrequency: 'monthly', priority: 0.7 }),
		entry('/docs/unipack/key-sound', { changeFrequency: 'monthly', priority: 0.7 }),
		entry('/docs/unipack/key-led', { changeFrequency: 'monthly', priority: 0.7 }),
		entry('/docs/unipack/auto-play', { changeFrequency: 'monthly', priority: 0.7 }),
		entry('/docs/terms', { changeFrequency: 'yearly', priority: 0.5 }),
		entry('/notices', { changeFrequency: 'weekly', priority: 0.8 }),
	];
}
