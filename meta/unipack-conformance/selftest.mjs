// Tests of the conformance tooling itself: the corpus is current and consistent, the fingerprint notices
// changed input, the report never turns a missing or mismatched platform or a claim without a result into
// a pass, and the sync check notices a drifted copy. `pnpm test:unipack` runs this file too (see
// src/lib/unipack/conformance.test.ts). Alone: node --test meta/unipack-conformance/selftest.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCorpus, serialize } from './build-corpus.mjs';
import { buildAssets, fingerprint } from './lib.mjs';
import { buildReport, judge, loadCanonical, parseResults, PLATFORMS, renderText } from './report.mjs';
import { COPY_PATHS, differences } from './sync.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const canonical = loadCanonical();
const { corpus } = canonical;

const SOME_RESULT = { loaded: true };

/**
 * What a platform whose every result equals the expected one would write, with `over` applied per case
 * id. Undetermined cases and the ones the corpus says the platform cannot observe are unverified, as
 * the harnesses report them.
 */
function fullResults(platform, over = {}) {
  return {
    platform,
    corpusSha256: canonical.sha256,
    cases: corpus.cases.map((c) => {
      const base = { id: c.id, fingerprint: c.fingerprint, detail: '' };
      if (c.expectation !== 'determined') return { ...base, status: 'unverified', actual: SOME_RESULT, ...over[c.id] };
      if (c.unobserved?.[platform]) return { ...base, status: 'unverified', actual: null, ...over[c.id] };
      return { ...base, status: c.known?.[platform] ? 'unverified' : 'pass', actual: c.expected, ...over[c.id] };
    }),
  };
}

/** The log a platform that claims a pass on every case would print: status lines only, no results. */
function logOf(platform) {
  return [
    ...corpus.cases.map((c) => `Test case passed. UNIPACK-CONFORMANCE ${JSON.stringify({ platform, id: c.id, fingerprint: c.fingerprint, status: 'pass' })}`),
    `UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform, corpusSha256: canonical.sha256, cases: corpus.cases.length })}`,
  ].join('\n');
}

const plain = corpus.cases.filter((c) => c.expectation === 'determined' && !c.known && !c.unobserved);
const [determined, another] = plain;
const undetermined = corpus.cases.find((c) => c.expectation === 'undetermined');
const statusesOf = (judged) => [...new Set([...judged.values()].map((v) => v.status))];

test('corpus.json is what the sources build', () => {
  assert.equal(readFileSync(join(here, 'corpus.json'), 'utf8'), serialize(buildCorpus()));
});

test('ignored or skipped lines do not establish an undocumented warning expectation', () => {
  const built = buildCorpus();
  for (const id of ['KL-003', 'AP-004', 'KL-M07', 'AP-M10']) {
    const c = built.cases.find((entry) => entry.id === id);
    assert.equal(c.expectation, 'undetermined', id);
    assert.equal(c.expected, undefined, id);
    assert.match(c.question, /warn/, id);
    for (const platform of PLATFORMS) {
      const results = fullResults(platform, { [id]: { status: 'pass', actual: SOME_RESULT } });
      assert.equal(judge(canonical, platform, results).get(id).status, 'unverified', `${id}/${platform}`);
    }
  }
});

test('sound assets regenerate to the same bytes', () => {
  assert.deepEqual(buildAssets(), corpus.assets);
});

test('case ids are unique and every determined case has a doc, intent or reference basis', () => {
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, corpus.cases.length);
  for (const c of corpus.cases) {
    if (c.expectation === 'determined') assert.ok(c.basis.length > 0 && c.expected !== undefined, c.id);
    else assert.ok(c.question && c.expected === undefined, c.id);
  }
});

test('the fingerprint changes with any input byte, the file name or an added file', () => {
  const c = corpus.cases.find((x) => x.id === 'KS-001');
  assert.equal(fingerprint(c.files, corpus.assets), c.fingerprint);
  const edit = (fn) => fingerprint(fn(structuredClone(c.files)), corpus.assets);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'keySound').text += ' '; return f; }), c.fingerprint);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'keySound').path = 'keysound'; return f; }), c.fingerprint);
  assert.notEqual(edit((f) => [...f, { path: 'autoPlay', text: '' }]), c.fingerprint);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'sounds/a.wav').asset = 'tone-660'; return f; }), c.fingerprint);
});

