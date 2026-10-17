#!/usr/bin/env node
// Reads each pack folder with the web player's real parser and writes the normalized parse result the
// conformance harness gives for a case (src/lib/unipack/conformanceHarness.ts, parseResult).
//
//   node --import tsx meta/unipack-conformance/real-packs/run-web.mjs --packs <dir> --out <dir>
//     [--only <ids> | --only-file <file>]
//
// The folder is zipped in memory, as the web player receives a pack. Writes <out>/web/<id>.json and
// <out>/web.run.json; the output format is in README.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { parseOrRefuse, parseResult } from '../../../src/lib/unipack/conformanceHarness.ts';
import { listPacks, onlyIds, packFiles, parseArgs } from './packs.mjs';

const PLATFORM = 'web';

async function zipFolder(root) {
  const zip = new JSZip();
  for (const file of packFiles(root)) zip.file(file.path, readFileSync(file.full));
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function resultOf(root) {
  try {
    const parsed = await parseOrRefuse(await zipFolder(root));
    return { actual: 'pack' in parsed ? parseResult(parsed.pack) : { loaded: false } };
  } catch (error) {
    return { error: String(error?.stack ?? error) };
  }
}

const args = parseArgs(process.argv.slice(2));
if (typeof args.packs !== 'string' || typeof args.out !== 'string') {
  throw new Error('usage: run-web.mjs --packs <dir> --out <dir> [--only <ids> | --only-file <file>]');
}
const dir = join(args.out, PLATFORM);
mkdirSync(dir, { recursive: true });
const packs = listPacks(args.packs, onlyIds(args));
for (const { id, path } of packs) {
  const result = await resultOf(path);
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({ platform: PLATFORM, id, ...result })}\n`);
  console.log(`${id} ${result.error ? 'error' : 'ok'}`);
}
writeFileSync(join(args.out, `${PLATFORM}.run.json`), `${JSON.stringify({ platform: PLATFORM, generatedAt: new Date().toISOString(), packs: packs.map((p) => p.id) }, null, 2)}\n`);
