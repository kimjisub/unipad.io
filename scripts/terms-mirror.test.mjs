import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { buildTermsMirror, MAIN_SITE } from './terms-mirror.mts';

const messages = locale => JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, 'utf8')).docs.terms;
const escapeHtml = text => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

function outDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'terms-mirror-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const pages = [
  { file: 'docs/terms/privacy/index.html', locale: 'en', doc: 'privacy', heading: '<h2>In short</h2>' },
  { file: 'docs/terms/usage/index.html', locale: 'en', doc: 'usage', heading: '<h2>Permitted Usage Examples</h2>' },
  { file: 'ko/docs/terms/privacy/index.html', locale: 'ko', doc: 'privacy', heading: '<h2>요약</h2>' },
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
    assert.ok(html.includes(`<h1>${escapeHtml(terms[page.doc].title)}</h1>`), `${page.file} title`);
    assert.ok(html.includes(page.heading), `${page.file} body`);
    assert.ok(html.includes(`<link rel="canonical" href="${MAIN_SITE}/docs/terms/${page.doc}">`), `${page.file} canonical`);
    if (page.doc === 'privacy') assert.ok(html.includes(escapeHtml(terms.privacy.effectiveDate)), `${page.file} effective date`);
    // Readable without scripts, and nothing reports visits from the copy.
    assert.doesNotMatch(html, /<script/i);
  }
  const body = file => readFileSync(join(dir, file), 'utf8').match(/<article>[\s\S]*<\/article>/)[0];
  assert.notEqual(body('ko/docs/terms/privacy/index.html'), body('docs/terms/privacy/index.html'));
  for (const file of ['docs/terms/privacy/index.html', 'ko/docs/terms/privacy/index.html']) {
    const html = body(file);
    assert.match(html, /<table>/);
    assert.equal((html.match(/<tr>/g) || []).length, 6);
    assert.match(html, /href="mailto:0226unipad@gmail.com"/);
    assert.match(html, /href="https:\/\/policies.google.com\/privacy/);
    assert.match(html, /href="https:\/\/vercel.com\/legal\/privacy-policy"/);
    assert.doesNotMatch(html, /2018|Definitions|Personally identifiable|## /);
  }
});

test('privacy copies describe performance, store requests and capacity-based log retention', async t => {
  const dir = outDir(t);
  await buildTermsMirror(dir);
  const cases = [
    ['docs/terms/privacy/index.html', ['usually about two months', 'oldest first', 'Performance data: 60 days', 'Store list requests', 'recorded with the pack', 'your browser downloads it directly from the same server']],
    ['ko/docs/terms/privacy/index.html', ['보통 2개월 안팎', '오래된 것부터', '성능 측정 기록: 60일', '스토어 목록 요청 기록', '그 팩의 스토어 코드', '브라우저가 같은 서버에서 바로 받습니다']],
  ];
  for (const [file, phrases] of cases) {
    const html = readFileSync(join(dir, file), 'utf8');
    for (const phrase of [...phrases, 'Firebase Performance Monitoring', 'Remote Config', 'Realtime Database']) {
      assert.ok(html.includes(phrase), `${file} is missing ${phrase}`);
    }
  }
});

test('the list keeps the site path, so only the domain changes in every address', async t => {
  const dir = outDir(t);
  const written = await buildTermsMirror(dir);
  for (const [prefix, locale] of [['', 'en'], ['ko/', 'ko']]) {
    const list = readFileSync(join(dir, `${prefix}docs/terms/index.html`), 'utf8');
    assert.ok(list.includes(`<h1>${escapeHtml(messages(locale).title)}</h1>`), `${prefix} list title`);
    assert.ok(list.includes(`<link rel="canonical" href="${MAIN_SITE}/docs/terms">`), `${prefix} list canonical`);
    // The bare folder of the copy leads to the list instead of a 404.
    assert.ok(written.includes(`${prefix}index.html`), `${prefix}index.html was not written`);
    assert.match(readFileSync(join(dir, `${prefix}index.html`), 'utf8'), /<meta http-equiv="refresh" content="0; url=docs\/terms\/">/);
  }
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
