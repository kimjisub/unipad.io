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

/** Every file under `root` as `{ path, full }`, `path` relative with forward slashes. */
export function packFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ path: relative(root, full).split(sep).join('/'), full });
    }
  };
  walk(root);
  return out;
}

/** The corpus input fingerprint (lib.mjs) of a pack folder: the same formula a case's files hash with. */
export function folderFingerprint(root) {
  return fingerprintOf(packFiles(root), (f) => readFileSync(f.full));
}

/** The file at the pack root whose name matches `name` regardless of case, as the parsers look it up. */
function rootFile(root, name) {
  const found = readdirSync(root, { withFileTypes: true }).find((d) => d.name.toLowerCase() === name.toLowerCase());
  return found ? join(root, found.name) : null;
}

const countLines = (text) => text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').length;

/**
 * What a pack holds before any parser reads it, counted the same way for every platform: non-blank
 * keySound and autoPlay lines, files in the keyLED folder, files in the sounds folder, total bytes.
 */
export function describePack(root) {
  const files = packFiles(root);
  const keySound = rootFile(root, 'keySound');
  const autoPlay = rootFile(root, 'autoPlay');
  const keyLed = rootFile(root, 'keyLED');
  const sounds = rootFile(root, 'sounds');
  const under = (dir) => (dir && statSync(dir).isDirectory() ? packFiles(dir).length : 0);
  return {
    files: files.length,
    bytes: files.reduce((n, f) => n + statSync(f.full).size, 0),
    keySoundLines: keySound && statSync(keySound).isFile() ? countLines(readFileSync(keySound, 'utf8')) : null,
    autoPlayLines: autoPlay && statSync(autoPlay).isFile() ? countLines(readFileSync(autoPlay, 'utf8')) : null,
    keyLedFiles: under(keyLed),
    soundFiles: under(sounds),
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
