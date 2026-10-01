// Runs the shared conformance corpus (meta/unipack-conformance/corpus.json) through the web parser
// and runners, prints one result per case and writes web.json for meta/unipack-conformance/report.mjs.
// It also runs the corpus tooling's own tests, so `pnpm test:unipack` notices a corpus.json that was
// not rebuilt from its sources.
//
// Compiled by tsc before running, like the other unipack *.test.ts (see parser.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedRunner } from './LedRunner';
import {
  actualFor, classify, CorpusCase, Deps, fingerprintOf, Json, loadCorpus, PLATFORM, REAL, resultFor, verifyFingerprint,
} from './conformanceHarness';

const { corpus, sha256 } = loadCorpus();

// UNIPACK_CONFORMANCE_DUMP=1, and only that value, makes this a record-only run: every result is written
// but no case is asserted, to look at a platform's differences before they are pinned in
// divergences.json. Such a run is never a pass: it ends with one failing test that says so.
const RECORD_ONLY = process.env.UNIPACK_CONFORMANCE_DUMP === '1';
const RECORD_ONLY_NOTICE = 'UNIPACK_CONFORMANCE_DUMP=1: record-only run, no case was asserted';
const results: { id: string; fingerprint: string; status: string; detail: string; actual: Json }[] = [];

function byId(id: string): CorpusCase {
  const found = corpus.cases.find((c) => c.id === id);
  assert.ok(found, `case ${id} is in the corpus`);
  return found;
}

describe('corpus integrity', () => {
  test('has unique case ids and every case declares the fingerprint of its input files', () => {
    const ids = corpus.cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of corpus.cases) verifyFingerprint(c, corpus);
  });

  test('a determined case states its expected result, an undetermined one states the open question', () => {
    for (const c of corpus.cases) {
      if (c.expectation === 'determined') assert.notEqual(c.expected, undefined, c.id);
      else assert.ok(c.question, c.id);
    }
  });
});

describe('cases', () => {
  for (const c of corpus.cases) {
    test(`${c.id} ${c.title}`, async () => {
      verifyFingerprint(c, corpus);
      const { actual, outcome } = await resultFor(c, corpus);
      results.push({ id: c.id, fingerprint: c.fingerprint, status: outcome.status, detail: outcome.detail, actual });
      if (RECORD_ONLY) return;
      assert.equal(outcome.unexpected, false, `${c.id}: ${outcome.detail}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(c.expected)}`);
    });
  }
});

// A check that cannot fail proves nothing: each of these breaks one thing the cases above rely on and
// requires the comparison to notice.
describe('the checks can fail', () => {
  test('a changed input file no longer matches the case fingerprint', () => {
    const c = byId('KS-001');
    const altered: CorpusCase = { ...c, files: c.files.map((f) => (f.path === 'keySound' ? { ...f, text: `${f.text}\n1 2 2 c.wav` } : f)) };
    assert.notEqual(fingerprintOf(altered.files, corpus), c.fingerprint);
    assert.throws(() => verifyFingerprint(altered, corpus), /hash to/);
  });

  test('a changed expected coordinate makes a passing case fail', async () => {
    const c = byId('KS-001');
    const actual = await actualFor(c, corpus);
    assert.equal(classify(c, actual).status, 'pass');
    const shifted: CorpusCase = JSON.parse(JSON.stringify(c));
    (shifted.expected as { sounds: { x: number }[] }).sounds[0].x += 1;
    assert.equal(classify(shifted, actual).status, 'fail');
  });

  test('a changed input makes the same expected result fail', async () => {
    const c = byId('KS-001');
    const altered: CorpusCase = { ...c, files: c.files.map((f) => (f.path === 'keySound' ? { ...f, text: '1 2 1 a.wav\n2 4 3 b.wav' } : f)) };
    assert.equal(classify(c, await actualFor(altered, corpus)).status, 'fail');
  });

  test('leaving the parser call out fails a parse case', async () => {
    const c = byId('KS-001');
    const noParse: Deps = { ...REAL, parse: async () => ({ ...(await REAL.parse(await emptyPack())), errors: [] }) };
    assert.equal(classify(c, await actualFor(c, corpus, noParse)).status, 'fail');
  });

  test('leaving the LED runner call out fails a run case', async () => {
    const c = byId('RUN-L-001');
    assert.equal(classify(c, await actualFor(c, corpus)).status, 'pass');
    class SilentLedRunner extends LedRunner {
      eventOn(): void {}
    }
    const noLed: Deps = { ...REAL, LedRunner: SilentLedRunner };
    assert.equal(classify(c, await actualFor(c, corpus, noLed)).status, 'fail');
  });

  test('a pinned difference that no longer happens, or changed, is reported as unexpected', () => {
    const c = { ...byId('KS-001'), known: { [PLATFORM]: { status: 'fail' as const, actual: { loaded: false }, note: 'pinned' } } };
    assert.equal(classify(c, c.expected as Json).unexpected, true);
    assert.equal(classify(c, { loaded: true }).unexpected, true);
    assert.deepEqual(classify(c, { loaded: false }), { status: 'fail', unexpected: false, detail: 'pinned' });
  });

  test('an undetermined case is never counted as a pass', async () => {
    const c = corpus.cases.find((x) => x.expectation === 'undetermined');
    assert.ok(c);
    assert.equal(classify(c, await actualFor(c, corpus)).status, 'unverified');
  });

  test('a case the corpus says this platform cannot observe is unverified and is not run', async () => {
    const c: CorpusCase = { ...byId('KS-001'), unobserved: { [PLATFORM]: 'not observable here' } };
    const neverRun: Deps = { ...REAL, parse: async () => { throw new Error('the case was run'); } };
    assert.deepEqual(await resultFor(c, corpus, neverRun), { actual: null, outcome: { status: 'unverified', unexpected: false, detail: 'not observable here' } });
  });
});

describe('tooling', () => {
  test('corpus.json is current and the report tool passes its own tests (meta/unipack-conformance/selftest.mjs)', () => {
    // The test runner marks its children through NODE_TEST_CONTEXT; a nested runner must not inherit it.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', 'meta/unipack-conformance/selftest.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  });
});

describe('this run', () => {
  test('asserted every case (a record-only run is never a pass)', () => {
    assert.equal(RECORD_ONLY, false, RECORD_ONLY_NOTICE);
  });
});

/** The smallest pack that parses, standing in for "the parser ran but saw nothing of the case". */
async function emptyPack(): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('info', 'title=x\nproducerName=x\nbuttonX=1\nbuttonY=1\nchain=1');
  zip.file('keySound', '');
  return zip.generateAsync({ type: 'arraybuffer' });
}

after(() => {
  const dir = process.env.UNIPACK_CONFORMANCE_OUT ?? join(process.cwd(), '.next/cache/unipack-conformance');
  mkdirSync(dir, { recursive: true });
  const report = {
    platform: PLATFORM, corpusSha256: sha256, generatedAt: new Date().toISOString(), assertions: RECORD_ONLY ? 'skipped' : 'checked',
    cases: results.sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeFileSync(join(dir, `${PLATFORM}.json`), `${JSON.stringify(report, null, 2)}\n`);
  if (RECORD_ONLY) console.log(`UNIPACK-CONFORMANCE-RECORD-ONLY ${RECORD_ONLY_NOTICE}`);
  for (const r of report.cases) console.log(`UNIPACK-CONFORMANCE ${JSON.stringify({ platform: PLATFORM, id: r.id, fingerprint: r.fingerprint, status: r.status })}`);
  console.log(`UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform: PLATFORM, corpusSha256: sha256, cases: report.cases.length })}`);
});
