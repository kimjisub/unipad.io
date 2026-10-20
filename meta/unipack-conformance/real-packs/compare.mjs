#!/usr/bin/env node
// Compares the three platforms' normalized parse results of the same real packs.
//
//   node meta/unipack-conformance/real-packs/compare.mjs --results <dir> [--packs <dir>] [--stages <stages.json>]
//     [--only <ids> | --only-file <file>] [--json <out.json>]
//
// --results holds android/, ios/ and web/ as the runners write them. Each pack is "same" when the three
// results are identical, "different" (naming the parts that differ) when all three read it but
// disagree, and "failed" when a platform has no usable result or its runner threw. With --stages every
// pack of that run is a row, and one it did not unzip is "not-read" (its step says why). The printed
// table and the JSON carry the pack id, its fingerprint and counts only: no title, producer or file
// content.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { describePack, folderFingerprint, listPacks, onlyIds, packEntries, parseArgs } from './packs.mjs';

export const PLATFORMS = ['android', 'ios', 'web'];
/** The parts of a normalized parse result compared one by one, in the order they are reported. */
export const PARTS = ['loaded', 'info', 'keySound', 'keyLed', 'autoPlay', 'errors'];

const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex').slice(0, 16);

/** The value with object keys sorted, so the same result always serializes the same way. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

/** A normalized parse result split into the compared parts. */
export function partsOf(actual) {
  if (!actual.loaded) return { loaded: false, info: null, keySound: null, keyLed: null, autoPlay: null, errors: null };
  return {
    loaded: true,
    info: actual.info,
    keySound: actual.sounds,
    keyLed: { exists: actual.keyLedExist, leds: actual.leds },
    autoPlay: actual.autoPlay,
    errors: actual.errors,
  };
}

const countBy = (items) => items.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

/**
 * The counts reported for one platform's reading of a pack. Title, producer and website are reduced to
 * a short hash, so the summary can be shared without naming the pack.
 */
export function summarize(actual) {
  if (!actual.loaded) return { loaded: false };
  const { info } = actual;
  const sum = (cells) => cells.reduce((n, cell) => n + cell.queue.length, 0);
  return {
    loaded: true,
    info: {
      titleHash: digest(info.title).slice(0, 8),
      producerHash: digest(info.producerName).slice(0, 8),
      websiteHash: info.website === undefined ? null : digest(info.website).slice(0, 8),
      buttonX: info.buttonX, buttonY: info.buttonY, chain: info.chain, squareButton: info.squareButton,
    },
    keySoundEntries: sum(actual.sounds),
    keySoundCells: actual.sounds.length,
    keyLedExist: actual.keyLedExist,
    keyLedFiles: sum(actual.leds),
    keyLedEvents: actual.leds.reduce((n, cell) => n + cell.queue.reduce((m, a) => m + a.events.length, 0), 0),
    autoPlayCommands: actual.autoPlay === null ? null : actual.autoPlay.length,
    autoPlayByKind: actual.autoPlay === null ? null : countBy(actual.autoPlay.map((e) => e[0])),
    errors: countBy(actual.errors),
    digests: Object.fromEntries(Object.entries(partsOf(actual)).map(([k, v]) => [k, digest(v)])),
  };
}

function readResult(resultsDir, platform, id) {
  const path = join(resultsDir, platform, `${id}.json`);
  if (!existsSync(path)) return { error: 'no result' };
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { error: `unreadable result: ${error.message}` };
  }
  if (!isObject(record)) return { error: 'the result is not an object' };
  if (record.platform !== platform || record.id !== id) return { error: `the file says ${record.platform}/${record.id}` };
  if (record.error !== undefined) {
    return { error: typeof record.error === 'string' ? record.error.split('\n')[0] : `the runner failed with error ${JSON.stringify(record.error)}` };
  }
  return isObject(record.actual) ? { actual: record.actual } : { error: 'the result has no actual' };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The verdict for one pack from the three results: same, different (with the parts) or failed. */
