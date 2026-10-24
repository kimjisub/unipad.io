#!/usr/bin/env node
// Copies corpus.json and corpus.sha256 into the app checkouts, or checks that the copies are byte-identical.
//   node meta/unipack-conformance/sync.mjs --android <unipad-android checkout> --ios <unipad-ios checkout> [--check [--require-current]]
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolvePins } from './copies.mjs';

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

const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashLine = (hash) => `${hash}  corpus.json\n`;

/** Verify local copies against canonical bytes; explicit commits can select their declared historical corpus. */
export function checkCopies(checkouts, { sourceDir = here, pins = {}, commits = {}, requireCurrent = false } = {}) {
  const errors = [], warnings = [];
  let bytes, currentHash, edition;
  try {
    bytes = readFileSync(join(sourceDir, 'corpus.json'));
    currentHash = hashOf(bytes);
    if (readFileSync(join(sourceDir, 'corpus.sha256'), 'utf8') !== hashLine(currentHash)) throw new Error('corpus.sha256 does not match corpus.json bytes');
    edition = JSON.parse(bytes).grammar;
  } catch (error) { return { errors: [`canonical: ${error.message}`], warnings }; }
  let entries;
  try { entries = resolvePins(JSON.stringify(pins)); }
  catch (error) { return { errors: [error.message], warnings }; }
  for (const [platform, root] of Object.entries(checkouts)) {
    const pin = entries[platform];
    if (!pin) { errors.push(`unknown platform: ${platform}`); continue; }
    const selected = commits[platform];
    if (selected !== undefined && !/^[0-9a-f]{40}$/.test(selected)) { errors.push(`${platform}: invalid selected commit`); continue; }
    // Local copies and an explicitly selected different commit must match the current corpus.
    const expectedHash = selected === pin.commit && pin.corpusSha256 ? pin.corpusSha256 : currentHash;
    const dir = join(resolve(root), COPY_DIRS[platform]);
    try {
      const actual = readFileSync(join(dir, 'corpus.json'));
      const actualHash = hashOf(actual);
      if (actualHash !== expectedHash) throw new Error(`corpus.json SHA-256 ${actualHash} differs from declared ${expectedHash}`);
      if (readFileSync(join(dir, 'corpus.sha256'), 'utf8') !== hashLine(actualHash)) throw new Error('corpus.sha256 does not match corpus.json bytes');
      if (expectedHash === currentHash) {
        if (!actual.equals(bytes)) throw new Error('corpus.json bytes differ from canonical');
      } else {
        const oldEdition = JSON.parse(actual).grammar;
        const message = `${platform}: behind canonical (${oldEdition} ${actualHash}; canonical ${edition} ${currentHash}); app results remain unverified`;
        warnings.push(message);
        if (requireCurrent) errors.push(message);
      }
    } catch (error) { errors.push(`${platform}: ${error.message}`); }
  }
  return { errors, warnings };
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
    try {
      const pins = JSON.parse(readFileSync(arg('--pins') ?? join(here, 'copies.json'), 'utf8'));
      const result = checkCopies(checkouts, { pins, requireCurrent: args.includes('--require-current'), commits: { android: arg('--android-commit'), ios: arg('--ios-commit') } });
      for (const warning of result.warnings) console.log(`::warning::${warning}`);
      for (const error of result.errors) console.error(error);
      if (result.errors.length) process.exit(1);
      console.log(result.warnings.length ? 'declared app copy bytes verified; copies behind canonical are not current compatibility evidence' : `copies are identical to the canonical ${COPIED_FILES.join(' and ')}`);
    } catch (error) { console.error(error.message); process.exit(1); }
  } else {
    for (const [platform, root] of Object.entries(checkouts)) {
      const dir = join(resolve(root), COPY_DIRS[platform]);
      mkdirSync(dir, { recursive: true });
      for (const name of COPIED_FILES) copyFileSync(join(here, name), join(dir, name));
      console.log(`${platform}: wrote ${COPIED_FILES.join(' and ')} in ${dir}`);
    }
  }
}
