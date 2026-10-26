#!/usr/bin/env node
// Copies external pack folders for the three real-pack runners. Optional empty sound files allow
// text-only collections to exercise keySound parsing, without adding packs or audio to the repository.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { folderFingerprint, listPacks, onlyIds, packEntries, parseArgs } from './packs.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.packs !== 'string' || typeof args.work !== 'string' ||
    ['empty-sounds', 'anonymous-ids'].some((flag) => args[flag] !== undefined && args[flag] !== true)) {
  throw new Error('usage: prepare.mjs --packs <source> --work <work> [--empty-sounds] [--anonymous-ids] [--only <ids> | --only-file <file>]');
}
// Resolve disk spelling and existing ancestors, so case aliases and symlinks cannot hide an overlap.
function realPath(path) {
  if (existsSync(path)) return realpathSync.native(path);
  return join(realPath(dirname(path)), basename(path));
}
const source = realpathSync.native(args.packs);
const work = realPath(resolve(args.work));
const within = (a, b) => a === b || a.startsWith(`${b}${sep}`);
if (within(work, source) || within(source, work)) throw new Error('source and work must not overlap');

const records = [];
for (const { id: sourceId, path } of listPacks(source, onlyIds(args))) {
  const id = args['anonymous-ids'] ? `pack_${createHash('sha256').update(sourceId).digest('hex')}` : sourceId;
  const entries = packEntries(path);
  const target = join(work, 'packs', id);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const entry of entries) {
    const dest = join(target, entry.path);
    mkdirSync(entry.directory ? dest : dirname(dest), { recursive: true });
    if (!entry.directory) writeFileSync(dest, readFileSync(entry.full));
  }
  const emptySounds = { created: 0, existing: 0, unsafeReferences: 0 };
  if (args['empty-sounds']) {
    const keySound = entries.find((e) => !e.directory && e.path.toLowerCase() === 'keysound');
    const soundsName = entries.map((e) => e.path.split('/')[0]).find((n) => n.toLowerCase() === 'sounds') ?? 'sounds';
    const known = new Set(entries.filter((e) => !e.directory).map((e) => e.path.toLowerCase()));
    const text = keySound ? readFileSync(keySound.full, 'utf8') : '';
    for (const line of text.split(/\r\n|\r|\n/)) {
      const name = line.trim().split(/\s+/)[3];
      if (!name) continue;
      // A reference may name a nested sound, but must never escape the sounds folder.
      if (name.includes('\\') || name.split('/').some((p) => p === '' || p === '.' || p === '..')) {
        emptySounds.unsafeReferences++;
        continue;
      }
      const relative = `${soundsName}/${name}`;
      if (known.has(relative.toLowerCase())) { emptySounds.existing++; continue; }
      const dest = join(target, relative);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.alloc(0));
      known.add(relative.toLowerCase());
      emptySounds.created++;
    }
  }
  // The copied input may have changed: do not let comparison reuse results from an earlier run.
  for (const platform of ['android', 'ios', 'web']) rmSync(join(work, 'results', platform, `${id}.json`), { force: true });
  records.push({ id, sourceFingerprint: folderFingerprint(path, entries), fingerprint: folderFingerprint(target), emptySounds });
  console.log(`${id} prepared ${emptySounds.created}`);
}
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'prepared.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), emptySounds: args['empty-sounds'] === true, anonymousIds: args['anonymous-ids'] === true, packs: records }, null, 2)}\n`);