export function verdictOf(results) {
  const failed = PLATFORMS.filter((p) => results[p].error !== undefined);
  if (failed.length > 0) return { verdict: 'failed', failed: Object.fromEntries(failed.map((p) => [p, results[p].error])) };
  const parts = Object.fromEntries(PLATFORMS.map((p) => [p, partsOf(results[p].actual)]));
  const differing = PARTS.filter((part) => !PLATFORMS.every((p) => isDeepStrictEqual(parts[p][part], parts.android[part])));
  if (differing.length === 0) return { verdict: 'same', differing: [] };
  // Which platform stands apart in each differing part, when two of the three agree.
  const odd = Object.fromEntries(differing.map((part) => {
    const lone = PLATFORMS.find((p) => {
      const others = PLATFORMS.filter((o) => o !== p);
      return isDeepStrictEqual(parts[others[0]][part], parts[others[1]][part]) && !isDeepStrictEqual(parts[p][part], parts[others[0]][part]);
    });
    return [part, lone ?? 'all-three'];
  }));
  return { verdict: 'different', differing, odd };
}

export function comparePacks({ resultsDir, ids, packsDir = null, stages = null }) {
  return ids.map((id) => {
    const stage = stages?.packs.find((p) => p.id === id);
    const stageRow = stage ? { head: stage.head?.status ?? null, copy: stage.copy?.action ?? null, unzip: stage.unzip?.ok ?? null } : null;
    // A pack the stages say was not unzipped in this run is not read, whatever results an earlier run left.
    if (stages && stage?.unzip?.ok !== true) return { id, verdict: 'not-read', stages: stageRow };
    const results = Object.fromEntries(PLATFORMS.map((p) => [p, readResult(resultsDir, p, id)]));
    const row = { id, ...verdictOf(results) };
    if (packsDir) {
      const root = join(packsDir, id);
      const entries = packEntries(root);
      row.fingerprint = folderFingerprint(root, entries);
      row.pack = describePack(root, entries);
    }
    if (stageRow) row.stages = stageRow;
    row.summary = Object.fromEntries(PLATFORMS.map((p) => [p, results[p].actual ? summarize(results[p].actual) : null]));
    return row;
  });
}

function idsIn(resultsDir) {
  const ids = new Set();
  for (const p of PLATFORMS) {
    const dir = join(resultsDir, p);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.json')) ids.add(f.slice(0, -5));
  }
  return [...ids].sort();
}

/** The ids to compare: the run's packs with `stages`, else the pack folders, else what has results. */
export function idsToCompare({ resultsDir, only = null, packsDir = null, stages = null }) {
  if (stages) {
    const all = stages.packs.map((p) => p.id);
    const unknown = (only ?? []).filter((id) => !all.includes(id));
    if (unknown.length > 0) throw new Error(`not in the stages: ${unknown.join(', ')}`);
    return only ? all.filter((id) => only.includes(id)) : all;
  }
  return packsDir ? listPacks(packsDir, only).map((p) => p.id) : (only ?? idsIn(resultsDir));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.results !== 'string') throw new Error('usage: compare.mjs --results <dir> [--packs <dir>] [--stages <file>] [--only <ids>] [--json <file>]');
  const packsDir = typeof args.packs === 'string' ? args.packs : null;
  const stages = typeof args.stages === 'string' ? JSON.parse(readFileSync(args.stages, 'utf8')) : null;
  const ids = idsToCompare({ resultsDir: args.results, only: onlyIds(args), packsDir, stages });
  const rows = comparePacks({ resultsDir: args.results, ids, packsDir, stages });

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const totals = { packs: rows.length, same: count('same'), different: count('different'), failed: count('failed'), notRead: count('not-read') };
  const byParts = countBy(rows.filter((r) => r.verdict === 'different').map((r) => r.differing.map((part) => `${part}:${r.odd[part]}`).join(' ')));
  for (const r of rows) {
    const detail = r.verdict === 'different' ? r.differing.map((part) => `${part}(${r.odd[part]})`).join(' ')
      : r.verdict === 'failed' ? Object.keys(r.failed).join(' ')
        : r.verdict === 'not-read' ? (r.stages?.copy ?? '') : '';
    console.log(`${r.id}\t${r.verdict}\t${detail}`);
  }
  console.log(JSON.stringify({ totals, byParts }));
  if (typeof args.json === 'string') writeFileSync(args.json, `${JSON.stringify({ generatedAt: new Date().toISOString(), totals, byParts, packs: rows }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
