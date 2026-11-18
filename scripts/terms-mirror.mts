// Builds a static copy of the privacy policy and the app usage notice from the same MDX and
// message files the site renders, so the store-linked documents stay readable on a second host
// (GitHub Pages, .github/workflows/terms-mirror.yml) when the main site is unavailable.
// Usage: node --import tsx scripts/terms-mirror.mts <empty output folder>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadMdxContent } from '../src/lib/mdx';
import { mdxComponents } from '../src/components/docs/mdx-components';
import { routing } from '../src/i18n/routing';

export const MAIN_SITE = 'https://unipad.io';

export const TERMS_DOCS = ['privacy', 'usage'] as const;
export type TermsDoc = (typeof TERMS_DOCS)[number];
type Locale = (typeof routing.locales)[number];

interface TermsMessages {
  title: string;
  privacy: { title: string; effectiveDate: string };
  usage: { title: string };
}

// Text that exists only on the copy; the documents themselves come from content/docs.
const COPY_NOTICE: Record<Locale, { before: string; after: string; language: string }> = {
  en: {
    before: 'This page is a copy of ',
    after: ', published here as well so it stays readable when the main site is unavailable.',
    language: 'English',
  },
  ko: {
    before: '이 페이지는 ',
    after: '의 사본입니다. 본 사이트에 접속할 수 없을 때에도 읽을 수 있도록 함께 게시합니다.',
    language: '한국어',
  },
};

/** Site path of a document, the same on the main site and on the copy. */
export function docPath(doc: TermsDoc): string {
  return `/docs/terms/${doc}`;
}

const LIST_PATH = '/docs/terms';

/** Folder of a locale on the copy; the default locale stays at the root, as on the site. */
function localeDir(locale: Locale): string {
  return locale === routing.defaultLocale ? '' : `${locale}/`;
}

/** Folder of a page on the copy: the site's path inside the locale folder. */
export function pageDir(locale: Locale, doc?: TermsDoc): string {
  return `${localeDir(locale)}${(doc ? docPath(doc) : LIST_PATH).slice(1)}/`;
}

function termsMessages(locale: string): TermsMessages {
  const file = join(process.cwd(), 'src/i18n/messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')).docs.terms;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

function link(from: string, to: string): string {
  const path = posix.relative(from || '.', to || '.');
  return path === '' ? './' : `${path}/`;
}

async function renderBody(locale: string, doc: TermsDoc): Promise<string> {
  const { content } = await compileMDX({
    source: loadMdxContent(locale, `terms/${doc}`),
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
    components: mdxComponents,
  });
  return renderToStaticMarkup(content);
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1a1a1a; --muted: #5c5c5c; --bg: #fff; --line: #ddd; --accent: #0b57d0; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececec; --muted: #a8a8a8; --bg: #121212; --line: #333; --accent: #8ab4f8; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { max-width: 48rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
nav { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.9rem; margin-bottom: 2rem; }
a { color: var(--accent); }
h1 { font-size: 2rem; line-height: 1.3; margin: 0 0 0.5rem; }
.subtitle, .notice { color: var(--muted); }
.notice { font-size: 0.9rem; border-top: 1px solid var(--line); margin-top: 3rem; padding-top: 1rem; }
table { border-collapse: collapse; } th, td { border: 1px solid var(--line); padding: 0.25rem 0.5rem; }
`;

function page(options: { locale: string; title: string; canonical: string; body: string; nav: string }): string {
  return `<!doctype html>
<html lang="${options.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} | UniPad</title>
<link rel="canonical" href="${options.canonical}">
<style>${STYLE}</style>
</head>
<body>
<main>
${options.nav}
${options.body}
</main>
</body>
</html>
`;
}

async function docPage(locale: Locale, doc: TermsDoc): Promise<string> {
  const messages = termsMessages(locale);
  const dir = pageDir(locale, doc);
  const notice = COPY_NOTICE[locale];
  const canonical = `${MAIN_SITE}${docPath(doc)}`;
  const subtitle = doc === 'privacy' ? messages.privacy.effectiveDate : undefined;
  const others = routing.locales
    .filter(other => other !== locale)
    .map(other => `<a href="${link(dir, pageDir(other, doc))}" hreflang="${other}" lang="${other}">${COPY_NOTICE[other].language}</a>`)
    .join(' ');
  const body = [
    `<h1>${escapeHtml(messages[doc].title)}</h1>`,
    subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : '',
    `<article>${await renderBody(locale, doc)}</article>`,
    `<p class="notice">${escapeHtml(notice.before)}<a href="${canonical}">${canonical}</a>${escapeHtml(notice.after)}</p>`,
  ].join('\n');
  return page({
    locale,
    title: messages[doc].title,
    canonical,
    body,
    nav: `<nav><a href="${link(dir, pageDir(locale))}">${escapeHtml(messages.title)}</a><span>${others}</span></nav>`,
  });
}

function listPage(locale: Locale): string {
  const messages = termsMessages(locale);
  const dir = pageDir(locale);
  const notice = COPY_NOTICE[locale];
  const others = routing.locales
    .filter(other => other !== locale)
    .map(other => `<a href="${link(dir, pageDir(other))}" hreflang="${other}" lang="${other}">${COPY_NOTICE[other].language}</a>`)
    .join(' ');
  const items = TERMS_DOCS.map(doc => `<li><a href="${link(dir, pageDir(locale, doc))}">${escapeHtml(messages[doc].title)}</a></li>`).join('\n');
  const canonical = `${MAIN_SITE}${LIST_PATH}`;
  return page({
    locale,
    title: messages.title,
    canonical,
    body: `<h1>${escapeHtml(messages.title)}</h1>\n<ul>\n${items}\n</ul>\n<p class="notice">${escapeHtml(notice.before)}<a href="${canonical}">${canonical}</a>${escapeHtml(notice.after)}</p>`,
    nav: `<nav><span></span><span>${others}</span></nav>`,
  });
}

/** The locale folder itself only points to the list, which keeps the site's path. */
function rootPage(locale: Locale): string {
  const target = link(localeDir(locale), pageDir(locale));
  const title = termsMessages(locale).title;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${target}">
<title>${escapeHtml(title)} | UniPad</title>
</head>
<body><a href="${target}">${escapeHtml(title)}</a></body>
</html>
`;
}

/** Writes every page into outDir, which must be missing or empty; returns the written paths relative to it. */
export async function buildTermsMirror(outDir: string): Promise<string[]> {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`Output folder is not empty: ${outDir}`);
  }
  const written: string[] = [];
  const write = (dir: string, html: string) => {
    const file = join(outDir, dir, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    written.push(relative(outDir, file));
  };
  for (const locale of routing.locales) {
    write(localeDir(locale), rootPage(locale));
    write(pageDir(locale), listPage(locale));
    for (const doc of TERMS_DOCS) {
      write(pageDir(locale, doc), await docPage(locale, doc));
    }
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Usage: node --import tsx scripts/terms-mirror.mts <empty output folder>');
    process.exit(2);
  }
  const written = await buildTermsMirror(resolve(outDir));
  console.log(written.join('\n'));
}
