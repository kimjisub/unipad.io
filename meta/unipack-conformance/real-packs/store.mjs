#!/usr/bin/env node
// Brings the official store's packs into pack folders for the real-pack runners, and records each
// step per pack: the list entry, the server's answer to HEAD, whether the kept copy was reused or the
// file downloaded, and the unzip.
//
//   node meta/unipack-conformance/real-packs/store.mjs --archive <dir of <code>.zip> --work <dir>
//     [--list <store.json file or URL>] [--only <store keys>] [--offline]
//
// A copy in --archive is reused when the server reports the same size (and the same ETag, once one has
// been recorded in <archive>/heads.json); otherwise the file is downloaded into --archive first. Packs
// are unzipped into <work>/packs/<id>, id = "store_" + the list key, and the steps go to
// <work>/stages.json. --offline skips HEAD and uses the kept copies as they are (the stages say so).
// The packs and stages.json stay on the machine that ran this; see README.md.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { onlyIds, parseArgs } from './packs.mjs';

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

/** The URL with its path re-encoded, as the store's own downloader requests it. */
function requestUrl(url) {
  const u = new URL(url);
  u.pathname = u.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  return u.toString();
}

async function head(url) {
  try {
    const response = await fetch(requestUrl(url), { method: 'HEAD', redirect: 'follow' });
    const size = response.headers.get('content-length');
    return {
      status: response.status,
      size: size === null ? null : Number(size),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } catch (error) {
    return { status: null, error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

async function download(url, target) {
  const response = await fetch(requestUrl(url));
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const part = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  renameSync(part, target);
  return statSync(target).size;
}

/** Unzips `zipPath` into `dir` and unwraps single top folders the way the apps' import does. */
export async function unzipPack(zipPath, dir) {
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.archive !== 'string' || typeof args.work !== 'string') {
    throw new Error('usage: store.mjs --archive <dir> --work <dir> [--list <file|url>] [--only <keys>] [--offline]');
  }
  const listSource = typeof args.list === 'string' ? args.list : STORE_LIST_URL;
  const list = await readList(listSource);
  const only = onlyIds(args);
  const keys = Object.keys(list).filter((k) => !only || only.includes(k));
  const headsPath = join(args.archive, 'heads.json');
  const heads = existsSync(headsPath) ? JSON.parse(readFileSync(headsPath, 'utf8')) : {};
  mkdirSync(join(args.work, 'packs'), { recursive: true });

  const packs = [];
  for (const key of keys) {
    const item = list[key];
    const id = storeId(key);
    const url = item.URL ?? item.url ?? null;
    const record = { id, key, code: item.code ?? null, url, head: null, copy: null, unzip: null };
    packs.push(record);
    if (!url || !item.code) { record.copy = { action: 'no-url' }; continue; }

    const zipPath = join(args.archive, `${item.code}.zip`);
    const copySize = existsSync(zipPath) ? statSync(zipPath).size : null;
    if (args.offline) {
      record.copy = copySize === null ? { action: 'missing' } : { action: 'reused-unchecked', size: copySize };
    } else {
      record.head = await head(url);
      if (record.head.status !== 200) {
        record.copy = { action: 'not-served' };
      } else if (copySize !== null && sameAsServer(copySize, heads[item.code], record.head)) {
        record.copy = { action: 'reused', size: copySize };
      } else {
        try {
          record.copy = { action: 'downloaded', size: await download(url, zipPath), previousSize: copySize };
        } catch (error) {
          record.copy = { action: 'download-failed', error: String(error?.message ?? error) };
        }
      }
      if (record.head.status === 200) heads[item.code] = { size: record.head.size, etag: record.head.etag, lastModified: record.head.lastModified, checkedAt: new Date().toISOString() };
    }
    if (!['reused', 'downloaded', 'reused-unchecked'].includes(record.copy.action)) continue;
    try {
      record.unzip = await unzipPack(zipPath, join(args.work, 'packs', id));
    } catch (error) {
      rmSync(join(args.work, 'packs', id), { recursive: true, force: true });
      record.unzip = { ok: false, error: String(error?.message ?? error) };
    }
    console.log(`${id} ${record.head?.status ?? '-'} ${record.copy.action} ${record.unzip.ok ? 'unzipped' : `unzip failed: ${record.unzip.error}`}`);
  }

  if (!args.offline) writeFileSync(headsPath, `${JSON.stringify(heads, null, 2)}\n`);
  const count = (pred) => packs.filter(pred).length;
  const summary = {
    listed: packs.length,
    served: count((p) => p.head?.status === 200),
    notServed: count((p) => p.copy?.action === 'not-served' || p.copy?.action === 'no-url'),
    reused: count((p) => p.copy?.action === 'reused' || p.copy?.action === 'reused-unchecked'),
    downloaded: count((p) => p.copy?.action === 'downloaded'),
    downloadedBytes: packs.reduce((n, p) => n + (p.copy?.action === 'downloaded' ? p.copy.size : 0), 0),
    unzipped: count((p) => p.unzip?.ok === true),
    unzipFailed: count((p) => p.unzip?.ok === false),
  };
  const stages = { generatedAt: new Date().toISOString(), list: listSource, offline: args.offline === true, summary, packs };
  writeFileSync(join(args.work, 'stages.json'), `${JSON.stringify(stages, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
