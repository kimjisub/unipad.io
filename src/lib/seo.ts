import type { Metadata } from 'next';

export const SITE_URL = 'https://unipad.io';

/**
 * Metadata that names a page's own address as its canonical one.
 *
 * Every page is served at a single address for all languages (the language comes from a
 * cookie or the browser, `localePrefix: 'never'`), so a page lists no per-language
 * alternates: there is no other address to point to. The URL is absolute because the
 * /play layout sets no `metadataBase`.
 */
export function pageMetadata(path: string): Pick<Metadata, 'alternates'> {
	return { alternates: { canonical: `${SITE_URL}${path}` } };
}
