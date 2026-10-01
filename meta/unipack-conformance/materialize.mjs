#!/usr/bin/env node
// Writes one case's pack to a folder or a .zip, for opening it by hand on a device or emulator.
//   node meta/unipack-conformance/materialize.mjs <caseId> --out <dir> [--zip]
// Uses jszip from the unipad.io dependencies, so run `pnpm install` first for --zip.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { loadCanonical } from './report.mjs';
import { fileBytes } from './lib.mjs';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : undefined;
if (!id || !out) {
  console.error('usage: materialize.mjs <caseId> --out <dir> [--zip]');
  process.exit(2);
}

const { corpus } = loadCanonical();
const c = corpus.cases.find((x) => x.id === id);
if (!c) {
  console.error(`no case ${id}`);
  process.exit(2);
}

if (args.includes('--zip')) {
  const zip = new JSZip();
  for (const file of c.files) zip.file(file.path, fileBytes(file, corpus.assets));
  const target = join(out, `${id}.zip`);
  mkdirSync(out, { recursive: true });
  writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer' }));
  console.log(target);
} else {
  for (const file of c.files) {
    const target = join(out, id, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fileBytes(file, corpus.assets));
  }
  console.log(join(out, id));
}
