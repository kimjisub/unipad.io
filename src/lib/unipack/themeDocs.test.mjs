import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { THEME_IMAGES } = require('./ThemeManager.ts');

const LOCALES = ['ko', 'en'];
const STRUCTURE_HEADING = { ko: '## 파일 구조', en: '## File Structure' };
const FULL_SETUP_HEADING = { ko: '### 전체 구성', en: '### Full Setup' };

// Read by an app but not by the web player. Each entry is a file the public page must describe,
// including which apps support it; remove it here once the web player reads it too.
const APP_ONLY_FILES = ['logo_led.png'];
const JSON_FILES = ['theme.json', 'colors.json'];

function doc(locale) {
  return readFileSync(new URL(`../../../content/docs/${locale}/theme.mdx`, import.meta.url), 'utf8');
}

/** File names in the first code block after `heading`, one per tree line (`├── name  comment`). */
function treeFiles(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const block = source.slice(start).split('```')[1];
  return [...block.matchAll(/[├└]── (\S+)/g)].map(match => match[1]);
}

const webFiles = [...JSON_FILES, ...THEME_IMAGES.map(([, stems]) => `${stems[0]}.png`)];

for (const locale of LOCALES) {
  test(`${locale} theme page lists every file an app reads, and nothing else`, () => {
    const listed = treeFiles(doc(locale), STRUCTURE_HEADING[locale]);
    assert.deepEqual([...listed].sort(), [...webFiles, ...APP_ONLY_FILES].sort());
  });

  test(`${locale} full setup example only uses listed files`, () => {
    const source = doc(locale);
    const listed = new Set(treeFiles(source, STRUCTURE_HEADING[locale]));
    for (const file of treeFiles(source, FULL_SETUP_HEADING[locale])) assert.ok(listed.has(file), file);
  });
}

test('Korean and English theme pages list the same files in the same order', () => {
  assert.deepEqual(treeFiles(doc('ko'), STRUCTURE_HEADING.ko), treeFiles(doc('en'), STRUCTURE_HEADING.en));
});

test('each app-only file is described in both languages', () => {
  for (const locale of LOCALES) {
    // Headings escape underscores for MDX: `### Title (logo\_led.png)`.
    const headings = doc(locale).split('\n').filter(line => line.startsWith('###')).map(line => line.replace(/\\/g, ''));
    for (const file of APP_ONLY_FILES) {
      assert.ok(headings.some(heading => heading.includes(`(${file})`)), `${locale}: no section for ${file}`);
    }
  }
});

// The iOS app decodes theme.json with Swift's synthesized Codable, which ignores property defaults,
// so every field below fails the import there when missing. Shrink this once the iOS app accepts gaps.
const THEME_JSON_REQUIRED = ['name', 'author', 'version'];

test('theme.json fields the iOS app requires are marked required in both languages', () => {
  for (const locale of LOCALES) {
    const section = doc(locale).split('### theme.json')[1]?.split(/\n#{2,3} /)[0] ?? '';
    const rows = section.split('\n').filter(line => /^\| `\w+` \| string \|/.test(line));
    const required = rows
      .map(line => line.split('|').map(cell => cell.trim()))
      .filter(cells => cells[3] === 'O')
      .map(cells => cells[1].replaceAll('`', ''));
    assert.deepEqual(required, THEME_JSON_REQUIRED, locale);
  }
});
