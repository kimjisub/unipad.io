import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { buildTermsMirror, MAIN_SITE } from './terms-mirror.mts';

const messages = locale => JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, 'utf8')).docs.terms;

function outDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'terms-mirror-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const pages = [
  { file: 'docs/terms/privacy/index.html', locale: 'en', doc: 'privacy', heading: '<h2>Definitions</h2>' },
  { file: 'docs/terms/usage/index.html', locale: 'en', doc: 'usage', heading: '<h2>Permitted Usage Examples</h2>' },
  // The site has no Korean privacy text yet and shows the English one under the Korean title.
  { file: 'ko/docs/terms/privacy/index.html', locale: 'ko', doc: 'privacy', heading: '<h2>Definitions</h2>' },
  { file: 'ko/docs/terms/usage/index.html', locale: 'ko', doc: 'usage', heading: '<h2>허용되는 사용 예시</h2>' },
];

test('the copy has both documents in both languages with the site titles and body', async t => {
  const dir = outDir(t);
  const written = await buildTermsMirror(dir);
  for (const page of pages) {
    assert.ok(written.includes(page.file), `${page.file} was not written`);
    const html = readFileSync(join(dir, page.file), 'utf8');
    const terms = messages(page.locale);
    assert.match(html, new RegExp(`<html lang="${page.locale}">`));
    assert.ok(html.includes(`<h1>${terms[page.doc].title}</h1>`), `${page.file} title`);
    assert.ok(html.includes(page.heading), `${page.file} body`);
    assert.ok(html.includes(`<link rel="canonical" href="${MAIN_SITE}/docs/terms/${page.doc}">`), `${page.file} canonical`);
    if (page.doc === 'privacy') assert.ok(html.includes(terms.privacy.effectiveDate), `${page.file} effective date`);
    // Readable without scripts, and nothing reports visits from the copy.
    assert.doesNotMatch(html, /<script/i);
  }
  const body = file => readFileSync(join(dir, file), 'utf8').match(/<article>[\s\S]*<\/article>/)[0];
  assert.equal(body('ko/docs/terms/privacy/index.html'), body('docs/terms/privacy/index.html'));
});

test('every link between the copied pages reaches a written page', async t => {
  const dir = outDir(t);
  const written = await buildTermsMirror(dir);
  let checked = 0;
  for (const file of written) {
    const html = readFileSync(join(dir, file), 'utf8');
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      assert.ok(href.endsWith('/'), `${file} links to ${href} without a trailing slash`);
      assert.ok(existsSync(join(resolve(dir, dirname(file), href), 'index.html')), `${file} links to missing ${href}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `only ${checked} internal links checked`);
});

test('the build refuses a folder that already holds files', async t => {
  const dir = outDir(t);
  writeFileSync(join(dir, 'keep.txt'), 'x');
  await assert.rejects(buildTermsMirror(dir), /not empty/);
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'x');
});