test('a platform that was not run is unverified on every case, never a pass', () => {
  const report = buildReport(canonical, { web: fullResults('web') });
  for (const row of report.rows) {
    assert.equal(row.android.status, 'unverified');
    assert.equal(row.ios.status, 'unverified');
  }
  assert.equal(report.passOnAllThree, 0);
  assert.ok(report.summary.web.pass > 0);
});

test('a platform that ran another corpus or other input is unverified', () => {
  const other = { ...fullResults('ios'), corpusSha256: 'f'.repeat(64) };
  assert.deepEqual(statusesOf(judge(canonical, 'ios', other)), ['unverified']);

  const wrongInput = judge(canonical, 'ios', fullResults('ios', { [determined.id]: { fingerprint: '0'.repeat(64) } }));
  assert.equal(wrongInput.get(determined.id).status, 'unverified');
  assert.equal(wrongInput.get(another.id).status, 'pass');

  const missing = fullResults('ios');
  missing.cases = missing.cases.filter((r) => r.id !== determined.id);
  assert.equal(judge(canonical, 'ios', missing).get(determined.id).status, 'unverified');
});

test('an undetermined case is never a pass, whether the claim comes with a result or without one', () => {
  for (const actual of [SOME_RESULT, undefined, null]) {
    const claimed = judge(canonical, 'web', fullResults('web', { [undetermined.id]: { status: 'pass', actual } }));
    assert.equal(claimed.get(undetermined.id).status, 'unverified');
  }
});

test('a pass claimed without the result it is based on is unverified', () => {
  for (const actual of [undefined, null]) {
    const claimed = judge(canonical, 'web', fullResults('web', { [determined.id]: { status: 'pass', actual } }));
    assert.equal(claimed.get(determined.id).status, 'unverified');
    assert.match(claimed.get(determined.id).detail, /without the result/);
  }
  const everyCase = fullResults('ios');
  everyCase.cases = everyCase.cases.map((r) => ({ id: r.id, fingerprint: r.fingerprint, status: 'pass', detail: '' }));
  assert.deepEqual(statusesOf(judge(canonical, 'ios', everyCase)), ['unverified']);
});

test('results handed in under another platform\'s name are unverified on every case', () => {
  const web = fullResults('web');
  assert.ok(statusesOf(judge(canonical, 'web', web)).includes('pass'));
  assert.deepEqual(statusesOf(judge(canonical, 'android', web)), ['unverified']);
  assert.deepEqual(statusesOf(judge(canonical, 'android', { ...web, platform: undefined })), ['unverified']);

  const report = buildReport(canonical, { android: web, web });
  assert.equal(report.summary.android.pass, 0);
  assert.equal(report.summary.android.unverified, corpus.cases.length);
  assert.equal(report.passOnAllThree, 0);
});

test('a test log is never a pass: an iOS log given as Android, or as iOS, is unverified on every case', () => {
  const log = parseResults(logOf('ios'));
  assert.equal(log.platform, 'ios');
  assert.equal(log.cases.length, corpus.cases.length);
  assert.deepEqual(statusesOf(judge(canonical, 'android', log)), ['unverified']);
  assert.deepEqual(statusesOf(judge(canonical, 'ios', log)), ['unverified']);
});

