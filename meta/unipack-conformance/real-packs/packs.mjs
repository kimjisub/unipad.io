// Pack folders on disk, as the real-pack runners read them: one folder per pack under a packs
// directory, named by an id that carries no title. See README.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fingerprintOf } from '../lib.mjs';

/** An id is a folder name the tools can pass around safely: no path separators, no leading dot or dash. */
export const ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** The pack folders under `dir`, sorted by id; `only` (a list of ids) keeps those and refuses unknown ones. */
export function listPacks(dir, only = null) {
  const all = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ID_PATTERN.test(d.name))
    .map((d) => ({ id: d.name, path: join(dir, d.name) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!only) return all;
  const wanted = new Set(only);
  const missing = [...wanted].filter((id) => !all.some((p) => p.id === id));
  if (missing.length > 0) throw new Error(`no pack folder for ${missing.join(', ')} in ${dir}`);
  return all.filter((p) => wanted.has(p.id));
}

/** Files and empty directories, with relative forward-slash paths and a trailing slash for directories. */
export function packEntries(root) {
  const out = [];
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0 && dir !== root) {
      out.push({ path: `${relative(root, dir).split(sep).join('/')}/`, full: dir, directory: true });
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ path: relative(root, full).split(sep).join('/'), full });
    }
  };
  walk(root);
  return out;
}

/**
 * The corpus formula over files plus empty directory paths with zero bytes. `entries` is
 * `packEntries(root)`, passed in when the caller has already walked the folder.
 */
export function folderFingerprint(root, entries = packEntries(root)) {
  return fingerprintOf(entries, (entry) => entry.directory ? Buffer.alloc(0) : readFileSync(entry.full));
}

/**
 * The name at the pack root, as listed in `entries`, that matches `name` regardless of case, as the
 * parsers look it up; null when there is none.
 */
function rootName(entries, name) {
  const wanted = name.toLowerCase();
  return entries.map((e) => e.path.split('/')[0]).find((top) => top.toLowerCase() === wanted) ?? null;
}

const countLines = (text) => text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').length;

/**
 * What a pack holds before any parser reads it, counted the same way for every platform: non-blank
 * keySound and autoPlay lines, files in the keyLED folder, files in the sounds folder, total bytes.
 * Everything is counted from `entries` (`packEntries(root)`), so the folder is walked once.
 */
export function describePack(root, entries = packEntries(root)) {
  const files = entries.filter((entry) => !entry.directory);
  const lines = (name) => {
    const top = rootName(entries, name);
    const file = files.find((f) => f.path === top);
    return file ? countLines(readFileSync(file.full, 'utf8')) : null;
  };
  const under = (name) => {
    const top = rootName(entries, name);
    return top === null ? 0 : files.filter((f) => f.path.startsWith(`${top}/`)).length;
  };
  return {
    files: files.length,
    bytes: files.reduce((n, f) => n + statSync(f.full).size, 0),
    keySoundLines: lines('keySound'),
    autoPlayLines: lines('autoPlay'),
    keyLedFiles: under('keyLED'),
    soundFiles: under('sounds'),
  };
}

/** `--name value` pairs of a command line; a flag without a value is `true`. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!name.startsWith('--')) throw new Error(`unexpected argument ${name}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[name.slice(2)] = true;
    else { args[name.slice(2)] = next; i++; }
  }
  return args;
}

/** `--only a,b` or `--only-file <file with one id per line>`; null for every pack. */
export function onlyIds(args) {
  if (typeof args.only === 'string') return args.only.split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof args['only-file'] === 'string') return readFileSync(args['only-file'], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return null;
}
