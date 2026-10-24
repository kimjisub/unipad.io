#!/usr/bin/env node
// Names the exact unipad-android and unipad-ios commits whose corpus copies CI compares with this directory.
//   node meta/unipack-conformance/copies.mjs [--android <commit>] [--ios <commit>]
// Prints `android=<commit>` and `ios=<commit>`. A given commit replaces the one in copies.json; an empty or
// absent one keeps it. Anything other than a full 40-character commit hash (a branch, a tag, a short hash)
// is refused, so a comparison never runs against a moving target.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const PLATFORMS = ['android', 'ios'];
const FULL_HASH = /^[0-9a-f]{64}$/;

/** Validate immutable app pins; an explicit corpus hash describes a historical copy. */
export function resolvePins(text) {
  const pinned = JSON.parse(text);
  if (typeof pinned !== 'object' || pinned === null || Array.isArray(pinned)) throw new Error('copies.json must be an object');
  if (Object.keys(pinned).sort().join() !== [...PLATFORMS].sort().join()) throw new Error(`copies.json must name exactly ${PLATFORMS.join(' and ')}`);
  const out = {};
  for (const platform of PLATFORMS) {
    const entry = pinned[platform];
    if (typeof entry === 'string') {
      if (!FULL_COMMIT.test(entry)) throw new Error(`${platform}: "${entry}" is not a full 40-character commit hash`);
      out[platform] = { commit: entry };
    } else {
      if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join() !== 'commit,corpusSha256') throw new Error(`${platform}: historical pin must contain exactly commit and corpusSha256`);
      if (typeof entry.commit !== 'string' || !FULL_COMMIT.test(entry.commit)) throw new Error(`${platform}: invalid full 40-character commit hash`);
      if (typeof entry.corpusSha256 !== 'string' || !FULL_HASH.test(entry.corpusSha256)) throw new Error(`${platform}: invalid corpus SHA-256`);
      out[platform] = { ...entry };
    }
  }
  return out;
}

/** Overrides select a commit but never silently change a historical corpus pin. */
export function resolveCommits(text, overrides = {}) {
  const pinned = resolvePins(text);
  const out = {};
  for (const platform of PLATFORMS) {
    const commit = overrides[platform] || pinned[platform].commit;
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
