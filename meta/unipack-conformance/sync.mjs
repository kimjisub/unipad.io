#!/usr/bin/env node
// Copies corpus.json into the app checkouts, or checks that the copies are byte-identical.
//   node meta/unipack-conformance/sync.mjs --android <unipad-android checkout> --ios <unipad-ios checkout> [--check]
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const canonical = join(here, 'corpus.json');

export const COPY_PATHS = {
  android: 'app/src/test/resources/unipack-conformance/corpus.json',
  ios: 'unipadTests/UniPackConformance/corpus.json',
};

/** Returns one line per copy that is missing or differs; an empty list means every given copy is identical. */
export function differences(checkouts, source = canonical) {
  const want = readFileSync(source);
  const out = [];
  for (const [platform, root] of Object.entries(checkouts)) {
    const target = join(resolve(root), COPY_PATHS[platform]);
    if (!existsSync(target)) out.push(`${platform}: ${target} is missing`);
    else if (!readFileSync(target).equals(want)) out.push(`${platform}: ${target} differs from the canonical corpus.json`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const checkouts = {};
  if (arg('--android')) checkouts.android = arg('--android');
  if (arg('--ios')) checkouts.ios = arg('--ios');
  if (Object.keys(checkouts).length === 0) {
    console.error('usage: sync.mjs [--android <checkout>] [--ios <checkout>] [--check]');
    process.exit(2);
  }
  if (args.includes('--check')) {
    const diffs = differences(checkouts);
    for (const d of diffs) console.error(d);
    if (diffs.length) process.exit(1);
    console.log('copies are identical to the canonical corpus.json');
  } else {
    for (const [platform, root] of Object.entries(checkouts)) {
      const target = join(resolve(root), COPY_PATHS[platform]);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(canonical, target);
      console.log(`${platform}: wrote ${target}`);
    }
  }
}
