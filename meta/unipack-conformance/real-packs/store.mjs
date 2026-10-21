#!/usr/bin/env node
// Brings the official store's packs into pack folders for the real-pack runners, and records each
// step per pack: the list entry, the server's answer to HEAD, whether the kept copy was reused or the
// file downloaded, and the unzip.
//
//   node meta/unipack-conformance/real-packs/store.mjs --archive <dir of <code>.zip> --work <dir>
//     [--list <store.json file or URL>] [--only <store keys>] [--offline]
//
// A copy in --archive is reused when the server reports the same size (and the same ETag, once one has
// been recorded in <archive>/heads.json); otherwise the file is downloaded into --archive first, and
// kept only when its size is what the server reported (asked for uncompressed; a compressed answer
// gives no size to compare). A HEAD with no answer is recorded as head-failed, not as a file the
// server lacks. Packs
// are unzipped into <work>/packs/<id>, id = "store_" + the list key, and the steps go to
// <work>/stages.json; a pack not unzipped in this run keeps no folder from an earlier one, and
// heads.json changes only for a copy that was reused or downloaded. --offline skips HEAD and uses the
// kept copies as they are (the stages say so).
// The packs and stages.json stay on the machine that ran this; see README.md.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import ZipEntries from 'jszip/lib/zipEntries.js';
import { ID_PATTERN, onlyIds, parseArgs } from './packs.mjs';

export const STORE_LIST_URL = 'https://unipad-e41ab.firebaseio.com/store.json';
// The play screens unwrap at most this many single top folders (Android FileManager.removeDoubleFolder).
const MAX_UNWRAP_DEPTH = 8;

export const storeId = (key) => `store_${key}`;

async function readList(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(readFileSync(source, 'utf8'));
}

