import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { getAllNoticePosts } from '../data/notices';
import { SITE_URL } from '../lib/seo';
import sitemap from './sitemap';

const PAGES_DIR = join(process.cwd(), 'src/app/[locale]');

type Page = { file: string; path: string };

/** Every page.tsx under the locale segment, with the address it is served at (route groups dropped). */
function pages(dir = PAGES_DIR): Page[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
		const full = join(dir, dirent.name);
		if (dirent.isDirectory()) return pages(full);
		if (dirent.name !== 'page.tsx') return [];
		const segments = relative(PAGES_DIR, dir).split(sep).filter((s) => s && !s.startsWith('('));
		return [{ file: full, path: segments.length ? `/${segments.join('/')}` : '' }];
	});
}

test('the sitemap lists every page, and every notice post in place of its [slug] page', () => {
	const expected = pages().flatMap(({ path }) =>
		path === '/notices/[slug]' ? getAllNoticePosts().map((post) => `/notices/${post.slug}`) : [path],
	);
	const listed = sitemap().map((entry) => entry.url);

	assert.equal(new Set(listed).size, listed.length, 'no address is listed twice');
	assert.deepEqual([...listed].sort(), expected.map((path) => `${SITE_URL}${path}`).sort());
});

test('the sitemap lists no per-language addresses, which all redirect to the one address', () => {
	for (const entry of sitemap()) assert.equal(entry.alternates, undefined, entry.url);
});

test('only notice posts carry a modified date, and it is the post date', () => {
	const dates = new Map(getAllNoticePosts().map((post) => [`${SITE_URL}/notices/${post.slug}`, post.date]));
	for (const entry of sitemap()) assert.equal(entry.lastModified, dates.get(entry.url), entry.url);
});

test('every page names its own address as canonical', () => {
	for (const { file, path } of pages()) {
		const source = readFileSync(file, 'utf8');
		const call = path.includes('[slug]')
			? `pageMetadata(\`${path.replace('[slug]', '${slug}')}\`)`
			: `pageMetadata('${path}')`;
		assert.ok(source.includes(call), `${relative(process.cwd(), file)} should call ${call}`);
	}
});
