import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileMDX } from 'next-mdx-remote/rsc';
import { renderToStaticMarkup } from 'react-dom/server';
import remarkGfm from 'remark-gfm';

const require = createRequire(import.meta.url);
const { mdxComponents } = require('./mdx-components.tsx');

const CONTENT_DIR = fileURLToPath(new URL('../../../content/docs', import.meta.url));

function mdxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith('.mdx') ? [path] : [];
  });
}

/** Renders a page the way `MdxContent` does and returns the text a reader sees outside code. */
async function visibleProse(source) {
  const { content } = await compileMDX({
    source,
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
    components: mdxComponents,
  });
  return renderToStaticMarkup(content)
    .replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

// Bold that ends in a symbol and is followed directly by a letter (`**×**를`) is not closed by
// Markdown, so the asterisks reach the page. Write `<strong>×</strong>` in that position instead.
for (const file of mdxFiles(CONTENT_DIR)) {
  test(`${relative(CONTENT_DIR, file)} shows no bold markers as text`, async () => {
    const prose = await visibleProse(readFileSync(file, 'utf8'));
    const leftovers = [...prose.matchAll(/.{0,30}\*\*.{0,30}/g)].map(match => match[0].trim());
    assert.deepEqual(leftovers, []);
  });
}
