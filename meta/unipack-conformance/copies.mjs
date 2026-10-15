#!/usr/bin/env node
// Names the exact unipad-android and unipad-ios commits whose corpus copies CI compares with this directory.
//   node meta/unipack-conformance/copies.mjs [--android <commit>] [--ios <commit>]
// Prints `android=<commit>` and `ios=<commit>`. A given commit replaces the one in copies.json; an empty or
// absent one keeps it. Anything other than a full 40-character commit hash (a branch, a tag, a short hash)
// is refused, so a comparison never runs against a moving target.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPY_DIRS } from './sync.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const PLATFORMS = Object.keys(COPY_DIRS);

/** The pinned commits from copies.json text, with any non-empty override applied; throws on anything else. */
export function resolveCommits(text, overrides = {}) {
  const pinned = JSON.parse(text);
  if (typeof pinned !== 'object' || pinned === null || Array.isArray(pinned)) throw new Error('copies.json must be an object');
  const keys = Object.keys(pinned).sort();
  if (keys.join() !== [...PLATFORMS].sort().join()) throw new Error(`copies.json must name exactly ${PLATFORMS.join(' and ')}, found: ${keys.join(', ') || 'nothing'}`);
  const out = {};
  for (const platform of PLATFORMS) {
    const commit = overrides[platform] || pinned[platform];
    if (typeof commit !== 'string' || !FULL_COMMIT.test(commit)) throw new Error(`${platform}: "${commit}" is not a full 40-character commit hash`);
    out[platform] = commit;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const commits = resolveCommits(readFileSync(join(here, 'copies.json'), 'utf8'), { android: arg('--android'), ios: arg('--ios') });
    for (const [platform, commit] of Object.entries(commits)) console.log(`${platform}=${commit}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
