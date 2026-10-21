import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammarRecord } from '../meta/unipack-conformance/grammar.mjs';

// The edition GRAMMAR.md names and that file's SHA-256: what the conformance report compares a result to.
export { grammarRecord };

export const parserTests = {
  'F-05': ['F-05 opens a complete pack wrapped in a top folder',
    'F-05 opens a unique pack through nested folders and ignores archive sidecars'],
  'F-06': ['F-06 reads a CP949 file name inside the archive that has no UTF-8 mark',
    'F-06 reads an unmarked file name that is valid UTF-8 as UTF-8',
    'F-06 reads a file name explicitly marked as UTF-8'],
};
export const audioTests = Object.fromEntries([
  ['A-01', 'WAV PCM'], ['A-02', 'MP3'], ['A-03', 'OGG Vorbis'],
  ['A-04', 'M4A AAC'], ['A-05', 'MP3 named .wav'],
].map(([item, format]) => [item, [`${item} ${format} decodes and plays its own buffer with an output signal`]]));

// Every mapped test must run exactly once, pass without retries, and have known provenance.
export function verdict(names, records, exitCode, environmentKnown) {
  if (exitCode !== 0 || !environmentKnown) return 'unconfirmed';
  return names.every(name => {
    const matches = records.filter(record => record.name === name);
    return matches.length === 1 && matches[0].status === 'passed';
  }) ? 'confirmed' : 'unconfirmed';
}

function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) throw new Error('Usage: node scripts/grammar-results.mjs <new-output-directory>');
  // A new directory is required so a later run cannot overwrite previous evidence.
  const output = resolve(directory);
  mkdirSync(output, { recursive: false });
  const git = (...args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const diff = git('diff', 'HEAD', '--binary');
  const source = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '',
    trackedDiffSha256: hash(diff) };
  writeFileSync(resolve(output, 'source.patch'), diff);
  writeFileSync(resolve(output, 'source-status.txt'), git('status', '--porcelain'));
  const environment = { node: process.version, platform: platform(), release: release(), arch: arch() };
  const run = (name, args, extraEnv = {}) => {
    const stdout = resolve(output, `${name}.jsonl`);
    const stderr = resolve(output, `${name}.stderr`);
    const out = openSync(stdout, 'w');
    const err = openSync(stderr, 'w');
    const startedAt = new Date().toISOString();
    let result;
    try { result = spawnSync(process.execPath, args, { env: { ...process.env, ...extraEnv }, stdio: ['ignore', out, err] }); }
    finally { closeSync(out); closeSync(err); }
    return { command: [process.execPath, ...args], environmentOverrides: extraEnv,
      startedAt, finishedAt: new Date().toISOString(), exitCode: result.status,
      signal: result.signal, error: result.error?.message, stdout, stderr };
  };
  const parser = run('parser', ['--import', 'tsx', '--test', '--test-reporter=./scripts/grammar-node-reporter.mjs',
    '--test-name-pattern=F-05|F-06', 'src/lib/unipack/parser.test.ts']);
  const browser = run('browser', ['node_modules/@playwright/test/cli.js', 'test',
    'e2e/sound-formats.spec.ts', '--project=chromium', '--grep=A-0[1-5] ', '--reporter=json',
    `--output=${resolve(output, 'playwright')}`], { PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(output, 'browser.json') });
  const parserRecords = [];
  const browserRecords = [];
  const parseErrors = [];
  try {
    for (const line of readFileSync(parser.stdout, 'utf8').trim().split('\n')) {
      const { type, data } = JSON.parse(line);
      if (['test:pass', 'test:fail'].includes(type)) parserRecords.push({ name: data.name,
        status: type === 'test:pass' && !data.skip && !data.todo ? 'passed' : 'unconfirmed' });
    }
  } catch (error) { parseErrors.push(`parser: ${error.message}`); }
  let browserErrors = [];
  try {
    const report = JSON.parse(readFileSync(resolve(output, 'browser.json'), 'utf8'));
    browserErrors = report.errors;
    const visit = suites => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests) {
            const [result] = test.results;
            const attachment = result?.attachments.find(entry => entry.name === 'grammar-audio');
            const evidence = attachment?.body ? JSON.parse(Buffer.from(attachment.body, 'base64').toString()) : null;
            browserRecords.push({ name: spec.title, project: test.projectName,
              status: test.expectedStatus === 'passed' && test.results.length === 1 && result.status === 'passed'
                && result.retry === 0 && evidence?.browser === test.projectName && evidence?.browserVersion
                && evidence?.playingRms > 0.001 && evidence?.started.bufferId === evidence?.decoded.id
                ? 'passed' : 'unconfirmed', evidence });
          }
        }
        visit(suite.suites ?? []);
      }
    };
    visit(report.suites);
  } catch (error) { parseErrors.push(`browser: ${error.message}`); }
  const items = Object.entries({ ...parserTests, ...audioTests }).map(([item, tests]) => {
    const isParser = item.startsWith('F-');
    const records = isParser ? parserRecords : browserRecords;
    return { item, tests, status: verdict(tests, records, (isParser ? parser : browser).exitCode,
      parseErrors.length === 0 && (isParser || browserErrors.length === 0)),
      results: records.filter(record => tests.includes(record.name)), run: isParser ? 'parser' : 'browser' };
  });
  const rawFiles = ['parser.jsonl', 'parser.stderr', 'browser.jsonl', 'browser.stderr', 'browser.json', 'source.patch', 'source-status.txt']
    .map(path => { try { return { path, sha256: hash(readFileSync(resolve(output, path))) }; }
      catch { return { path, missing: true }; } });
  const summary = { schemaVersion: 1, grammar: grammarRecord(),
    source, environment, runs: { parser, browser }, parseErrors, browserErrors, rawFiles, items,
    unexecutedBrowsers: ['webkit', 'firefox'], humanListening: false };
  writeFileSync(resolve(output, 'items.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(items.map(({ item, status }) => `${item}: ${status}`).join('\n'));
  if (items.some(item => item.status !== 'confirmed')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
