#!/usr/bin/env node
// Copies corpus.json and corpus.sha256 into the app checkouts, or checks that the copies are byte-identical.
//   node meta/unipack-conformance/sync.mjs --android <unipad-android checkout> --ios <unipad-ios checkout> [--check]
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The folder that holds the copies in each app checkout. */
export const COPY_DIRS = {
  android: 'app/src/test/resources/unipack-conformance',
  ios: 'unipadTests/UniPackConformance',
};

/** Every harness reads corpus.json and refuses it unless it hashes to the value in corpus.sha256. */
export const COPIED_FILES = ['corpus.json', 'corpus.sha256'];

/** Returns one line per copy that is missing or differs; an empty list means every given copy is identical. */
export function differences(checkouts, sourceDir = here) {
  const out = [];
  for (const [platform, root] of Object.entries(checkouts)) {
    for (const name of COPIED_FILES) {
      const target = join(resolve(root), COPY_DIRS[platform], name);
      if (!existsSync(target)) out.push(`${platform}: ${target} is missing`);
      else if (!readFileSync(target).equals(readFileSync(join(sourceDir, name)))) out.push(`${platform}: ${target} differs from the canonical ${name}`);
    }
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
    console.log(`copies are identical to the canonical ${COPIED_FILES.join(' and ')}`);
  } else {
    for (const [platform, root] of Object.entries(checkouts)) {
      const dir = join(resolve(root), COPY_DIRS[platform]);
      mkdirSync(dir, { recursive: true });
      for (const name of COPIED_FILES) copyFileSync(join(here, name), join(dir, name));
      console.log(`${platform}: wrote ${COPIED_FILES.join(' and ')} in ${dir}`);
    }
  }
}