/** A path part with its escapes decoded, or as written when it holds a bare `%`. */
function decodeOrKeep(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The URL with its path re-encoded, as the store's own downloader requests it. */
function requestUrl(url) {
  const u = new URL(url);
  u.pathname = u.pathname.split('/').map((part) => encodeURIComponent(decodeOrKeep(part))).join('/');
  return u.toString();
}

// Ask for the file as stored, so Content-Length counts the bytes written to the archive.
const REQUEST_HEADERS = { 'accept-encoding': 'identity' };

/** The response's content coding, or null when the body is the file as stored. */
function encodingOf(response) {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  return !encoding || encoding === 'identity' ? null : encoding;
}

/**
 * The response's Content-Length as the file's size. fetch decodes a content-coded body, so a coded
 * response's length counts other bytes than the kept file and gives no size.
 */
function fileSizeOf(response) {
  const length = response.headers.get('content-length');
  return length === null || encodingOf(response) !== null ? null : Number(length);
}

async function head(url) {
  try {
    const response = await fetch(requestUrl(url), { method: 'HEAD', redirect: 'follow', headers: REQUEST_HEADERS });
    return {
      status: response.status,
      size: fileSizeOf(response),
      encoding: encodingOf(response),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } catch (error) {
    return { status: null, error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

/**
 * Downloads `url` over `target` and returns its size. A body whose size differs from the response's
 * Content-Length or from `expectedSize` (what HEAD reported) is discarded and the kept copy stays.
 * Both are compared only when they are the size of the file as stored, not of a content-coded body.
 */
export async function download(url, target, expectedSize = null) {
  const response = await fetch(requestUrl(url), { headers: REQUEST_HEADERS });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const declared = fileSizeOf(response);
  const part = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    const size = statSync(part).size;
    if (declared !== null && size !== declared) throw new Error(`received ${size} bytes, Content-Length ${declared}`);
    if (expectedSize !== null && size !== expectedSize) throw new Error(`received ${size} bytes, HEAD reported ${expectedSize}`);
    renameSync(part, target);
    return size;
  } finally {
    rmSync(part, { force: true });
  }
}

/** Check every decoded original entry before JSZip normalizes names into its keyed file map. */
export function validateArchivePaths(bytes) {
  // JSZip's public loader has already lost overwritten entries, and exposes original names only for
  // files. Use its entry reader for this preflight so directories, Unicode names and ZIP64 follow the
  // same decoding as extraction, without maintaining a second ZIP implementation.
  const entries = new ZipEntries({ decodeFileName: (name) => Buffer.from(name).toString('utf8') });
  entries.load(bytes);
  const paths = new Set();
  for (const entry of entries.files) {
    const name = entry.fileNameStr;
    const path = entry.dir && name.endsWith('/') ? name.slice(0, -1) : name;
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\') || path.includes('\0') ||
        path.split('/').some((part) => part === '.' || part === '..') || normalize(path) !== path) {
      throw new Error('an original path is non-canonical or points outside the pack folder');
    }
    if (paths.has(path)) throw new Error('a duplicate archive path would overwrite another entry');
    paths.add(path);
  }
}

/** Unzips `zipPath` into `dir` and unwraps single top folders the way the apps' import does. */
export async function unzipPack(zipPath, dir) {
  const bytes = readFileSync(zipPath);
  validateArchivePaths(bytes);
  const zip = await JSZip.loadAsync(bytes);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let files = 0;
  for (const entry of Object.values(zip.files)) {
    const path = normalize(entry.name);
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('an entry points outside the pack folder');
    const target = join(dir, path);
    if (entry.dir) { mkdirSync(target, { recursive: true }); continue; }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await entry.async('nodebuffer'));
    files++;
  }
  let unwrapped = 0;
  while (unwrapped < MAX_UNWRAP_DEPTH) {
    const children = readdirSync(dir, { withFileTypes: true });
    const content = children.filter((d) => !d.name.startsWith('.') && d.name !== '__MACOSX');
    if (content.length !== 1 || !content[0].isDirectory()) break;
    const inner = join(dir, content[0].name);
    const moved = `${dir}.unwrap`;
    rmSync(moved, { recursive: true, force: true });
    renameSync(inner, moved);
    rmSync(dir, { recursive: true, force: true });
    renameSync(moved, dir);
    unwrapped++;
  }
  return { ok: true, files, unwrapped };
}

/** Whether the kept copy is the file the server serves now. */
export function sameAsServer(copySize, recorded, served) {
  if (served.status !== 200 || served.size === null || copySize !== served.size) return false;
  return !recorded?.etag || !served.etag || recorded.etag === served.etag;
}

const READABLE = ['reused', 'downloaded', 'reused-unchecked'];
const PLATFORMS = ['android', 'ios', 'web'];

/**
 * One list entry through every step. `heads` (the archive's record of what the server served) is
 * updated only when the kept copy is that file: reused, or downloaded just now. The pack folder of an
 * earlier run is removed first, so a pack not unzipped this time leaves nothing for the runners to read;
 * its earlier results are always removed too. Reusing an archive does not establish that earlier
 * results for this list id came from that archive, so every prepared input needs fresh parser results.
 */
export async function bringPack(options) {
  const record = await bringPackFolder(options);
  if (record.copy.action !== 'invalid-key') {
    for (const platform of PLATFORMS) rmSync(join(options.work, 'results', platform, `${record.id}.json`), { force: true });
  }
  return record;
}

async function bringPackFolder({ key, item, archive, work, heads, offline = false, net = { head, download } }) {
  const id = storeId(key);
  const url = item?.URL ?? item?.url ?? null;
  const code = item?.code ?? null;
  const record = { id, key, code, url, head: null, copy: null, unzip: null };
  // The key and the code become paths under --work and --archive: one plain name each, never a path.
  if (!ID_PATTERN.test(id)) { record.copy = { action: 'invalid-key' }; return record; }
  const packDir = join(work, 'packs', id);
  rmSync(packDir, { recursive: true, force: true });
  if (!url || !code) { record.copy = { action: 'no-url' }; return record; }
  if (!ID_PATTERN.test(code)) { record.copy = { action: 'invalid-code' }; return record; }

  const zipPath = join(archive, `${code}.zip`);
  const copySize = existsSync(zipPath) ? statSync(zipPath).size : null;
  if (offline) {
    record.copy = copySize === null ? { action: 'missing' } : { action: 'reused-unchecked', size: copySize };
  } else {
    record.head = await net.head(url);
    if (record.head.status === null) {
      record.copy = { action: 'head-failed' };
    } else if (record.head.status !== 200) {
      record.copy = { action: 'not-served' };
    } else if (copySize !== null && sameAsServer(copySize, heads[code], record.head)) {
      record.copy = { action: 'reused', size: copySize };
    } else {
      try {
        record.copy = { action: 'downloaded', size: await net.download(url, zipPath, record.head.size), previousSize: copySize };
      } catch (error) {
        record.copy = { action: 'download-failed', error: String(error?.message ?? error) };
      }
    }
    if (record.copy.action === 'reused' || record.copy.action === 'downloaded') {
      heads[code] = { size: record.copy.size, etag: record.head.etag, lastModified: record.head.lastModified, checkedAt: new Date().toISOString() };
    }
  }
  if (!READABLE.includes(record.copy.action)) return record;
  try {
    record.unzip = await unzipPack(zipPath, packDir);
  } catch (error) {
    rmSync(packDir, { recursive: true, force: true });
    record.unzip = { ok: false, error: String(error?.message ?? error) };
  }
  return record;
}

/**
 * Brings every listed pack (or the `only` keys) and writes <archive>/heads.json (unless offline) and
 * <work>/stages.json. Returns what stages.json holds.
 */
export async function bringStore({ listSource, archive, work, only = null, offline = false, net, log = () => {} }) {
  const list = await readList(listSource);
  const unknown = (only ?? []).filter((k) => !Object.hasOwn(list, k));
  if (unknown.length > 0) throw new Error(`not in the store list: ${unknown.join(', ')}`);
  const keys = Object.keys(list).filter((k) => !only || only.includes(k));
  const headsPath = join(archive, 'heads.json');
  const heads = existsSync(headsPath) ? JSON.parse(readFileSync(headsPath, 'utf8')) : {};
  mkdirSync(archive, { recursive: true });
  mkdirSync(join(work, 'packs'), { recursive: true });

  const packs = [];
  for (const key of keys) {
    const record = await bringPack({ key, item: list[key], archive, work, heads, offline, ...(net ? { net } : {}) });
    packs.push(record);
    const unzip = record.unzip === null ? 'not unzipped' : record.unzip.ok ? 'unzipped' : `unzip failed: ${record.unzip.error}`;
    log(`${record.id} ${record.head?.status ?? '-'} ${record.copy.action} ${unzip}`);
  }

  if (!offline) writeFileSync(headsPath, `${JSON.stringify(heads, null, 2)}\n`);
  const count = (pred) => packs.filter(pred).length;
  const summary = {
    listed: packs.length,
    served: count((p) => p.head?.status === 200),
    // Asked but not answered (a connection error): not evidence that the server lacks the file.
    headFailed: count((p) => p.copy?.action === 'head-failed'),
    notServed: count((p) => ['not-served', 'no-url', 'invalid-code', 'invalid-key'].includes(p.copy?.action)),
    reused: count((p) => p.copy?.action === 'reused' || p.copy?.action === 'reused-unchecked'),
    downloaded: count((p) => p.copy?.action === 'downloaded'),
    downloadFailed: count((p) => p.copy?.action === 'download-failed'),
    downloadedBytes: packs.reduce((n, p) => n + (p.copy?.action === 'downloaded' ? p.copy.size : 0), 0),
    unzipped: count((p) => p.unzip?.ok === true),
    unzipFailed: count((p) => p.unzip?.ok === false),
  };
  const stages = { generatedAt: new Date().toISOString(), list: listSource, offline, summary, packs };
  writeFileSync(join(work, 'stages.json'), `${JSON.stringify(stages, null, 2)}\n`);
  return stages;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.archive !== 'string' || typeof args.work !== 'string') {
    throw new Error('usage: store.mjs --archive <dir> --work <dir> [--list <file|url>] [--only <keys>] [--offline]');
  }
  const { summary } = await bringStore({
    listSource: typeof args.list === 'string' ? args.list : STORE_LIST_URL,
    archive: args.archive,
    work: args.work,
    only: onlyIds(args),
    offline: args.offline === true,
    log: console.log,
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
