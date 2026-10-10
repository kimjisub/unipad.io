#!/usr/bin/env node
// Builds corpus.json from cases.mjs, palette.json and divergences.json.
//   node meta/unipack-conformance/build-corpus.mjs           write corpus.json
//   node meta/unipack-conformance/build-corpus.mjs --check   fail if corpus.json is not what the sources build
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from './cases.mjs';
import { buildAssets, fingerprint, SCHEMA, sha256 } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const read = (name) => JSON.parse(readFileSync(join(here, name), 'utf8'));

const PLATFORMS = ['android', 'ios', 'web'];
const STATUSES = ['fail', 'unsupported', 'intended-difference'];

export function buildCorpus() {
  const palette = read('palette.json');
  const divergences = existsSync(join(here, 'divergences.json')) ? read('divergences.json') : {};
  const assets = buildAssets();
  const cases = buildCases(palette);

  const seen = new Set();
  const problems = [];
  const out = cases.map((c) => {
    if (seen.has(c.id)) problems.push(`duplicate case id ${c.id}`);
    seen.add(c.id);
    if (c.expectation === 'determined') {
      if (!c.expected) problems.push(`${c.id}: determined without expected`);
      // A reference basis (another implementation) only stands for the palette, which no doc lists.
      if (!c.basis?.some((b) => b.type === 'doc' || b.type === 'intent' || (c.layer === 'palette' && b.type === 'reference'))) {
        problems.push(`${c.id}: determined without a doc or intent basis`);
      }
    } else if (!c.question) {
      problems.push(`${c.id}: undetermined without the open question`);
    }
    for (const b of c.basis ?? []) {
      if (b.type === 'doc' && !existsSync(join(repoRoot, b.ref))) problems.push(`${c.id}: doc basis ${b.ref} does not exist`);
    }
    const known = divergences[c.id];
    if (known) {
      if (c.expectation !== 'determined') problems.push(`${c.id}: a divergence is pinned on an undetermined case`);
      for (const [platform, d] of Object.entries(known)) {
        if (!PLATFORMS.includes(platform)) problems.push(`${c.id}: unknown platform ${platform}`);
        if (!STATUSES.includes(d.status)) problems.push(`${c.id}/${platform}: unknown status ${d.status}`);
        if (!d.actual || !d.note) problems.push(`${c.id}/${platform}: a divergence needs the pinned actual and a note`);
      }
    }
    for (const [platform, reason] of Object.entries(c.unobserved ?? {})) {
      if (!PLATFORMS.includes(platform)) problems.push(`${c.id}: unobserved names the unknown platform ${platform}`);
      if (typeof reason !== 'string' || !reason) problems.push(`${c.id}/${platform}: unobserved needs the reason`);
      if (known?.[platform]) problems.push(`${c.id}/${platform}: a case cannot be both unobserved and a pinned divergence`);
    }
    const { files, expected, expectation, ...rest } = c;
    const entry = { ...rest, expectation };
    entry.files = files;
    entry.fingerprint = fingerprint(files, assets);
    if (expectation === 'determined') entry.expected = expected;
    if (known) entry.known = known;
    return entry;
  });
  if (problems.length) throw new Error(`corpus is inconsistent:\n  ${problems.join('\n  ')}`);

  for (const id of Object.keys(divergences)) if (!seen.has(id)) throw new Error(`divergences.json names unknown case ${id}`);

  return {
    schema: SCHEMA,
    generatedBy: 'meta/unipack-conformance/build-corpus.mjs',
    rights: 'Every sound is a synthesized 10 ms signal made by lib.mjs (two sine tones and silence). No pack, song or third-party audio is included.',
    assets,
    palette,
    cases: out,
  };
}

export function serialize(corpus) {
  return `${JSON.stringify(corpus, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(here, 'corpus.json');
  const text = serialize(buildCorpus());
  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== text) {
      console.error('corpus.json is out of date with cases.mjs / palette.json / divergences.json; run build-corpus.mjs');
      process.exit(1);
    }
    console.log(`corpus.json is current (sha256 ${sha256(Buffer.from(text))}, ${JSON.parse(text).cases.length} cases)`);
  } else {
    writeFileSync(target, text);
    console.log(`wrote corpus.json (sha256 ${sha256(Buffer.from(text))}, ${JSON.parse(text).cases.length} cases)`);
  }
}