test('the command line reports an iOS log given as --android as unverified, with no Android pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unipack-report-'));
  try {
    const iosLog = join(dir, 'ios.log');
    const webJson = join(dir, 'web.json');
    writeFileSync(iosLog, logOf('ios'));
    writeFileSync(webJson, JSON.stringify(fullResults('web')));
    const run = spawnSync(process.execPath, [join(here, 'report.mjs'), '--android', iosLog, '--ios', webJson, '--web', webJson, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.summary.android, { pass: 0, fail: 0, unsupported: 0, 'intended-difference': 0, unverified: corpus.cases.length });
    assert.equal(report.summary.ios.pass, 0);
    assert.ok(report.summary.web.pass > 0);
    assert.equal(report.passOnAllThree, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a status the platform reports is checked against its own actual result', () => {
  const lying = fullResults('web', { [determined.id]: { status: 'pass', actual: { loaded: false } } });
  assert.match(judge(canonical, 'web', lying).get(determined.id).detail, /classifies as fail/);
  const honest = fullResults('web', { [determined.id]: { status: 'pass', actual: determined.expected } });
  assert.equal(judge(canonical, 'web', honest).get(determined.id).status, 'pass');
});

test('a case the platform could not drive is unverified with its own reason', () => {
  const skipped = fullResults('ios', { [determined.id]: { status: 'unverified', actual: null, detail: 'the audio engine is not usable here' } });
  const seen = judge(canonical, 'ios', skipped).get(determined.id);
  assert.equal(seen.status, 'unverified');
  assert.equal(seen.detail, 'the audio engine is not usable here');
});

test('a case the corpus says a platform cannot observe is unverified there even if it claims a pass', () => {
  const c = corpus.cases.find((x) => x.unobserved?.ios && !x.unobserved.android);
  assert.ok(c, 'the corpus has a case iOS cannot observe');
  const claim = { [c.id]: { status: 'pass', actual: c.expected } };
  const ios = judge(canonical, 'ios', fullResults('ios', claim)).get(c.id);
  assert.equal(ios.status, 'unverified');
  assert.equal(ios.detail, c.unobserved.ios);
  assert.equal(judge(canonical, 'android', fullResults('android', claim)).get(c.id).status, 'pass');
});

test('a pinned difference is reported with its pinned status, and stops being one when it disappears', () => {
  const pinned = structuredClone(canonical);
  const c = pinned.corpus.cases.find((x) => x.id === determined.id);
  c.known = { ios: { status: 'unsupported', actual: { loaded: false }, note: 'test' } };
  const seen = judge(pinned, 'ios', fullResults('ios', { [c.id]: { status: 'unsupported', actual: { loaded: false } } }));
  assert.equal(seen.get(c.id).status, 'unsupported');
  const fixed = judge(pinned, 'ios', fullResults('ios', { [c.id]: { status: 'pass', actual: c.expected } }));
  assert.equal(fixed.get(c.id).status, 'unverified');
});

test('the lines of a log are read, marked as coming from a log', () => {
  const lines = [
    'noise before',
    `[xcodebuild] UNIPACK-CONFORMANCE ${JSON.stringify({ platform: 'ios', id: 'KS-001', fingerprint: 'abc', status: 'pass' })}`,
    `UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform: 'ios', corpusSha256: 'def', cases: 1 })}`,
  ].join('\n');
  assert.deepEqual(parseResults(lines), { platform: 'ios', corpusSha256: 'def', source: 'log', cases: [{ id: 'KS-001', fingerprint: 'abc', status: 'pass', detail: '' }] });
});

test('the table says when a result file was written and whether that run asserted', () => {
  const web = { ...fullResults('web'), generatedAt: '2026-09-30T12:00:00.000Z', assertions: 'checked' };
  const android = { ...fullResults('android'), generatedAt: '2026-09-30T12:01:00.000Z', assertions: 'skipped' };
  const text = renderText(buildReport(canonical, { web, android }));
  assert.match(text, /\nweb\s+results written 2026-09-30T12:00:00.000Z\n/);
  assert.match(text, /\nandroid\s+results written 2026-09-30T12:01:00.000Z, a record-only run/);
  assert.match(text, /\nios\s+no results given\n/);
});

test('the sync check notices a missing or drifted copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'unipack-sync-'));
  try {
    assert.equal(differences({ android: root }).length, 1);
    const target = join(root, COPY_PATHS.android);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(here, 'corpus.json')));
    assert.deepEqual(differences({ android: root }), []);
    writeFileSync(target, `${readFileSync(target, 'utf8')} `);
    assert.equal(differences({ android: root }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('report rows cover every platform', () => {
  assert.deepEqual(PLATFORMS, ['android', 'ios', 'web']);
});
